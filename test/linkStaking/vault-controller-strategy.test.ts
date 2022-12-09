import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { BigNumber } from 'ethers'
import {
  toEther,
  deploy,
  deployUpgradeable,
  deployImplementation,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import {
  ERC677,
  OperatorVault,
  VCSMock,
  StakingMock,
  OperatorVaultV2Mock,
} from '../../typechain-types'
import { Interface } from 'ethers/lib/utils'

const encode = (data: any) => ethers.utils.defaultAbiCoder.encode(['uint'], [data])

describe('VaultControllerStrategy', () => {
  let token: ERC677
  let staking: StakingMock
  let strategy: VCSMock
  let vaults: string[]
  let vaultContracts: OperatorVault[]
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    staking = (await deploy('StakingMock', [token.address])) as StakingMock
    let vaultImplementation = await deployImplementation('OperatorVault')

    strategy = (await deployUpgradeable('VCSMock', [
      token.address,
      accounts[0],
      staking.address,
      vaultImplementation,
      toEther(1000),
      [[accounts[4], 500]],
    ])) as VCSMock

    vaults = []
    vaultContracts = []
    for (let i = 0; i < 10; i++) {
      let vault = (await deployUpgradeable('OperatorVault', [
        token.address,
        strategy.address,
        staking.address,
        accounts[0],
      ])) as OperatorVault
      vaultContracts.push(vault)
      vaults.push(vault.address)
    }

    for (let i = 0; i < 10; i++) {
      vaultContracts[i].transferOwnership(strategy.address)
    }

    await strategy.addVaults(vaults)
    await token.approve(strategy.address, ethers.constants.MaxUint256)
  })

  it('should be able to get vaults', async () => {
    assert.deepEqual(await strategy.getVaults(), vaults)
  })

  it('should be able to deposit', async () => {
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 100)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 100)
    assert.equal(fromEther(await strategy.getBufferedDeposits()), 100)
  })

  it('should not be able to withdraw', async () => {
    await strategy.deposit(toEther(100))
    await expect(strategy.withdraw(toEther(10))).to.be.revertedWith(
      'withdrawals not yet implemented'
    )
  })

  it('depositBufferedTokens should work correctly', async () => {
    await strategy.deposit(toEther(1000))
    await expect(strategy.depositBufferedTokens(1)).to.be.revertedWith(
      'Cannot deposit into vault if lower index vault is not full'
    )

    await strategy.depositBufferedTokens(0)
    assert.equal(fromEther(await staking.getStake(vaults[0])), 1000)

    await strategy.deposit(toEther(50000))
    await expect(strategy.depositBufferedTokens(1)).to.be.revertedWith(
      'Cannot deposit into vault if lower index vault is not full'
    )

    await strategy.depositBufferedTokens(0)
    assert.equal(fromEther(await staking.getStake(vaults[0])), 50000)
    assert.equal(fromEther(await staking.getStake(vaults[1])), 1000)

    await strategy.deposit(toEther(50000))
    await expect(strategy.depositBufferedTokens(2)).to.be.revertedWith(
      'Cannot deposit into vault if lower index vault is not full'
    )
    await expect(strategy.depositBufferedTokens(0)).to.be.revertedWith(
      'Cannot deposit into vault that is full'
    )

    await strategy.depositBufferedTokens(1)
    assert.equal(fromEther(await staking.getStake(vaults[1])), 50000)
    assert.equal(fromEther(await staking.getStake(vaults[2])), 1000)

    assert.equal(fromEther(await strategy.getTotalDeposits()), 101000)
    assert.equal(fromEther(await strategy.getBufferedDeposits()), 0)
  })

  it('performUpkeep should work correctly', async () => {
    await strategy.deposit(toEther(999))
    await expect(strategy.performUpkeep(encode(0))).to.be.revertedWith(
      'Minimum deposit threshold has not been met'
    )

    await strategy.deposit(toEther(49001))
    await strategy.performUpkeep(encode(0))
    assert.equal(fromEther(await staking.getStake(vaults[0])), 50000)

    await strategy.deposit(toEther(1000))
    await strategy.performUpkeep(encode(1))
    assert.equal(fromEther(await staking.getStake(vaults[1])), 1000)
  })

  it('checkUpkeep should work correctly', async () => {
    await strategy.deposit(toEther(999))
    assert.deepEqual(await strategy.checkUpkeep('0x'), [false, '0x'])

    await strategy.deposit(toEther(1))
    assert.deepEqual(await strategy.checkUpkeep('0x'), [true, encode('0')])

    await staking.setActive(false)
    assert.deepEqual(await strategy.checkUpkeep('0x'), [false, '0x'])

    await staking.setActive(true)
    await staking.setPaused(true)
    assert.deepEqual(await strategy.checkUpkeep('0x'), [false, '0x'])

    await staking.setPaused(false)
    assert.deepEqual(await strategy.checkUpkeep('0x'), [true, encode('0')])

    await strategy.deposit(toEther(52000))
    await strategy.performUpkeep(encode(0))
    await strategy.deposit(toEther(1000))
    assert.deepEqual(await strategy.checkUpkeep('0x'), [true, encode('1')])
  })

  it('depositToVaults should work correctly', async () => {
    await strategy.deposit(toEther(109))
    let deposited = await strategy.callStatic.depositToVaults(
      0,
      toEther(109),
      toEther(10),
      toEther(100)
    )
    await strategy.depositToVaults(0, toEther(109), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 100)
    assert.equal(fromEther(await staking.getStake(vaults[0])), 100)
    assert.equal(fromEther(await staking.getStake(vaults[1])), 0)

    await strategy.deposit(toEther(291))
    deposited = await strategy.callStatic.depositToVaults(
      0,
      toEther(300),
      toEther(10),
      toEther(100)
    )
    await strategy.depositToVaults(0, toEther(300), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 300)
    assert.equal(fromEther(await staking.getStake(vaults[0])), 100)
    assert.equal(fromEther(await staking.getStake(vaults[1])), 100)
    assert.equal(fromEther(await staking.getStake(vaults[2])), 100)
    assert.equal(fromEther(await staking.getStake(vaults[3])), 100)
    assert.equal(fromEther(await staking.getStake(vaults[4])), 0)
  })

  it('depositChange should work correctly', async () => {
    await strategy.deposit(toEther(300))
    await strategy.depositToVaults(0, toEther(300), toEther(10), toEther(100))
    await strategy.deposit(toEther(100))

    assert.equal(fromEther(await strategy.depositChange()), 0)

    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await strategy.depositChange()), 100)

    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await strategy.depositChange()), 150)

    await token.transfer(strategy.address, toEther(50))
    assert.equal(fromEther(await strategy.depositChange()), 200)
  })

  it('updateDeposits should work correctly', async () => {
    await strategy.deposit(toEther(300))
    await strategy.depositToVaults(0, toEther(300), toEther(10), toEther(100))
    await strategy.deposit(toEther(100))

    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await strategy.depositChange()), 0)

    await staking.setBaseReward(toEther(10))
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.depositChange()), 0)

    await staking.setDelegationReward(toEther(5))
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await strategy.depositChange()), 0)

    await token.transfer(strategy.address, toEther(20))
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getTotalDeposits()), 570)
    assert.equal(fromEther(await strategy.depositChange()), 0)
  })

  it('fees should be properly calculated in updateDeposits', async () => {
    await strategy.deposit(toEther(300))
    await strategy.depositToVaults(0, toEther(300), toEther(10), toEther(100))

    await staking.setBaseReward(toEther(10))
    await strategy.addFee(accounts[3], 1000)
    let [receivers, amounts] = await strategy.callStatic.updateDeposits()

    assert.equal(receivers[0], accounts[4])
    assert.equal(receivers[1], accounts[3])
    assert.equal(fromEther(amounts[0]), 5)
    assert.equal(fromEther(amounts[1]), 10)
  })

  it('migrateVaults should work correctly', async () => {
    await strategy.deposit(toEther(130000))
    await strategy.performUpkeep(encode(0))
    await staking.setMigration(accounts[3])
    await strategy.migrateVaults(0, 4, '0x00')
    assert.equal(fromEther(await token.balanceOf(accounts[3])), 140000)
    for (let i = 0; i < 4; i++) {
      assert.equal(
        await (await ethers.getContractAt('OperatorVault', vaults[i])).stakeController(),
        accounts[3]
      )
    }
  })

  it('deployVault should work correctly', async () => {
    let vaultInterface = (await ethers.getContractFactory('OperatorVault')).interface as Interface

    for (let i = 1; i < 5; i++) {
      await strategy.deployVault(
        vaultInterface.encodeFunctionData('initialize', [
          token.address,
          strategy.address,
          staking.address,
          accounts[i],
        ])
      )
    }

    let vaults = await strategy.getVaults()

    for (let i = 1; i < 5; i++) {
      let vault = (await ethers.getContractAt('OperatorVault', vaults[9 + i])) as OperatorVault
      assert.equal(await vault.operator(), accounts[i])
    }
  })

  it('upgradeVaults should work correctly', async () => {
    let vaultInterface = (await ethers.getContractFactory('OperatorVaultV2Mock'))
      .interface as Interface

    let newVaultImplementation = (await deployImplementation('OperatorVaultV2Mock')) as string
    await strategy.setVaultImplementation(newVaultImplementation)

    await strategy.upgradeVaults(0, 5, '0x')
    for (let i = 0; i < 5; i++) {
      let vault = (await ethers.getContractAt(
        'OperatorVaultV2Mock',
        vaults[i]
      )) as OperatorVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
    }

    await strategy.upgradeVaults(5, 5, vaultInterface.encodeFunctionData('initializeV2', [2]))
    for (let i = 5; i < 10; i++) {
      let vault = (await ethers.getContractAt(
        'OperatorVaultV2Mock',
        vaults[i]
      )) as OperatorVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
      assert.equal((await vault.getVersion()).toNumber(), 2)
    }
  })

  it('setMinDepositThreshold should work correctly', async () => {
    await expect(strategy.setMinDepositThreshold(toEther(9))).to.be.revertedWith(
      'Must be >= to minimum vault deposit limit'
    )

    await strategy.setMinDepositThreshold(toEther(20))
    assert.equal(fromEther(await strategy.minDepositThreshold()), 20)
  })

  it('setVaultImplementation should work correctly', async () => {
    await expect(strategy.setVaultImplementation(accounts[0])).to.be.revertedWith(
      'Address must belong to a contract'
    )

    let newVaultImplementation = (await deployImplementation('OperatorVault')) as string
    await strategy.setVaultImplementation(newVaultImplementation)
    assert.equal(await strategy.vaultImplementation(), newVaultImplementation)
  })
})
