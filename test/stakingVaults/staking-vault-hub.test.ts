import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  getConnection,
} from '../utils/helpers'
import type {
  ERC677,
  StakingVault,
  StakingVaultHub,
  StakingVaultFactoryMock,
  StakingAdapterMock,
  StakingPoolMock,
} from '../../types/ethers-contracts'

const { ethers, loadFixture, networkHelpers } = getConnection()

describe('StakingVaultHub', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    const stakingPool = (await deploy('StakingPoolMock', [token.target])) as StakingPoolMock

    const factory = (await deploy('StakingVaultFactoryMock', [])) as StakingVaultFactoryMock

    const hub = (await deployUpgradeable(
      'StakingVaultHub',
      [
        500, // maxValueChangePercent (5%)
        86400, // maxStalenessSeconds (1 day)
        604800, // maxFeeOverduePeriod (7 days)
        toEther(1000000), // globalShareLimit
      ],
      {
        constructorArgs: [token.target, stakingPool.target, factory.target],
        unsafeAllow: ['state-variable-immutable', 'constructor'],
      }
    )) as StakingVaultHub

    // Deploy vault with hub as immutable reference
    const vault = (await deployUpgradeable(
      'StakingVault',
      [accounts[0], accounts[0], accounts[0]],
      {
        constructorArgs: [token.target, hub.target, factory.target],
        unsafeAllow: ['state-variable-immutable', 'constructor'],
      }
    )) as StakingVault

    // Register vault in factory mock
    await factory.setDeployedVault(vault.target, true)

    // Deploy and register adapter
    const adapter = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock
    await factory.setDeployedAdapter(adapter.target, true)
    await vault.addAdapter(adapter.target)

    // Approve vault and hub for token spending
    await token.approve(vault.target, ethers.MaxUint256)
    await token.approve(hub.target, ethers.MaxUint256)

    // Fund adapter with tokens for rewards
    await token.transfer(adapter.target, toEther(1000))

    // Set up default fee receiver
    const fees = [{ receiver: accounts[5], basisPoints: 1000 }]

    // Connect vault to hub
    await hub.connectVault(
      vault.target,
      2000, // reserveRatio (20%)
      5000, // forceRebalanceThreshold (50%)
      100, // minIdleRatio (1%)
      650, // liquidityFeeBP (6.5%)
      true, // requireStakedCollateral
      toEther(500000), // shareLimit
      fees
    )

    return { signers, accounts, token, stakingPool, factory, hub, vault, adapter, fees }
  }

  // Vault Lifecycle

  it('initialize should work correctly', async () => {
    const { hub, token, stakingPool, factory, accounts } = await loadFixture(deployFixture)

    // Immutable references set in constructor
    assert.equal(await hub.token(), token.target)
    assert.equal(await hub.stakingPool(), stakingPool.target)
    assert.equal(await hub.factory(), factory.target)

    // Mutable config set in initialize
    assert.equal(Number(await hub.maxValueChangePercent()), 500)
    assert.equal(Number(await hub.maxStalenessSeconds()), 86400)
    assert.equal(Number(await hub.maxFeeOverduePeriod()), 604800)
    assert.equal(fromEther(await hub.globalShareLimit()), 1000000)

    // Owner set to deployer
    assert.equal(await hub.owner(), accounts[0])

    // StakingPool approved for token spending
    assert.equal(await token.allowance(hub.target, stakingPool.target), ethers.MaxUint256)
  })

  it('connectVault should work correctly', async () => {
    const { hub, vault, token, factory, signers, accounts } = await loadFixture(deployFixture)

    // Vault connected in fixture — verify state
    assert.equal(await hub.isConnected(vault.target), true)
    assert.equal(Number(await hub.connectedVaultCount()), 1)

    // Verify connection parameters stored correctly
    const conn = await hub.connections(vault.target)
    assert.equal(conn.reserveRatio, 2000)
    assert.equal(conn.forceRebalanceThreshold, 5000)
    assert.equal(conn.minIdleRatio, 100)
    assert.equal(conn.liquidityFeeBP, 650)
    assert.equal(conn.requireStakedCollateral, true)
    assert.equal(fromEther(conn.shareLimit), 500000)

    // Verify record initialized
    const record = await hub.vaults(vault.target)
    assert.equal(record.isConnected, true)
    assert.isTrue(Number(record.lastFeeSettledTimestamp) > 0)
    assert.equal(record.totalFeeRate, 1000)

    // Verify fees stored
    const fees = await hub.feesFor(vault.target)
    assert.equal(fees.length, 1)
    assert.equal(fees[0].receiver, accounts[5])
    assert.equal(fees[0].basisPoints, 1000)

    // Connect a second vault
    const vault2 = (await deployUpgradeable(
      'StakingVault',
      [accounts[0], accounts[0], accounts[0]],
      {
        constructorArgs: [token.target, hub.target, factory.target],
        unsafeAllow: ['state-variable-immutable', 'constructor'],
      }
    )) as StakingVault
    await factory.setDeployedVault(vault2.target, true)

    await expect(
      hub.connectVault(vault2.target, 1500, 4000, 200, 500, false, toEther(300000), [
        { receiver: accounts[6], basisPoints: 500 },
      ])
    ).to.emit(hub, 'VaultConnected')

    assert.equal(await hub.isConnected(vault2.target), true)
    assert.equal(Number(await hub.connectedVaultCount()), 2)

    // Reverts if vault already connected
    await expect(
      hub.connectVault(vault.target, 2000, 5000, 100, 650, true, toEther(500000), [
        { receiver: accounts[5], basisPoints: 1000 },
      ])
    ).to.be.revertedWithCustomError(hub, 'VaultAlreadyConnected')

    // Reverts if vault not from factory
    await expect(
      hub.connectVault(accounts[8], 2000, 5000, 100, 650, true, toEther(500000), [
        { receiver: accounts[5], basisPoints: 1000 },
      ])
    ).to.be.revertedWithCustomError(hub, 'VaultNotFromFactory')

    const vault3 = (await deployUpgradeable(
      'StakingVault',
      [accounts[0], accounts[0], accounts[0]],
      {
        constructorArgs: [token.target, hub.target, factory.target],
        unsafeAllow: ['state-variable-immutable', 'constructor'],
      }
    )) as StakingVault
    await factory.setDeployedVault(vault3.target, true)

    // Reverts if forceRebalanceThreshold is 0
    await expect(
      hub.connectVault(vault3.target, 2000, 0, 100, 650, true, toEther(500000), [
        { receiver: accounts[5], basisPoints: 1000 },
      ])
    ).to.be.revertedWithCustomError(hub, 'InvalidParameter')

    // Reverts if caller is not owner
    await expect(
      (hub.connect(signers[1]) as any).connectVault(
        vault3.target,
        2000,
        5000,
        100,
        650,
        true,
        toEther(500000),
        [{ receiver: accounts[5], basisPoints: 1000 }]
      )
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('updateConnection should work correctly', async () => {
    const { hub, vault, adapter, signers, accounts } = await loadFixture(deployFixture)

    // Reverts if vault is stale (no report yet)
    await expect(
      hub.updateConnection(vault.target, 3000, 6000, 200, 800, false, toEther(600000))
    ).to.be.revertedWithCustomError(hub, 'VaultStale')

    // Make vault fresh
    await vault.updateTotalValue()

    // Update all connection parameters
    await expect(
      hub.updateConnection(vault.target, 3000, 6000, 200, 800, false, toEther(600000))
    ).to.emit(hub, 'VaultConnectionUpdated')

    const conn = await hub.connections(vault.target)
    assert.equal(conn.reserveRatio, 3000)
    assert.equal(conn.forceRebalanceThreshold, 6000)
    assert.equal(conn.minIdleRatio, 200)
    assert.equal(conn.liquidityFeeBP, 800)
    assert.equal(conn.requireStakedCollateral, false)
    assert.equal(fromEther(conn.shareLimit), 600000)

    // Reverts if forceRebalanceThreshold is 0
    await expect(
      hub.updateConnection(vault.target, 3000, 0, 200, 800, false, toEther(600000))
    ).to.be.revertedWithCustomError(hub, 'InvalidParameter')

    // Reverts if share limit below current liability
    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(1000))
    await vault.updateTotalValue()
    await hub.mintLST(vault.target, accounts[0], toEther(100))
    await vault.updateTotalValue()

    await expect(
      hub.updateConnection(vault.target, 3000, 6000, 200, 800, false, 1)
    ).to.be.revertedWithCustomError(hub, 'ShareLimitExceeded')

    // Reverts if vault not connected
    await expect(
      hub.updateConnection(signers[5].address, 3000, 6000, 200, 800, false, toEther(600000))
    ).to.be.revertedWithCustomError(hub, 'VaultNotConnected')

    // Reverts if caller is not owner
    await expect(
      (hub.connect(signers[1]) as any).updateConnection(
        vault.target,
        3000,
        6000,
        200,
        800,
        false,
        toEther(600000)
      )
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('updateVaultFees should work correctly', async () => {
    const { hub, vault, signers, accounts } = await loadFixture(deployFixture)

    // Update fees
    const newFees = [
      { receiver: accounts[6], basisPoints: 500 },
      { receiver: accounts[7], basisPoints: 300 },
    ]
    await expect(hub.updateVaultFees(vault.target, newFees)).to.emit(hub, 'VaultFeesUpdated')

    const fees = await hub.feesFor(vault.target)
    assert.equal(fees.length, 2)
    assert.equal(fees[0].receiver, accounts[6])
    assert.equal(fees[0].basisPoints, 500)
    assert.equal(fees[1].receiver, accounts[7])
    assert.equal(fees[1].basisPoints, 300)

    // totalFeeRate updated
    const record = await hub.vaults(vault.target)
    assert.equal(record.totalFeeRate, 800)

    // Reverts if too many fees
    const tooMany = Array.from({ length: 6 }, () => ({
      receiver: accounts[5],
      basisPoints: 100,
    }))
    await expect(hub.updateVaultFees(vault.target, tooMany)).to.be.revertedWithCustomError(
      hub,
      'TooManyFees'
    )

    // Reverts if total fee rate too high
    await expect(
      hub.updateVaultFees(vault.target, [{ receiver: accounts[5], basisPoints: 5000 }])
    ).to.be.revertedWithCustomError(hub, 'FeeRateTooHigh')

    // Reverts if receiver is zero address
    await expect(
      hub.updateVaultFees(vault.target, [{ receiver: ethers.ZeroAddress, basisPoints: 500 }])
    ).to.be.revertedWithCustomError(hub, 'ZeroAddress')

    // Reverts if basis points is zero
    await expect(
      hub.updateVaultFees(vault.target, [{ receiver: accounts[5], basisPoints: 0 }])
    ).to.be.revertedWithCustomError(hub, 'InvalidParameter')

    // Reverts if vault not connected
    await expect(
      hub.updateVaultFees(accounts[9], [{ receiver: accounts[5], basisPoints: 500 }])
    ).to.be.revertedWithCustomError(hub, 'VaultNotConnected')

    // Reverts if caller is not owner
    await expect(
      (hub.connect(signers[1]) as any).updateVaultFees(vault.target, newFees)
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('disconnectVault should work correctly', async () => {
    const { hub, vault, adapter, signers, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(1000))
    await vault.updateTotalValue()
    await hub.mintLST(vault.target, accounts[0], toEther(100))

    // Reverts if vault has liability
    await expect(hub.disconnectVault(vault.target, false)).to.be.revertedWithCustomError(
      hub,
      'VaultHasLiability'
    )

    // Burn liability
    await hub.burnLST(vault.target, toEther(100))

    // Force fee accrual via yield growth (stay within quarantine threshold of 5%)
    await adapter.setTotalDeposits(toEther(1040))
    await vault.updateTotalValue()

    // Reverts if unsettled fees and waive flag is false
    assert.isTrue(Number(await hub.unsettledFees(vault.target)) > 0)
    await expect(hub.disconnectVault(vault.target, false)).to.be.revertedWithCustomError(
      hub,
      'UnsettledFeesRemaining'
    )

    // Reverts if caller is not owner
    await expect(
      (hub.connect(signers[1]) as any).disconnectVault(vault.target, true)
    ).to.be.revertedWith('Ownable: caller is not the owner')

    // Succeeds with waive flag
    await expect(hub.disconnectVault(vault.target, true))
      .to.emit(hub, 'VaultDisconnected')
      .withArgs(vault.target)

    assert.equal(await hub.isConnected(vault.target), false)
    assert.equal(Number(await hub.connectedVaultCount()), 0)

    // Verify all data cleared
    const record = await hub.vaults(vault.target)
    assert.equal(record.isConnected, false)
    assert.equal(Number(record.totalFeeRate), 0)
    const conn = await hub.connections(vault.target)
    assert.equal(conn.reserveRatio, 0)
    const fees = await hub.feesFor(vault.target)
    assert.equal(fees.length, 0)

    // Reverts if vault not connected
    await expect(hub.disconnectVault(vault.target, false)).to.be.revertedWithCustomError(
      hub,
      'VaultNotConnected'
    )
  })

  // LST Operations

  it('mintLST should work correctly', async () => {
    const { hub, vault, adapter, stakingPool, signers, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(5000))
    await vault.stake(adapter.target, toEther(5000))
    await vault.updateTotalValue()

    // Mint LST — liability created, shares minted to recipient
    await expect(hub.mintLST(vault.target, accounts[5], toEther(1000)))
      .to.emit(hub, 'LSTMinted')
      .withArgs(vault.target, accounts[5], toEther(1000), toEther(1000))

    assert.equal(fromEther(await hub.liability(vault.target)), 1000)
    assert.equal(fromEther(await hub.totalLiabilityShares()), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[5])), 1000)

    // Mint more — accumulates
    await hub.mintLST(vault.target, accounts[0], toEther(500))
    assert.equal(fromEther(await hub.liability(vault.target)), 1500)

    // Reverts if insufficient collateral (reserve ratio = 20%)
    // Max mintable: 5000 / 1.2 = 4166. Already minted 1500, so ~2666 remaining
    await expect(
      hub.mintLST(vault.target, accounts[0], toEther(3000))
    ).to.be.revertedWithCustomError(hub, 'InsufficientCollateral')

    // Reverts if exceeds per-vault share limit
    await vault.updateTotalValue()
    await hub.updateConnection(vault.target, 2000, 5000, 100, 650, true, toEther(1600))
    await expect(
      hub.mintLST(vault.target, accounts[0], toEther(200))
    ).to.be.revertedWithCustomError(hub, 'ShareLimitExceeded')

    // Reverts if exceeds global share limit
    await hub.updateConnection(vault.target, 2000, 5000, 100, 650, true, toEther(500000))
    await hub.setGlobalShareLimit(toEther(1500))
    await expect(
      hub.mintLST(vault.target, accounts[0], toEther(100))
    ).to.be.revertedWithCustomError(hub, 'GlobalShareLimitExceeded')
    await hub.setGlobalShareLimit(toEther(1000000))

    // Reverts if vault is quarantined — trigger via large value change
    await adapter.setTotalDeposits(toEther(10000)) // >5% change
    await vault.updateTotalValue() // quarantines the vault
    assert.equal(await hub.isQuarantined(vault.target), true)
    await expect(
      hub.mintLST(vault.target, accounts[0], toEther(100))
    ).to.be.revertedWithCustomError(hub, 'VaultIsQuarantined')
    await adapter.setTotalDeposits(toEther(5000)) // restore real value
    await hub.unquarantine(vault.target, toEther(5000))
    await vault.updateTotalValue() // re-fresh the vault

    // Reverts if vault is stale — advance time past staleness window

    await networkHelpers.time.increase(86401) // maxStalenessSeconds = 86400
    await expect(
      hub.mintLST(vault.target, accounts[0], toEther(100))
    ).to.be.revertedWithCustomError(hub, 'VaultStale')

    // Re-fresh the report
    await adapter.setTotalDeposits(toEther(5000))
    await vault.updateTotalValue()

    // Reverts if fees are overdue — shorten overdue period, accrue fees, advance time
    await hub.setMaxFeeOverduePeriod(10) // 10 seconds
    await adapter.setTotalDeposits(toEther(5200))
    await vault.updateTotalValue()
    assert.isTrue(Number(await hub.unsettledFees(vault.target)) > 0)
    await networkHelpers.time.increase(11) // past 10s overdue, but within 86400s staleness
    await expect(
      hub.mintLST(vault.target, accounts[0], toEther(100))
    ).to.be.revertedWithCustomError(hub, 'FeesOverdue')
    await hub.setMaxFeeOverduePeriod(604800)

    // Reverts if amount is zero
    await expect(hub.mintLST(vault.target, vault.target, 0)).to.be.revertedWithCustomError(
      hub,
      'ZeroAmount'
    )

    // Reverts if vault not connected
    await expect(
      hub.mintLST(signers[5].address, signers[5].address, toEther(100))
    ).to.be.revertedWithCustomError(hub, 'VaultNotConnected')

    // Reverts if caller is not vault owner
    await expect(
      (hub.connect(signers[1]) as any).mintLST(vault.target, vault.target, toEther(100))
    ).to.be.revertedWithCustomError(hub, 'OnlyVaultOwner')
  })

  it('burnLST should work correctly', async () => {
    const { hub, vault, adapter, stakingPool, signers, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(5000))
    await vault.stake(adapter.target, toEther(5000))
    await vault.updateTotalValue()

    // Mint to owner (accounts[0]) so they can burn
    await hub.mintLST(vault.target, accounts[0], toEther(1000))

    assert.equal(fromEther(await hub.liability(vault.target)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[0])), 1000)

    // Burn LST — burns from caller (owner), reduces liability
    await expect(hub.burnLST(vault.target, toEther(400)))
      .to.emit(hub, 'LSTBurned')
      .withArgs(vault.target, toEther(400), toEther(400))

    assert.equal(fromEther(await hub.liability(vault.target)), 600)
    assert.equal(fromEther(await hub.totalLiabilityShares()), 600)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[0])), 600)

    // Burn all remaining using type(uint256).max — avoids rounding dust
    await hub.burnLST(vault.target, ethers.MaxUint256)
    assert.equal(fromEther(await hub.liability(vault.target)), 0)
    assert.equal(fromEther(await hub.totalLiabilityShares()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[0])), 0)

    // Reverts if amount is zero
    await expect(hub.burnLST(vault.target, 0)).to.be.revertedWithCustomError(hub, 'ZeroAmount')

    // Reverts if caller is not vault owner
    await expect(
      (hub.connect(signers[1]) as any).burnLST(vault.target, toEther(100))
    ).to.be.revertedWithCustomError(hub, 'OnlyVaultOwner')
  })

  it('mintingCapacity should work correctly', async () => {
    const { hub, vault, adapter, accounts } = await loadFixture(deployFixture)

    // Initially full capacity — per-vault shareLimit = 500k, global = 1M
    assert.equal(fromEther(await hub.mintingCapacity(vault.target)), 500000)

    // Mint some LST to reduce capacity
    await vault.deposit(toEther(10000))
    await vault.stake(adapter.target, toEther(10000))
    await vault.updateTotalValue()
    await hub.mintLST(vault.target, accounts[0], toEther(1000))

    // Capacity reduced by minted amount (1:1 price)
    assert.equal(fromEther(await hub.mintingCapacity(vault.target)), 499000)

    // Reduce global share limit below per-vault remaining
    await hub.setGlobalShareLimit(toEther(1500))
    // globalRemaining = 1500 - 1000 = 500, perVault = 499000 → min = 500
    assert.equal(fromEther(await hub.mintingCapacity(vault.target)), 500)

    // Returns 0 for disconnected vault
    assert.equal(Number(await hub.mintingCapacity(accounts[9])), 0)
  })

  it('liability should work correctly', async () => {
    const { hub, vault, adapter, stakingPool, accounts } = await loadFixture(deployFixture)

    // Zero liability initially
    assert.equal(fromEther(await hub.liability(vault.target)), 0)

    // Mint LST — liability increases
    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(1000))
    await vault.updateTotalValue()
    await hub.mintLST(vault.target, accounts[0], toEther(200))

    // 1:1 share price → liability = 200
    assert.equal(fromEther(await hub.liability(vault.target)), 200)

    // Mint more
    await hub.mintLST(vault.target, accounts[0], toEther(100))
    assert.equal(fromEther(await hub.liability(vault.target)), 300)

    // Burn reduces liability
    await hub.burnLST(vault.target, toEther(50))
    assert.equal(fromEther(await hub.liability(vault.target)), 250)

    // Changes with share price (simulate rebase)
    await stakingPool.setSharePrice(toEther(2))
    // Same shares but each share now worth 2 tokens
    assert.equal(fromEther(await hub.liability(vault.target)), 500)
  })

  it('lockedAmount should work correctly', async () => {
    const { hub, vault, adapter, stakingPool, accounts } = await loadFixture(deployFixture)

    // Zero locked when no liability and no fees
    assert.equal(fromEther(await hub.lockedAmount(vault.target)), 0)

    // Locked increases with minted LST (liability + reserve ratio)
    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(1000))
    await vault.updateTotalValue()
    await hub.mintLST(vault.target, accounts[0], toEther(100))

    // locked = liability * (10000 + reserveRatio) / 10000 = 100 * 12000 / 10000 = 120
    assert.equal(fromEther(await hub.lockedAmount(vault.target)), 120)

    // Mint more — locked increases
    await hub.mintLST(vault.target, accounts[0], toEther(50))
    // locked = 150 * 12000 / 10000 = 180
    assert.equal(fromEther(await hub.lockedAmount(vault.target)), 180)

    // Locked includes unsettled fees
    await adapter.setTotalDeposits(toEther(1040))
    await vault.updateTotalValue()
    // Fees accrued on 40 yield at 10% = 4
    // locked = liability lock (180) + unsettled fees (4) = 184
    assert.equal(fromEther(await hub.lockedAmount(vault.target)), 184)

    // Locked changes with share price (rebase)
    await stakingPool.setSharePrice(toEther(2))
    // Liability in tokens doubles: 150 shares * 2 = 300, locked = 300 * 12000 / 10000 = 360 + 4 fees
    assert.equal(fromEther(await hub.lockedAmount(vault.target)), 364)

    // Returns 0 for disconnected vault
    assert.equal(fromEther(await hub.lockedAmount(accounts[9])), 0)
  })

  // Value Reporting & Fund Tracking

  it('updateVaultValue should work correctly', async () => {
    const { hub, vault, adapter, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))

    // First report — sets totalValue, emits event
    await expect(vault.updateTotalValue())
      .to.emit(hub, 'VaultValueUpdated')
      .withArgs(vault.target, 0, toEther(1000))
    let record = await hub.vaults(vault.target)
    assert.equal(fromEther(record.totalValue), 1000)
    assert.isTrue(Number(record.lastUpdateTimestamp) > 0)
    assert.equal(fromEther(record.maxLiabilityShares), 0)
    assert.equal(fromEther(record.lastReportInOutDelta), 1000)

    // Quarantine on suspicious increase (>5% beyond fund flows)
    await adapter.setTotalDeposits(toEther(5000))
    await vault.updateTotalValue()
    assert.equal(await hub.isQuarantined(vault.target), true)
    assert.equal(fromEther((await hub.vaults(vault.target)).totalValue), 1000) // NOT updated

    // Unquarantine and restore
    await adapter.setTotalDeposits(toEther(990))
    await hub.unquarantine(vault.target, toEther(1000))
    await vault.updateTotalValue()
    assert.equal(await hub.isQuarantined(vault.target), false)

    // Decrease does NOT trigger quarantine
    await adapter.setTotalDeposits(toEther(950))
    await vault.updateTotalValue()
    assert.equal(await hub.isQuarantined(vault.target), false)

    // Deposits between reports don't trigger quarantine
    await vault.deposit(toEther(500))
    await vault.updateTotalValue()
    assert.equal(await hub.isQuarantined(vault.target), false)
    assert.equal(fromEther((await hub.vaults(vault.target)).totalValue), 1460)

    // Withdrawals between reports don't trigger quarantine
    await vault.withdraw(toEther(300), accounts[5])
    await vault.updateTotalValue()
    assert.equal(await hub.isQuarantined(vault.target), false)
    assert.equal(fromEther((await hub.vaults(vault.target)).totalValue), 1160)

    // Resets maxLiabilityShares and lastReportInOutDelta
    await hub.mintLST(vault.target, accounts[0], toEther(50))
    await hub.burnLST(vault.target, toEther(25))
    await vault.updateTotalValue()
    record = await hub.vaults(vault.target)
    assert.equal(fromEther(record.maxLiabilityShares), fromEther(record.liabilityShares))
    assert.equal(record.lastReportInOutDelta.toString(), record.inOutDelta.toString())
  })

  it('yield fee accrual should work correctly', async () => {
    const { hub, vault, adapter } = await loadFixture(deployFixture)

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()

    // Yield fee — exact amount: yield = 40, fee = 40 * 1000/10000 = 4
    await adapter.setTotalDeposits(toEther(1030))
    await expect(vault.updateTotalValue())
      .to.emit(hub, 'YieldFeeAccrued')
      .withArgs(vault.target, toEther(4))
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 4)

    // No fee on yield decrease (slashing)
    await adapter.setTotalDeposits(toEther(1010))
    await vault.updateTotalValue()
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 4)

    // No fee when yield recovers to previous high-water mark
    await adapter.setTotalDeposits(toEther(1030))
    await vault.updateTotalValue()
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 4)

    // Fee only on new yield beyond high-water mark
    // lastFeeableYield = 40, new yield = 60, fee on 20 = 2
    await adapter.setTotalDeposits(toEther(1050))
    await expect(vault.updateTotalValue())
      .to.emit(hub, 'YieldFeeAccrued')
      .withArgs(vault.target, toEther(2))
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 6)

    // No fee when totalFeeRate is 0
    await hub.updateVaultFees(vault.target, [])
    assert.equal((await hub.vaults(vault.target)).totalFeeRate, 0)
    await adapter.setTotalDeposits(toEther(1090))
    await vault.updateTotalValue()
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 6) // unchanged
  })

  it('liquidity fee accrual should work correctly', async () => {
    const { hub, vault, adapter, stakingPool, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()

    // No liquidity fee without LST minted
    await adapter.setTotalDeposits(toEther(1030))
    await vault.updateTotalValue()
    // Only yield fee accrued (4), no liquidity fee
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 4)

    // Mint LST then simulate rebase — only liquidity fee, no new yield
    await hub.mintLST(vault.target, accounts[0], toEther(100))
    await stakingPool.setSharePrice(toEther(2))
    // rebase benefit = 200 - 100 = 100, liquidity fee = 100 * 650/10000 = 6.5
    await expect(vault.updateTotalValue()).to.emit(hub, 'LiquidityFeeAccrued')
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 10.5)

    // No liquidity fee if share price doesn't change (no rebase)
    await vault.updateTotalValue()
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 10.5)

    // No liquidity fee when liquidityFeeBP is 0
    await hub.updateConnection(vault.target, 2000, 5000, 100, 0, true, toEther(500000))
    await stakingPool.setSharePrice(toEther(3))
    await vault.updateTotalValue()
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 10.5)
  })

  it('recordDeposit should work correctly', async () => {
    const { hub, vault } = await loadFixture(deployFixture)

    // Deposit increases inOutDelta and emits event
    await expect(vault.deposit(toEther(500)))
      .to.emit(hub, 'InOutDeltaUpdated')
      .withArgs(vault.target, toEther(500))
    assert.equal(fromEther((await hub.vaults(vault.target)).inOutDelta), 500)

    // Multiple deposits accumulate
    await vault.deposit(toEther(300))
    assert.equal(fromEther((await hub.vaults(vault.target)).inOutDelta), 800)

    // Silently returns for disconnected vault (no revert)
    await hub.disconnectVault(vault.target, true)
    await vault.deposit(toEther(100))
    assert.equal(fromEther((await hub.vaults(vault.target)).inOutDelta), 0) // deleted on disconnect
  })

  it('recordWithdrawal should work correctly', async () => {
    const { hub, vault, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(1000))
    await vault.updateTotalValue()
    assert.equal(fromEther((await hub.vaults(vault.target)).inOutDelta), 1000)

    // Withdrawal decreases inOutDelta and emits event
    await expect(vault.withdraw(toEther(300), accounts[5]))
      .to.emit(hub, 'InOutDeltaUpdated')
      .withArgs(vault.target, toEther(700))
    assert.equal(fromEther((await hub.vaults(vault.target)).inOutDelta), 700)

    // Multiple withdrawals accumulate
    await vault.withdraw(toEther(200), accounts[5])
    assert.equal(fromEther((await hub.vaults(vault.target)).inOutDelta), 500)

    // Silently returns for disconnected vault (no revert)
    await hub.disconnectVault(vault.target, true)
    await vault.withdraw(toEther(100), accounts[5])
    assert.equal(fromEther((await hub.vaults(vault.target)).inOutDelta), 0) // deleted on disconnect
  })

  it('unquarantine should work correctly', async () => {
    const { hub, vault, adapter, signers } = await loadFixture(deployFixture)

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()
    await adapter.setTotalDeposits(toEther(5000))
    await vault.updateTotalValue()
    assert.equal(await hub.isQuarantined(vault.target), true)

    // Unquarantine sets baseline value and emits event
    await expect(hub.unquarantine(vault.target, toEther(1000)))
      .to.emit(hub, 'VaultUnquarantined')
      .withArgs(vault.target)

    assert.equal(await hub.isQuarantined(vault.target), false)
    assert.equal(fromEther((await hub.vaults(vault.target)).totalValue), 1000)

    // Vault is stale — quarantine cleared lastUpdateTimestamp
    assert.equal(await hub.isFresh(vault.target), false)

    // lastReportInOutDelta updated to current inOutDelta
    const record = await hub.vaults(vault.target)
    assert.equal(record.lastReportInOutDelta.toString(), record.inOutDelta.toString())

    // Next updateTotalValue succeeds against the new baseline
    await adapter.setTotalDeposits(toEther(990))
    await vault.updateTotalValue()
    assert.equal(await hub.isQuarantined(vault.target), false)
    assert.equal(await hub.isFresh(vault.target), true)

    // Reverts if vault not quarantined
    await expect(hub.unquarantine(vault.target, toEther(1000))).to.be.revertedWithCustomError(
      hub,
      'VaultNotQuarantined'
    )

    // Reverts if vault not connected
    await expect(hub.unquarantine(signers[5].address, toEther(1000))).to.be.revertedWithCustomError(
      hub,
      'VaultNotConnected'
    )

    // Reverts if caller is not owner
    await expect(
      (hub.connect(signers[1]) as any).unquarantine(vault.target, toEther(1000))
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('isFresh should work correctly', async () => {
    const { hub, vault, adapter } = await loadFixture(deployFixture)

    // False before any report (lastUpdateTimestamp == 0)
    assert.equal(await hub.isFresh(vault.target), false)

    // True after report
    await vault.deposit(toEther(100))
    await vault.updateTotalValue()
    assert.equal(await hub.isFresh(vault.target), true)

    // False after staleness window passes
    await networkHelpers.time.increase(86401)
    assert.equal(await hub.isFresh(vault.target), false)

    // True again after new report
    await vault.updateTotalValue()
    assert.equal(await hub.isFresh(vault.target), true)

    // False after quarantine (clears lastUpdateTimestamp)
    await adapter.setTotalDeposits(toEther(5000))
    await vault.updateTotalValue()
    assert.equal(await hub.isFresh(vault.target), false)

    // True for disconnected vault
    assert.equal(await hub.isFresh(ethers.ZeroAddress), true)
  })

  it('isHealthy should work correctly', async () => {
    const { hub, vault, adapter, stakingPool, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()

    // True with no liability
    assert.equal(await hub.isHealthy(vault.target), true)

    // True with liability within threshold
    // forceRebalanceThreshold = 5000 (50%)
    await hub.mintLST(vault.target, accounts[0], toEther(100))
    // health = 1000 * 10000 / 100 = 100000 >= 5000
    assert.equal(await hub.isHealthy(vault.target), true)

    // False when value drops below threshold
    await adapter.setTotalDeposits(toEther(30))
    await vault.updateTotalValue()
    // totalValue = 40 (30 adapter + 10 idle), health = 40 * 10000 / 100 = 4000 < 5000
    assert.equal(await hub.isHealthy(vault.target), false)

    await adapter.setTotalDeposits(toEther(990))
    await vault.updateTotalValue() // quarantines (big jump from 40 to 1000)
    await hub.unquarantine(vault.target, toEther(1000))
    await vault.updateTotalValue()
    assert.equal(await hub.isHealthy(vault.target), true)

    // False from rebase increasing liability in token terms
    await stakingPool.setSharePrice(toEther(1000))
    // liability = 100 shares * 1000 = 100000, health = 1000 * 10000 / 100000 = 100 < 5000
    assert.equal(await hub.isHealthy(vault.target), false)

    // True for disconnected vault
    assert.equal(await hub.isHealthy(ethers.ZeroAddress), true)
  })

  it('canStake should work correctly', async () => {
    const { hub, vault, adapter, stakingPool, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(500))
    await vault.updateTotalValue()

    // type(uint256).max for disconnected vault
    assert.equal(await hub.canStake(ethers.ZeroAddress), ethers.MaxUint256)

    // Returns idle minus minIdle reserve
    // idle = 500, totalValue = 1000, minIdleRatio = 100 (1%), minIdle = 10
    assert.equal(fromEther(await hub.canStake(vault.target)), 490)

    // Returns full idle when minIdleRatio is 0
    await hub.updateConnection(vault.target, 2000, 5000, 0, 650, true, toEther(500000))
    assert.equal(fromEther(await hub.canStake(vault.target)), 500)
    await hub.updateConnection(vault.target, 2000, 5000, 100, 650, true, toEther(500000))

    // Returns 0 when idle <= minIdle
    await vault.stake(adapter.target, toEther(490))
    assert.equal(fromEther(await hub.canStake(vault.target)), 0)

    await vault.deposit(toEther(500))
    await vault.updateTotalValue()
    assert.isTrue(fromEther(await hub.canStake(vault.target)) > 0)

    // Returns 0 when quarantined
    await adapter.setTotalDeposits(toEther(50000))
    await vault.updateTotalValue()
    assert.equal(fromEther(await hub.canStake(vault.target)), 0)

    await adapter.setTotalDeposits(toEther(990))
    await hub.unquarantine(vault.target, toEther(1500))
    await vault.updateTotalValue()
    assert.isTrue(fromEther(await hub.canStake(vault.target)) > 0)

    // Returns 0 when unhealthy (inflate liability via share price)
    await hub.mintLST(vault.target, accounts[0], toEther(100))
    await stakingPool.setSharePrice(toEther(1000))
    assert.equal(fromEther(await hub.canStake(vault.target)), 0)

    await stakingPool.setSharePrice(toEther(1))
    assert.isTrue(fromEther(await hub.canStake(vault.target)) > 0)

    // Returns 0 when fees overdue
    await adapter.setTotalDeposits(toEther(1030))
    await vault.updateTotalValue()
    await hub.setMaxFeeOverduePeriod(10)
    await networkHelpers.time.increase(11)
    assert.equal(fromEther(await hub.canStake(vault.target)), 0)
  })

  it('canWithdraw should work correctly', async () => {
    const { hub, vault, adapter, stakingPool, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(500))
    await vault.updateTotalValue()

    // type(uint256).max for disconnected vault
    assert.equal(await hub.canWithdraw(ethers.ZeroAddress), ethers.MaxUint256)

    // No liability — min(500 idle, 1000 unlocked) = 500
    assert.equal(fromEther(await hub.canWithdraw(vault.target)), 500)

    // Locked limits withdrawable — min(500 idle, 160 unlocked) = 160
    await hub.mintLST(vault.target, accounts[0], toEther(100))
    await stakingPool.setSharePrice(toEther(7))
    assert.equal(fromEther(await hub.canWithdraw(vault.target)), 160)

    // Fully locked — min(500 idle, 0 unlocked) = 0
    await stakingPool.setSharePrice(toEther(10))
    assert.equal(fromEther(await hub.canWithdraw(vault.target)), 0)
    await stakingPool.setSharePrice(toEther(1))

    // Returns 0 when quarantined
    assert.isTrue(fromEther(await hub.canWithdraw(vault.target)) > 0)
    await adapter.setTotalDeposits(toEther(50000))
    await vault.updateTotalValue()
    assert.equal(fromEther(await hub.canWithdraw(vault.target)), 0)
    await adapter.setTotalDeposits(toEther(500))
    await hub.unquarantine(vault.target, toEther(1000))
    await vault.updateTotalValue()

    // Returns 0 when stale
    assert.isTrue(fromEther(await hub.canWithdraw(vault.target)) > 0)
    await networkHelpers.time.increase(86401)
    assert.equal(fromEther(await hub.canWithdraw(vault.target)), 0)
    await vault.updateTotalValue()

    // Returns 0 when unhealthy
    assert.isTrue(fromEther(await hub.canWithdraw(vault.target)) > 0)
    await stakingPool.setSharePrice(toEther(1000))
    assert.equal(fromEther(await hub.canWithdraw(vault.target)), 0)
    await stakingPool.setSharePrice(toEther(1))

    // Returns 0 when fees overdue
    assert.isTrue(fromEther(await hub.canWithdraw(vault.target)) > 0)
    await adapter.setTotalDeposits(toEther(530))
    await vault.updateTotalValue()
    await hub.setMaxFeeOverduePeriod(10)
    await networkHelpers.time.increase(11)
    assert.equal(fromEther(await hub.canWithdraw(vault.target)), 0)
  })

  // Fee Settlement

  it('settleFees should work correctly', async () => {
    const { hub, vault, adapter, stakingPool, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()

    // Accrue yield fees — 40 yield * 10% = 4
    await adapter.setTotalDeposits(toEther(1030))
    await vault.updateTotalValue()
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 4)

    // Settle — pulls tokens, mints LST, distributes to fee receiver
    await expect(hub.settleFees([vault.target]))
      .to.emit(hub, 'FeeSettled')
      .withArgs(vault.target, toEther(4))
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[5])), 4)

    // lastFeeSettledTimestamp updated on full settlement
    assert.isTrue(Number((await hub.vaults(vault.target)).lastFeeSettledTimestamp) > 0)

    // Reverts when no fees settled
    await expect(hub.settleFees([vault.target])).to.be.revertedWithCustomError(hub, 'NoFeesSettled')

    // Reverts if vault is disconnected
    await hub.disconnectVault(vault.target, true)
    await expect(hub.settleFees([vault.target])).to.be.revertedWithCustomError(
      hub,
      'VaultNotConnected'
    )
  })

  it('settleFees should partially settle and not reset overdue timer', async () => {
    const { hub, vault, adapter } = await loadFixture(deployFixture)

    // Stake almost everything — leave minimal idle
    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(998))
    await vault.updateTotalValue()

    // Accrue fees larger than idle — 40 yield * 10% = 4, idle = 2
    await adapter.setTotalDeposits(toEther(1038))
    await vault.updateTotalValue()
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 4)

    // Partial settle — only 2 of 4 settled
    const tsBefore = Number((await hub.vaults(vault.target)).lastFeeSettledTimestamp)
    await hub.settleFees([vault.target])
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 2)

    // Timer NOT reset on partial settlement
    assert.equal(Number((await hub.vaults(vault.target)).lastFeeSettledTimestamp), tsBefore)
  })

  it('settleFees should distribute to multiple receivers', async () => {
    const { hub, vault, adapter, stakingPool, accounts } = await loadFixture(deployFixture)

    // Set up two fee receivers — 60/40 split
    await hub.updateVaultFees(vault.target, [
      { receiver: accounts[6], basisPoints: 600 },
      { receiver: accounts[7], basisPoints: 400 },
    ])

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()
    await adapter.setTotalDeposits(toEther(1030))
    await vault.updateTotalValue()

    await hub.settleFees([vault.target])

    // 60/40 split — 4 total fees: 2.4 and 1.6
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[6])), 2.4)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[7])), 1.6)
  })

  it('settleFees should handle multiple vaults and aggregate receivers', async () => {
    const { hub, vault, adapter, stakingPool, token, factory, accounts } = await loadFixture(
      deployFixture
    )

    // Deploy second vault with SAME fee receiver as vault1 (accounts[5])
    const vault2 = (await deployUpgradeable(
      'StakingVault',
      [accounts[0], accounts[0], accounts[0]],
      {
        constructorArgs: [token.target, hub.target, factory.target],
        unsafeAllow: ['state-variable-immutable', 'constructor'],
      }
    )) as StakingVault
    await factory.setDeployedVault(vault2.target, true)
    await token.approve(vault2.target, ethers.MaxUint256)
    const adapter2 = (await deploy('StakingAdapterMock', [
      vault2.target,
      token.target,
    ])) as StakingAdapterMock
    await factory.setDeployedAdapter(adapter2.target, true)
    await vault2.addAdapter(adapter2.target)
    await hub.connectVault(vault2.target, 2000, 5000, 100, 650, true, toEther(500000), [
      { receiver: accounts[5], basisPoints: 1000 },
    ])

    // Accrue fees on both vaults
    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()
    await adapter.setTotalDeposits(toEther(1030))
    await vault.updateTotalValue()

    await vault2.deposit(toEther(500))
    await vault2.stake(adapter2.target, toEther(490))
    await vault2.updateTotalValue()
    await adapter2.setTotalDeposits(toEther(515))
    await vault2.updateTotalValue()

    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 4)
    assert.equal(fromEther(await hub.unsettledFees(vault2.target)), 2.5)

    // Settle both — same receiver gets aggregated total (4 + 2.5 = 6.5)
    await hub.settleFees([vault.target, vault2.target])
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 0)
    assert.equal(fromEther(await hub.unsettledFees(vault2.target)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[5])), 6.5)
  })

  it('unsettledFees should work correctly', async () => {
    const { hub, vault, adapter } = await loadFixture(deployFixture)

    // Zero before any fees
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 0)

    // Increases after yield accrual
    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()
    await adapter.setTotalDeposits(toEther(1030))
    await vault.updateTotalValue()
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 4)

    // Decreases after settlement
    await hub.settleFees([vault.target])
    assert.equal(fromEther(await hub.unsettledFees(vault.target)), 0)

    // Zero for disconnected vault
    assert.equal(fromEther(await hub.unsettledFees(ethers.ZeroAddress)), 0)
  })

  it('settleableFees should work correctly', async () => {
    const { hub, vault, adapter } = await loadFixture(deployFixture)

    // Zero before any fees
    assert.equal(fromEther(await hub.settleableFees(vault.target)), 0)

    // Idle > unsettled — returns unsettled
    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()
    await adapter.setTotalDeposits(toEther(1030))
    await vault.updateTotalValue()
    // idle = 10, unsettled = 4
    assert.equal(fromEther(await hub.settleableFees(vault.target)), 4)

    // Idle < unsettled — returns idle
    await hub.settleFees([vault.target])
    await adapter.setTotalDeposits(toEther(1040))
    await vault.updateTotalValue()
    // idle = 6 (settle pulled 4), unsettled = 1
    assert.equal(
      fromEther(await hub.settleableFees(vault.target)),
      fromEther(await hub.unsettledFees(vault.target))
    )

    // Zero for disconnected vault
    assert.equal(fromEther(await hub.settleableFees(ethers.ZeroAddress)), 0)
  })

  it('isFeesOverdue should work correctly', async () => {
    const { hub, vault, adapter } = await loadFixture(deployFixture)

    // False when no fees
    assert.equal(await hub.isFeesOverdue(vault.target), false)

    // False when fees exist but within overdue period
    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()
    await adapter.setTotalDeposits(toEther(1030))
    await vault.updateTotalValue()
    assert.isTrue(fromEther(await hub.unsettledFees(vault.target)) > 0)
    assert.equal(await hub.isFeesOverdue(vault.target), false)

    // True when past overdue period
    await hub.setMaxFeeOverduePeriod(10)
    await networkHelpers.time.increase(11)
    assert.equal(await hub.isFeesOverdue(vault.target), true)

    // False after full settlement resets timer
    await vault.updateTotalValue()
    await hub.settleFees([vault.target])
    assert.equal(await hub.isFeesOverdue(vault.target), false)

    // False when maxFeeOverduePeriod is 0 (disabled)
    await adapter.setTotalDeposits(toEther(1040))
    await vault.updateTotalValue()
    await hub.setMaxFeeOverduePeriod(0)
    await networkHelpers.time.increase(999999)
    assert.equal(await hub.isFeesOverdue(vault.target), false)
  })

  it('minIdleBalance should work correctly', async () => {
    const { hub, vault, adapter } = await loadFixture(deployFixture)

    // Zero before any report (totalValue = 0)
    assert.equal(fromEther(await hub.minIdleBalance(vault.target)), 0)

    // Returns totalValue * minIdleRatio / 10000
    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()
    // totalValue = 1000, minIdleRatio = 100 (1%), minIdle = 10
    assert.equal(fromEther(await hub.minIdleBalance(vault.target)), 10)

    // Zero when minIdleRatio is 0
    await hub.updateConnection(vault.target, 2000, 5000, 0, 650, true, toEther(500000))
    assert.equal(fromEther(await hub.minIdleBalance(vault.target)), 0)

    // Zero for disconnected vault
    assert.equal(fromEther(await hub.minIdleBalance(ethers.ZeroAddress)), 0)
  })

  // Force Rebalance & Bad Debt

  it('forceRebalance should work correctly', async () => {
    const { hub, vault, adapter, token, stakingPool, signers, accounts } = await loadFixture(
      deployFixture
    )

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()
    await hub.mintLST(vault.target, accounts[0], toEther(100))

    // Revert if vault is healthy
    await expect(hub.forceRebalance(vault.target)).to.be.revertedWithCustomError(
      hub,
      'VaultHealthy'
    )

    // Make vault unhealthy via share price increase
    await stakingPool.setSharePrice(toEther(100))
    assert.equal(await hub.isHealthy(vault.target), false)

    // Allow adapter to unstake
    await adapter.setUnstakeableAmount(toEther(990))

    // Force rebalance — permissionless
    await expect((hub.connect(signers[3]) as any).forceRebalance(vault.target)).to.emit(
      hub,
      'ForceRebalanced'
    )
    // Recovered ~1000 tokens, at price 100 = 10 shares burned. 100 - 10 = 90 shares * 100 = 9000
    assert.equal(fromEther(await hub.liability(vault.target)), 9000)
    assert.equal(fromEther(await hub.totalLiabilityShares()), 90)
    assert.equal(fromEther(await token.balanceOf(stakingPool.target)), 1000)

    // Revert if vault not connected
    await expect(hub.forceRebalance(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      hub,
      'VaultNotConnected'
    )

    // Revert if vault is stale
    await networkHelpers.time.increase(86401)
    await expect(hub.forceRebalance(vault.target)).to.be.revertedWithCustomError(hub, 'VaultStale')
  })

  it('internalizeBadDebt should work correctly', async () => {
    const { hub, vault, adapter, stakingPool, signers, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(1000))
    await vault.stake(adapter.target, toEther(990))
    await vault.updateTotalValue()
    await hub.mintLST(vault.target, accounts[0], toEther(100))

    // Revert if vault is not insolvent
    await expect(
      hub.internalizeBadDebt(vault.target, toEther(1000))
    ).to.be.revertedWithCustomError(hub, 'VaultNotInsolvent')

    // Make insolvent — liability = 100 * 20 = 2000 > totalValue = 1000
    await stakingPool.setSharePrice(toEther(20))
    await vault.updateTotalValue()

    // Partial internalization with maxAmount = 500
    await expect(hub.internalizeBadDebt(vault.target, toEther(500)))
      .to.emit(hub, 'BadDebtInternalized')
      .withArgs(vault.target, toEther(500))
    assert.equal(fromEther(await hub.totalBadDebt()), 500)
    // 500 tokens / 20 price = 25 shares burned. 100 - 25 = 75
    assert.equal(fromEther(await hub.totalLiabilityShares()), 75)
    // Pool writeDown called with shortfall
    assert.equal(fromEther(await stakingPool.lastWriteDownAmount()), 500)

    // Full internalization of remaining shortfall
    await vault.updateTotalValue()
    await hub.internalizeBadDebt(vault.target, toEther(10000))
    assert.equal(fromEther(await hub.totalBadDebt()), 1000)

    // Fee tracking reset
    const record = await hub.vaults(vault.target)
    assert.equal(record.lastFeeableYield.toString(), '0')

    // Revert if stale
    await stakingPool.setSharePrice(toEther(100))
    await networkHelpers.time.increase(86401)
    await expect(
      hub.internalizeBadDebt(vault.target, toEther(1000))
    ).to.be.revertedWithCustomError(hub, 'VaultStale')

    // Revert if not owner
    await expect(
      (hub.connect(signers[1]) as any).internalizeBadDebt(vault.target, toEther(1000))
    ).to.be.revertedWith('Ownable: caller is not the owner')

    // Revert if vault not connected
    await expect(
      hub.internalizeBadDebt(ethers.ZeroAddress, toEther(1000))
    ).to.be.revertedWithCustomError(hub, 'VaultNotConnected')
  })

  // Admin

  it('setMaxValueChangePercent should work correctly', async () => {
    const { hub, signers } = await loadFixture(deployFixture)

    await hub.setMaxValueChangePercent(1000)
    assert.equal(Number(await hub.maxValueChangePercent()), 1000)

    await expect(
      (hub.connect(signers[1]) as any).setMaxValueChangePercent(1000)
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('setMaxStalenessSeconds should work correctly', async () => {
    const { hub, signers } = await loadFixture(deployFixture)

    await hub.setMaxStalenessSeconds(172800)
    assert.equal(Number(await hub.maxStalenessSeconds()), 172800)

    await expect(
      (hub.connect(signers[1]) as any).setMaxStalenessSeconds(172800)
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('setMaxFeeOverduePeriod should work correctly', async () => {
    const { hub, signers } = await loadFixture(deployFixture)

    await hub.setMaxFeeOverduePeriod(1209600)
    assert.equal(Number(await hub.maxFeeOverduePeriod()), 1209600)

    await expect(
      (hub.connect(signers[1]) as any).setMaxFeeOverduePeriod(1209600)
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('setGlobalShareLimit should work correctly', async () => {
    const { hub, signers } = await loadFixture(deployFixture)

    await hub.setGlobalShareLimit(toEther(5000000))
    assert.equal(fromEther(await hub.globalShareLimit()), 5000000)

    await expect(
      (hub.connect(signers[1]) as any).setGlobalShareLimit(toEther(5000000))
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })
})
