import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
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
  CommunityVault,
  StakingRewardsMock,
  CommunityVaultV2Mock,
} from '../../typechain-types'
import { Interface } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('VaultControllerStrategy', () => {
  async function deployFixture() {
    const { accounts } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.token = await token.getAddress()
    await setupToken(token, accounts)

    const rewardsController = (await deploy('StakingRewardsMock', [
      adrs.token,
    ])) as StakingRewardsMock
    adrs.rewardsController = await rewardsController.getAddress()

    const stakingController = (await deploy('StakingMock', [
      adrs.token,
      adrs.rewardsController,
      toEther(10),
      toEther(100),
      toEther(10000),
    ])) as StakingMock
    adrs.stakingController = await stakingController.getAddress()

    let vaultImplementation = await deployImplementation('CommunityVault')

    const strategy = (await deployUpgradeable('VCSMock', [
      adrs.token,
      accounts[0],
      adrs.stakingController,
      vaultImplementation,
      [[accounts[4], 500]],
    ])) as VCSMock
    adrs.strategy = await strategy.getAddress()

    const vaults = []
    const vaultContracts = []
    for (let i = 0; i < 10; i++) {
      let vault = (await deployUpgradeable('CommunityVault', [
        adrs.token,
        adrs.strategy,
        adrs.stakingController,
        adrs.rewardsController,
      ])) as CommunityVault
      vaultContracts.push(vault)
      vaults.push(await vault.getAddress())
    }

    for (let i = 0; i < 10; i++) {
      vaultContracts[i].transferOwnership(adrs.strategy)
    }

    await strategy.addVaults(vaults)
    await token.approve(adrs.strategy, ethers.MaxUint256)

    return {
      accounts,
      adrs,
      token,
      rewardsController,
      stakingController,
      strategy,
      vaults,
      vaultContracts,
    }
  }

  it('getVaults should work correctly', async () => {
    const { strategy, vaults } = await loadFixture(deployFixture)

    assert.deepEqual(await strategy.getVaults(), vaults)
  })

  it('getVaultDepositLimits should work correctly', async () => {
    const { strategy } = await loadFixture(deployFixture)

    assert.deepEqual(
      (await strategy.getVaultDepositLimits()).map((v) => fromEther(v)),
      [10, 100]
    )
  })

  it('depositToVaults should work correctly', async () => {
    const { adrs, strategy, token, stakingController, rewardsController, vaults } =
      await loadFixture(deployFixture)

    await token.transfer(adrs.strategy, toEther(50))
    let deposited = await strategy.depositToVaults.staticCall(
      0,
      toEther(50),
      toEther(10),
      toEther(100)
    )
    await strategy.depositToVaults(0, toEther(50), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 50)
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 0)
    assert.equal(Number(await strategy.indexOfLastFullVault()), 0)

    await rewardsController.setReward(vaults[0], toEther(30))
    await token.transfer(adrs.strategy, toEther(200))
    deposited = await strategy.depositToVaults.staticCall(
      0,
      toEther(200),
      toEther(10),
      toEther(100)
    )
    await strategy.depositToVaults(0, toEther(200), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 200)
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 250)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 50)
    assert.equal(Number(await strategy.indexOfLastFullVault()), 1)

    await token.transfer(adrs.strategy, toEther(50))
    deposited = await strategy.depositToVaults.staticCall(0, toEther(50), toEther(10), toEther(100))
    await strategy.depositToVaults(0, toEther(50), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 50)
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 300)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[3])), 0)
    assert.equal(Number(await strategy.indexOfLastFullVault()), 2)

    await token.transfer(adrs.strategy, toEther(109))
    deposited = await strategy.depositToVaults.staticCall(
      0,
      toEther(109),
      toEther(10),
      toEther(100)
    )
    await strategy.depositToVaults(0, toEther(109), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 100)
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 400)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[3])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[4])), 0)
    assert.equal(Number(await strategy.indexOfLastFullVault()), 3)

    deposited = await strategy.depositToVaults.staticCall(0, toEther(9), toEther(10), toEther(100))
    await strategy.depositToVaults(0, toEther(9), toEther(10), toEther(100))
    assert.equal(fromEther(deposited), 0)
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 400)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[3])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[4])), 0)
    assert.equal(Number(await strategy.indexOfLastFullVault()), 3)
  })

  it('deposit should work correctly', async () => {
    const { accounts, adrs, strategy, token, stakingController, vaults } = await loadFixture(
      deployFixture
    )

    let initialBalance = await token.balanceOf(accounts[0])

    await strategy.deposit(toEther(50))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 50)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 50)
    assert.equal(fromEther(initialBalance - (await token.balanceOf(accounts[0]))), 50)

    await strategy.deposit(toEther(200))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 250)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 250)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 250)
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 250)

    await strategy.deposit(toEther(59))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 300)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[3])), 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 300)
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 300)
  })

  it('should not be able to withdraw', async () => {
    const { strategy } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(100))
    await expect(strategy.withdraw(toEther(10))).to.be.revertedWith(
      'withdrawals not yet implemented'
    )
  })

  it('depositChange should work correctly', async () => {
    const { adrs, strategy, token, rewardsController, vaults } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(300))

    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await rewardsController.setReward(vaults[0], toEther(100))
    assert.equal(fromEther(await strategy.getDepositChange()), 100)

    await rewardsController.setReward(vaults[1], toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 150)

    await token.transfer(adrs.strategy, toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 200)

    await rewardsController.setReward(vaults[0], toEther(60))
    assert.equal(fromEther(await strategy.getDepositChange()), 160)

    await strategy.updateDeposits('0x')
    await rewardsController.setReward(vaults[0], toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), -10)
  })

  it('updateDeposits should work correctly', async () => {
    const { accounts, adrs, strategy, token, rewardsController, vaults } = await loadFixture(
      deployFixture
    )

    await strategy.deposit(toEther(300))

    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await rewardsController.setReward(vaults[0], toEther(10))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 310)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await rewardsController.setReward(vaults[1], toEther(5))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 315)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    let initialBalance = await token.balanceOf(accounts[0])
    await token.transfer(adrs.strategy, toEther(20))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 315)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(initialBalance - (await token.balanceOf(accounts[0]))), 0)

    await rewardsController.setReward(vaults[1], toEther(0))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 310)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
  })

  it('fees should be properly calculated in updateDeposits', async () => {
    const { accounts, adrs, strategy, token, rewardsController, vaults } = await loadFixture(
      deployFixture
    )

    await strategy.deposit(toEther(300))

    await rewardsController.setReward(vaults[0], toEther(100))
    await strategy.addFeeBypassUpdate(accounts[3], 1000)
    let data = await strategy.updateDeposits.staticCall('0x')

    assert.equal(fromEther(data.depositChange), 100)
    assert.equal(data.receivers[0], accounts[4])
    assert.equal(data.receivers[1], accounts[3])
    assert.equal(fromEther(data.amounts[0]), 5)
    assert.equal(fromEther(data.amounts[1]), 10)

    await token.transfer(adrs.strategy, toEther(100))
    data = await strategy.updateDeposits.staticCall('0x')

    assert.equal(fromEther(data.depositChange), 200)
    assert.equal(data.receivers[0], accounts[4])
    assert.equal(data.receivers[1], accounts[3])
    assert.equal(fromEther(data.amounts[0]), 10)
    assert.equal(fromEther(data.amounts[1]), 20)

    await strategy.updateDeposits('0x')
    await rewardsController.setReward(vaults[0], toEther(50))
    data = await strategy.updateDeposits.staticCall('0x')

    assert.equal(fromEther(data.depositChange), -50)
    assert.deepEqual(data.receivers, [])
    assert.deepEqual(data.amounts, [])
  })

  it('getMinDeposits should work correctly', async () => {
    const { strategy, rewardsController, vaults } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await strategy.getMinDeposits()), 100)

    await rewardsController.setReward(vaults[0], toEther(50))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getMinDeposits()), 150)
  })

  it('getMaxDeposits should work correctly', async () => {
    const { strategy, stakingController, rewardsController, vaults } = await loadFixture(
      deployFixture
    )

    assert.equal(fromEther(await strategy.getMaxDeposits()), 1000)

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1000)

    await rewardsController.setReward(vaults[1], toEther(100))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1000)

    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1100)

    await stakingController.setMaxPoolSize(toEther(1000))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1010)
  })

  it('deployVault should work correctly', async () => {
    const { accounts, adrs, strategy } = await loadFixture(deployFixture)

    let newVaultImplementation = (await deployImplementation('OperatorVault')) as string
    await strategy.setVaultImplementation(newVaultImplementation)
    let vaultInterface = (await ethers.getContractFactory('OperatorVault')).interface as Interface

    for (let i = 1; i < 5; i++) {
      await strategy.deployVault(
        vaultInterface.encodeFunctionData('initialize', [
          adrs.token,
          adrs.strategy,
          adrs.stakingController,
          adrs.rewardsController,
          accounts[0],
          accounts[i],
          accounts[0],
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
    const { strategy, vaults } = await loadFixture(deployFixture)

    let vaultInterface = (await ethers.getContractFactory('CommunityVaultV2Mock'))
      .interface as Interface

    let newVaultImplementation = (await deployImplementation('CommunityVaultV2Mock')) as string
    await strategy.setVaultImplementation(newVaultImplementation)

    await strategy.upgradeVaults([0, 1, 2, 3, 4], ['0x', '0x', '0x', '0x', '0x'])
    for (let i = 0; i < 5; i++) {
      let vault = (await ethers.getContractAt(
        'CommunityVaultV2Mock',
        vaults[i]
      )) as CommunityVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
    }

    await strategy.upgradeVaults(
      [5, 6, 7, 8, 9],
      [
        vaultInterface.encodeFunctionData('initializeV2', [5]),
        vaultInterface.encodeFunctionData('initializeV2', [6]),
        vaultInterface.encodeFunctionData('initializeV2', [7]),
        vaultInterface.encodeFunctionData('initializeV2', [8]),
        vaultInterface.encodeFunctionData('initializeV2', [9]),
      ]
    )
    for (let i = 5; i < 10; i++) {
      let vault = (await ethers.getContractAt(
        'CommunityVaultV2Mock',
        vaults[i]
      )) as CommunityVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
      assert.equal(Number(await vault.getVersion()), i)
    }
  })

  it('setVaultImplementation should work correctly', async () => {
    const { accounts, strategy } = await loadFixture(deployFixture)
    await expect(strategy.setVaultImplementation(accounts[0])).to.be.revertedWith(
      'Address must belong to a contract'
    )

    let newVaultImplementation = (await deployImplementation('OperatorVault')) as string
    await strategy.setVaultImplementation(newVaultImplementation)
    assert.equal(await strategy.vaultImplementation(), newVaultImplementation)
  })
})
