import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import {
  ERC20,
  MetisLockingInfoMock,
  MetisLockingPoolMock,
  SequencerVaultV2Mock,
  L1Strategy,
} from '../../typechain-types'
import { Interface } from 'ethers'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

describe('L1Strategy', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Metis',
      'METIS',
      1000000000,
    ])) as ERC20
    adrs.token = await token.getAddress()

    const metisLockingInfo = (await deploy('MetisLockingInfoMock', [
      adrs.token,
      toEther(100),
      toEther(1000),
    ])) as MetisLockingInfoMock
    adrs.metisLockingInfo = await metisLockingInfo.getAddress()

    const metisLockingPool = (await deploy('MetisLockingPoolMock', [
      adrs.token,
      adrs.metisLockingInfo,
      86400,
    ])) as MetisLockingPoolMock
    adrs.metisLockingPool = await metisLockingPool.getAddress()

    let vaultImplementation = await deployImplementation('SequencerVault')

    const strategy = (await deployUpgradeable('L1Strategy', [
      adrs.token,
      adrs.metisLockingInfo,
      vaultImplementation,
      accounts[1],
      toEther(500),
      1000,
    ])) as L1Strategy
    adrs.strategy = await strategy.getAddress()

    await metisLockingInfo.setManager(adrs.metisLockingPool)
    await strategy.setL1Transmitter(accounts[0])

    for (let i = 0; i < 5; i++) {
      await strategy.addVault('0x5555', accounts[1], accounts[i])
    }

    const vaults = await strategy.getVaults()

    await token.approve(adrs.strategy, ethers.MaxUint256)

    return {
      signers,
      accounts,
      adrs,
      token,
      metisLockingInfo,
      metisLockingPool,
      strategy,
      vaults,
    }
  }

  it('getVaults should work correctly', async () => {
    const { strategy, vaults } = await loadFixture(deployFixture)

    assert.deepEqual(await strategy.getVaults(), vaults)
  })

  it('should be able to add vault', async () => {
    const { accounts, adrs, strategy } = await loadFixture(deployFixture)

    await strategy.addVault('0x6666', accounts[2], accounts[5])
    assert.equal((await strategy.getVaults()).length, 6)
    let vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[5])
    assert.equal(await vault.token(), adrs.token)
    assert.equal(await vault.vaultController(), adrs.strategy)
    assert.equal(await vault.lockingPool(), adrs.metisLockingPool)
    assert.equal(await vault.pubkey(), '0x6666')
    assert.equal((await vault.getFunction('signer')()) as any, accounts[2])
    assert.equal(Number(await vault.seqId()), 0)
    assert.equal(await vault.rewardsReceiver(), accounts[5])
  })

  it('deposit should work correctly', async () => {
    const { adrs, strategy, token } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(50))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 50)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 50)

    await strategy.deposit(toEther(200))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 250)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 250)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 250)
  })

  it('depositQueuedTokens should work correctly', async () => {
    const { adrs, strategy, token } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(5000))
    await strategy.depositQueuedTokens([1, 4], [toEther(500), toEther(700)])

    assert.equal(fromEther(await strategy.getTotalDeposits()), 5000)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 3800)
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3800)
    assert.equal(fromEther(await token.balanceOf(adrs.metisLockingInfo)), 1200)

    let vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[1])
    assert.equal(fromEther(await vault.getTotalDeposits()), 500)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 500)

    vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[4])
    assert.equal(fromEther(await vault.getTotalDeposits()), 700)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 700)
  })

  it('withdraw should work correctly', async () => {
    const { adrs, strategy, token, metisLockingPool } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(5000))
    await strategy.depositQueuedTokens([1, 4], [toEther(500), toEther(700)])

    await strategy.withdraw(toEther(500))

    assert.equal(fromEther(await strategy.getTotalDeposits()), 4500)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 3300)
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3300)
    assert.equal(fromEther(await token.balanceOf(adrs.metisLockingInfo)), 1200)

    let vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[1])
    assert.equal(fromEther(await vault.getTotalDeposits()), 500)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 500)

    vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[4])
    assert.equal(fromEther(await vault.getTotalDeposits()), 700)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 700)

    await metisLockingPool.incrementCurrentBatch()
    await strategy.withdraw(toEther(3400))

    assert.equal(fromEther(await strategy.getTotalDeposits()), 1100)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 0)
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 0)
    assert.equal(fromEther(await token.balanceOf(adrs.metisLockingInfo)), 1100)

    assert.equal(fromEther(await vault.getTotalDeposits()), 600)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 600)

    await strategy.initiateExit(1)
    await time.increase(90000)
    await strategy.withdraw(toEther(200))

    assert.equal(fromEther(await strategy.getTotalDeposits()), 900)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 300)
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 300)
    assert.equal(fromEther(await token.balanceOf(adrs.metisLockingInfo)), 600)

    vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[1])
    assert.equal(fromEther(await vault.getTotalDeposits()), 0)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 0)
  })

  it('getDepositChange should work correctly', async () => {
    const { adrs, strategy, token, metisLockingPool } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(5000))
    await strategy.depositQueuedTokens([1, 4], [toEther(500), toEther(700)])

    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await metisLockingPool.addReward(1, toEther(100))
    assert.equal(fromEther(await strategy.getDepositChange()), 100)

    await metisLockingPool.addReward(2, toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 150)

    await token.transfer(adrs.strategy, toEther(25))
    assert.equal(fromEther(await strategy.getDepositChange()), 175)

    await strategy.updateDeposits(0, 0)
    await metisLockingPool.addReward(1, toEther(50))
    await metisLockingPool.slashPrincipal(2, toEther(60))
    assert.equal(fromEther(await strategy.getDepositChange()), -10)
  })

  it('getMaxDeposits and getMinDeposits should work correctly', async () => {
    const { strategy, metisLockingPool } = await loadFixture(deployFixture)

    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0)

    await strategy.deposit(toEther(2000))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0)

    await strategy.depositQueuedTokens([1, 4], [toEther(500), toEther(300)])
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 800)

    await metisLockingPool.incrementCurrentBatch()
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 200)

    await strategy.deposit(toEther(3000))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 200)

    await strategy.initiateExit(1)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 4000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 600)
  })

  it('updateDeposits should work correctly', async () => {
    const { adrs, accounts, strategy, token, metisLockingPool } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(400))
    await strategy.depositQueuedTokens([1, 4], [toEther(200), toEther(200)])

    let retValues = await strategy.updateDeposits.staticCall(0, 0)
    assert.equal(fromEther(retValues[0]), 400)
    assert.equal(fromEther(retValues[1]), 0)
    assert.deepEqual(retValues[2], accounts.slice(0, 5))
    assert.deepEqual(
      retValues[3].map((v) => fromEther(v)),
      [0, 0, 0, 0, 0]
    )
    await strategy.updateDeposits(0, 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 0)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await metisLockingPool.addReward(1, toEther(100))
    retValues = await strategy.updateDeposits.staticCall(0, 0)
    assert.equal(fromEther(retValues[0]), 500)
    assert.equal(fromEther(retValues[1]), 0)
    assert.deepEqual(retValues[2], accounts.slice(0, 5))
    assert.deepEqual(
      retValues[3].map((v) => fromEther(v)),
      [0, 10, 0, 0, 0]
    )
    await strategy.updateDeposits(0, 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 0)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await metisLockingPool.addReward(2, toEther(50))
    retValues = await strategy.updateDeposits.staticCall(0, 0)
    assert.equal(fromEther(retValues[0]), 550)
    assert.equal(fromEther(retValues[1]), 0)
    assert.deepEqual(retValues[2], accounts.slice(0, 5))
    assert.deepEqual(
      retValues[3].map((v) => fromEther(v)),
      [0, 0, 0, 0, 5]
    )
    await strategy.updateDeposits(0, 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 0)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await token.transfer(adrs.strategy, toEther(90))
    retValues = await strategy.updateDeposits.staticCall(0, 0)
    assert.equal(fromEther(retValues[0]), 640)
    assert.equal(fromEther(retValues[1]), 0)
    assert.deepEqual(retValues[2], accounts.slice(0, 5))
    assert.deepEqual(
      retValues[3].map((v) => fromEther(v)),
      [0, 0, 0, 0, 0]
    )
    await strategy.updateDeposits(0, 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 640)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 90)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
  })

  it('updateDeposits should work correctly with slashing', async () => {
    const { accounts, strategy, metisLockingPool } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(400))
    await strategy.depositQueuedTokens([1, 4], [toEther(200), toEther(200)])

    await metisLockingPool.addReward(2, toEther(100))
    let retValues = await strategy.updateDeposits.staticCall(0, 0)
    assert.equal(fromEther(retValues[0]), 500)
    assert.equal(fromEther(retValues[1]), 0)
    assert.deepEqual(retValues[2], accounts.slice(0, 5))
    assert.deepEqual(
      retValues[3].map((v) => fromEther(v)),
      [0, 0, 0, 0, 10]
    )
    await strategy.updateDeposits(0, 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 0)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await metisLockingPool.slashPrincipal(2, toEther(50))
    retValues = await strategy.updateDeposits.staticCall(0, 0)
    assert.equal(fromEther(retValues[0]), 450)
    assert.equal(fromEther(retValues[1]), 0)
    assert.deepEqual(retValues[2], accounts.slice(0, 5))
    assert.deepEqual(
      retValues[3].map((v) => fromEther(v)),
      [0, 0, 0, 0, 0]
    )
    await strategy.updateDeposits(0, 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 450)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 0)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await metisLockingPool.slashPrincipal(2, toEther(50))
    await metisLockingPool.addReward(1, toEther(20))
    retValues = await strategy.updateDeposits.staticCall(0, 0)
    assert.equal(fromEther(retValues[0]), 420)
    assert.equal(fromEther(retValues[1]), 0)
    assert.deepEqual(retValues[2], accounts.slice(0, 5))
    assert.deepEqual(
      retValues[3].map((v) => fromEther(v)),
      [0, 2, 0, 0, 0]
    )
    await strategy.updateDeposits(0, 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 420)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 0)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await metisLockingPool.addReward(2, toEther(100))
    retValues = await strategy.updateDeposits.staticCall(0, 0)
    assert.equal(fromEther(retValues[0]), 520)
    assert.equal(fromEther(retValues[1]), 0)
    assert.deepEqual(retValues[2], accounts.slice(0, 5))
    assert.deepEqual(
      retValues[3].map((v) => fromEther(v)),
      [0, 0, 0, 0, 0]
    )
    await strategy.updateDeposits(0, 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 520)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 0)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
  })

  it('updateDeposits should work correctly with reward withdrawals', async () => {
    const { accounts, strategy, metisLockingInfo, metisLockingPool } = await loadFixture(
      deployFixture
    )

    await strategy.deposit(toEther(1000))
    await metisLockingInfo.setMaxLock(toEther(100))
    await strategy.setMinRewardsToClaim(toEther(7))
    await strategy.depositQueuedTokens(
      [0, 1, 2, 3, 4],
      [toEther(100), toEther(100), toEther(100), toEther(100), toEther(100)]
    )

    await metisLockingPool.addReward(1, toEther(5))
    await metisLockingPool.addReward(2, toEther(7))
    await metisLockingPool.addReward(3, toEther(8))
    let retValues = await strategy.updateDeposits.staticCall(10, 10, { value: 100 })
    assert.equal(fromEther(retValues[0]), 1005)
    assert.equal(fromEther(retValues[1]), 15)
    assert.deepEqual(retValues[2], accounts.slice(0, 5))
    assert.deepEqual(
      retValues[3].map((v) => fromEther(v)),
      [0.5, 0.7, 0.8, 0, 0]
    )
    await strategy.updateDeposits(10, 10, { value: 100 })
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1005)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 500)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await metisLockingInfo.setMaxLock(toEther(110))
    await metisLockingPool.addReward(1, toEther(7))
    await metisLockingPool.addReward(4, toEther(9))
    await metisLockingPool.addReward(5, toEther(6))
    retValues = await strategy.updateDeposits.staticCall(10, 10, { value: 100 })
    assert.equal(fromEther(retValues[0]), 1015)
    assert.equal(fromEther(retValues[1]), 12)
    assert.deepEqual(retValues[2], accounts.slice(0, 5))
    assert.deepEqual(
      retValues[3].map((v) => fromEther(v)),
      [0.7, 0, 0, 0.9, 0.6]
    )
    await strategy.updateDeposits(10, 10, { value: 100 })
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1015)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 500)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
  })

  it('initiateExit should work correctly', async () => {
    const { strategy, metisLockingPool, vaults } = await loadFixture(deployFixture)

    const vault = await ethers.getContractAt('SequencerVault', vaults[1])

    await strategy.deposit(toEther(500))
    await strategy.depositQueuedTokens(
      [0, 1, 2, 3, 4],
      [toEther(100), toEther(100), toEther(100), toEther(100), toEther(100)]
    )
    await metisLockingPool.addReward(2, toEther(100))
    await strategy.updateDeposits(0, 0)

    await expect(strategy.initiateExit(1)).to.be.revertedWithCustomError(
      vault,
      'UnclaimedRewards()'
    )

    await strategy.setMinRewardsToClaim(1)
    await strategy.updateDeposits(10, 10, { value: 100 })
    await strategy.initiateExit(1)

    assert.equal(
      Number(await vault.exitDelayEndTime()),
      ((await ethers.provider.getBlock('latest'))?.timestamp || 0) + 86400
    )
    assert.equal(
      Number(await metisLockingPool.seqUnlockTimes(2)),
      ((await ethers.provider.getBlock('latest'))?.timestamp || 0) + 86400
    )

    await expect(strategy.initiateExit(1)).to.be.revertedWithCustomError(
      vault,
      'SequencerStopped()'
    )
  })

  it('finalizeExit should work correctly', async () => {
    const { adrs, strategy, metisLockingPool, vaults, token } = await loadFixture(deployFixture)

    const vault = await ethers.getContractAt('SequencerVault', vaults[1])

    await expect(strategy.finalizeExit(1)).to.be.revertedWithCustomError(
      vault,
      'ExitDelayTimeNotElapsed()'
    )

    await strategy.deposit(toEther(500))
    await strategy.depositQueuedTokens(
      [0, 1, 2, 3, 4],
      [toEther(100), toEther(100), toEther(100), toEther(100), toEther(100)]
    )
    await metisLockingPool.addReward(2, toEther(100))
    await strategy.setMinRewardsToClaim(1)
    await strategy.updateDeposits(10, 10, { value: 100 })
    await strategy.initiateExit(1)
    await metisLockingPool.addReward(2, toEther(50))

    await expect(strategy.finalizeExit(1)).to.be.revertedWithCustomError(
      vault,
      'ExitDelayTimeNotElapsed()'
    )

    await time.increase(90000)
    await expect(strategy.finalizeExit(1)).to.be.revertedWithCustomError(
      vault,
      'UnclaimedRewards()'
    )

    await strategy.updateDeposits(10, 10, { value: 100 })
    await strategy.finalizeExit(1)

    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 200)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 600)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 200)
    assert.deepEqual(await strategy.getVaults(), [vaults[0], ...vaults.slice(2)])
  })

  it('setOperatorRewardPercentage should work correctly', async () => {
    const { strategy } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(300))
    await strategy.depositQueuedTokens([0], [toEther(300)])

    await expect(strategy.setOperatorRewardPercentage(10001)).to.be.revertedWithCustomError(
      strategy,
      'FeesTooLarge()'
    )
    await strategy.setOperatorRewardPercentage(1500)
    assert.equal(Number(await strategy.operatorRewardPercentage()), 1500)
  })

  it('upgradeVaults should work correctly', async () => {
    const { strategy, vaults } = await loadFixture(deployFixture)

    let vaultInterface = (await ethers.getContractFactory('SequencerVaultV2Mock'))
      .interface as Interface

    let newVaultImplementation = (await deployImplementation('SequencerVaultV2Mock')) as string
    await strategy.setVaultImplementation(newVaultImplementation)

    await strategy.upgradeVaults([0, 1], ['0x', '0x'])
    for (let i = 0; i < 2; i++) {
      let vault = (await ethers.getContractAt(
        'SequencerVaultV2Mock',
        vaults[i]
      )) as SequencerVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
    }

    await strategy.upgradeVaults(
      [2, 3],
      [
        vaultInterface.encodeFunctionData('initializeV2', [2]),
        vaultInterface.encodeFunctionData('initializeV2', [3]),
      ]
    )
    for (let i = 2; i < 4; i++) {
      let vault = (await ethers.getContractAt(
        'SequencerVaultV2Mock',
        vaults[i]
      )) as SequencerVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
      assert.equal(Number(await vault.getVersion()), i)
    }
  })

  it('setVaultImplementation should work correctly', async () => {
    const { accounts, strategy } = await loadFixture(deployFixture)

    await expect(strategy.setVaultImplementation(accounts[0])).to.be.revertedWithCustomError(
      strategy,
      'AddressNotContract()'
    )

    let newVaultImplementation = (await deployImplementation('SequencerVault')) as string
    await strategy.setVaultImplementation(newVaultImplementation)
    assert.equal(await strategy.vaultImplementation(), newVaultImplementation)
  })
})
