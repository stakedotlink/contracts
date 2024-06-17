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
  FundFlowController,
} from '../../typechain-types'
import { Interface } from 'ethers/lib/utils'
import { time } from '@nomicfoundation/hardhat-network-helpers'

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

describe('VaultControllerStrategy', () => {
  let token: ERC677
  let stakingController: StakingMock
  let rewardsController: StakingRewardsMock
  let fundFlowController: FundFlowController
  let strategy: VCSMock
  let vaults: string[]
  let vaultContracts: CommunityVault[]
  let accounts: string[]

  async function updateVaultGroups(
    curGroupVaultsToUnbond: number[],
    nextGroupVaultsTotalUnbonded: number
  ) {
    return await fundFlowController.performUpkeep(
      ethers.utils.defaultAbiCoder.encode(
        ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
        [curGroupVaultsToUnbond, toEther(nextGroupVaultsTotalUnbonded), [], 0]
      )
    )
  }

  function encodeVaults(vaults: number[]) {
    return ethers.utils.defaultAbiCoder.encode(['uint64[]'], [vaults])
  }

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    rewardsController = (await deploy('StakingRewardsMock', [token.address])) as StakingRewardsMock
    stakingController = (await deploy('StakingMock', [
      token.address,
      rewardsController.address,
      toEther(10),
      toEther(100),
      toEther(10000),
      unbondingPeriod,
      claimPeriod,
    ])) as StakingMock

    let vaultImplementation = await deployImplementation('CommunityVault')

    strategy = (await deployUpgradeable('VCSMock', [
      token.address,
      accounts[0],
      stakingController.address,
      vaultImplementation,
      [[accounts[4], 500]],
      toEther(100),
    ])) as VCSMock

    const strategy2 = (await deployUpgradeable('VCSMock', [
      token.address,
      accounts[0],
      stakingController.address,
      vaultImplementation,
      [[accounts[4], 500]],
      toEther(100),
    ])) as VCSMock

    vaults = []
    vaultContracts = []
    for (let i = 0; i < 15; i++) {
      let vault = (await deployUpgradeable('CommunityVault', [
        token.address,
        strategy.address,
        stakingController.address,
        rewardsController.address,
      ])) as CommunityVault
      vaultContracts.push(vault)
      vaults.push(vault.address)
    }

    for (let i = 0; i < 15; i++) {
      vaultContracts[i].transferOwnership(strategy.address)
    }

    await strategy.addVaults(vaults)
    await token.approve(strategy.address, ethers.constants.MaxUint256)

    fundFlowController = (await deployUpgradeable('FundFlowController', [
      strategy.address,
      strategy2.address,
      unbondingPeriod,
      claimPeriod,
      5,
    ])) as FundFlowController
    await strategy.setFundFlowController(fundFlowController.address)
    await strategy2.setFundFlowController(fundFlowController.address)
  })

  it('getVaults should work correctly', async () => {
    assert.deepEqual(await strategy.getVaults(), vaults)
  })

  it('getVaultDepositLimits should work correctly', async () => {
    assert.deepEqual(
      (await strategy.getVaultDepositLimits()).map((v) => fromEther(v)),
      [10, 100]
    )
  })

  it('depositToVaults should work correctly', async () => {
    // Deposit into vaults that don't yet belong to a group

    await strategy.deposit(toEther(50), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 50)
    assert.equal((await strategy.globalVaultState())[3].toNumber(), 0)

    await strategy.deposit(toEther(155), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 200)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 0)
    assert.equal((await strategy.globalVaultState())[3].toNumber(), 2)

    await strategy.deposit(toEther(1000), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 1200)
    assert.equal((await strategy.globalVaultState())[3].toNumber(), 12)

    // Deposit into vault groups

    await updateVaultGroups([0, 5, 10], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([1, 6, 11], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([2, 7], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([3, 8], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([4, 9], 300)
    await strategy.withdraw(toEther(50), encodeVaults([0, 5]))
    await time.increase(claimPeriod)
    await updateVaultGroups([0, 5, 10], 300)
    await strategy.withdraw(toEther(270), encodeVaults([1, 6, 11]))
    await time.increase(claimPeriod)
    await updateVaultGroups([1, 6, 11], 200)
    await strategy.withdraw(toEther(100), encodeVaults([2, 7]))
    await time.increase(claimPeriod)
    await updateVaultGroups([2, 7], 200)
    await strategy.withdraw(toEther(120), encodeVaults([3, 8]))
    await time.increase(claimPeriod)
    await updateVaultGroups([3, 8], 200)
    await strategy.withdraw(toEther(200), encodeVaults([4, 9]))

    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 460)

    await strategy.deposit(toEther(50), encodeVaults([0, 1, 6]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 510)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 50)
    assert.equal(fromEther(await strategy.canWithdraw()), 0)
    assert.deepEqual(
      await strategy.vaultGroups(1).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [11, 220]
    )

    await time.increase(claimPeriod)
    await updateVaultGroups([4, 9], 250)
    await time.increase(claimPeriod)
    await updateVaultGroups([0, 5, 10], 30)

    await expect(strategy.deposit(toEther(200), encodeVaults([6, 11, 4]))).to.be.revertedWith(
      'InvalidVaultIds()'
    )
    await expect(strategy.deposit(toEther(200), encodeVaults([1, 12]))).to.be.revertedWith(
      'InvalidVaultIds()'
    )

    await strategy.deposit(toEther(200), encodeVaults([1, 6, 11, 4]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 710)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[6])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[4])), 50)
    assert.equal(fromEther(await strategy.canWithdraw()), 30)
    assert.deepEqual(
      await strategy.vaultGroups(1).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [11, 70]
    )
    assert.deepEqual(
      await strategy.vaultGroups(4).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [9, 150]
    )

    await strategy.deposit(toEther(100), encodeVaults([4, 9]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 810)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[4])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[9])), 50)
    assert.equal(fromEther(await strategy.canWithdraw()), 30)
    assert.deepEqual(
      await strategy.vaultGroups(4).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [4, 50]
    )

    // Deposit into vault groups and non-group vaults

    await strategy.deposit(toEther(600), encodeVaults([9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 1360)
    assert.deepEqual(
      await strategy.vaultGroups(0).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [0, 50]
    )
    assert.deepEqual(
      await strategy.vaultGroups(1).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [11, 70]
    )
    assert.deepEqual(
      await strategy.vaultGroups(2).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [7, 0]
    )
    assert.deepEqual(
      await strategy.vaultGroups(3).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [8, 20]
    )
    assert.deepEqual(
      await strategy.vaultGroups(4).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [4, 0]
    )
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[12])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[13])), 100)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[14])), 100)
  })

  it('deposit should work correctly', async () => {
    await strategy.deposit(toEther(50), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 50)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 50)

    await strategy.deposit(toEther(150), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 200)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 200)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 200)

    await token.transfer(strategy.address, toEther(500))
    await strategy.deposit(toEther(20), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 720)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 720)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 720)

    await stakingController.setDepositLimits(toEther(10), toEther(120))
    await strategy.deposit(toEther(80), encodeVaults([0, 1, 2, 3, 4, 5, 6]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 800)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[5])), 120)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[6])), 120)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[7])), 60)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 800)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 800)

    await token.transfer(strategy.address, toEther(2000))
    await strategy.deposit(toEther(20), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 1700)
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 0)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 1700)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1700)
  })

  it('withdraw should work correctly', async () => {
    await strategy.deposit(toEther(1200), encodeVaults([]))
    await updateVaultGroups([0, 5, 10], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([1, 6, 11], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([2, 7], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([3, 8], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([4, 9], 300)

    await expect(strategy.withdraw(toEther(150), encodeVaults([5, 10]))).to.be.revertedWith(
      'InvalidVaultIds()'
    )
    await expect(strategy.withdraw(toEther(150), encodeVaults([0, 1]))).to.be.revertedWith(
      'InvalidVaultIds()'
    )

    await strategy.withdraw(toEther(150), encodeVaults([0, 5]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 1050)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 0)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[5])), 50)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 1050)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1050)
    assert.equal(fromEther(await strategy.canWithdraw()), 150)
    assert.deepEqual(
      await strategy.vaultGroups(0).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [5, 150]
    )

    await time.increase(claimPeriod)
    await updateVaultGroups([5, 10], 300)

    await strategy.withdraw(toEther(75), encodeVaults([1, 6]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 975)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 25)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 975)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 975)
    assert.equal(fromEther(await strategy.canWithdraw()), 225)
    assert.deepEqual(
      await strategy.vaultGroups(1).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [1, 75]
    )

    await strategy.withdraw(toEther(120), encodeVaults([1, 6]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 850)
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 0)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[1])), 0)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[6])), 0)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 850)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 850)
    assert.equal(fromEther(await strategy.canWithdraw()), 100)
    assert.deepEqual(
      await strategy.vaultGroups(1).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [6, 200]
    )

    await expect(strategy.withdraw(toEther(101), encodeVaults([6, 11]))).to.be.revertedWith(
      'InsufficientTokensUnbonded()'
    )

    await time.increase(claimPeriod)

    await expect(strategy.withdraw(toEther(20), encodeVaults([6]))).to.be.revertedWith(
      'InsufficientTokensUnbonded()'
    )

    await updateVaultGroups([6, 11], 200)

    await strategy.withdraw(toEther(200), encodeVaults([2, 7]))
    assert.equal(fromEther(await token.balanceOf(stakingController.address)), 650)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[2])), 0)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[7])), 0)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 650)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 650)
    assert.equal(fromEther(await strategy.canWithdraw()), 0)
    assert.deepEqual(
      await strategy.vaultGroups(2).then((d) => [d[0].toNumber(), fromEther(d[1])]),
      [7, 200]
    )
  })

  it('depositChange should work correctly', async () => {
    await strategy.deposit(toEther(300), encodeVaults([]))

    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await rewardsController.setReward(vaults[0], toEther(100))
    assert.equal(fromEther(await strategy.getDepositChange()), 100)

    await rewardsController.setReward(vaults[1], toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 150)

    await token.transfer(strategy.address, toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 200)

    await rewardsController.setReward(vaults[0], toEther(60))
    assert.equal(fromEther(await strategy.getDepositChange()), 160)

    await strategy.updateDeposits('0x')
    await rewardsController.setReward(vaults[0], toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), -10)
  })

  it('updateDeposits should work correctly', async () => {
    await strategy.deposit(toEther(300), encodeVaults([]))

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
    await token.transfer(strategy.address, toEther(20))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 315)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(initialBalance.sub(await token.balanceOf(accounts[0]))), 0)

    await rewardsController.setReward(vaults[1], toEther(0))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 310)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
  })

  it('fees should be properly calculated in updateDeposits', async () => {
    await strategy.deposit(toEther(300), encodeVaults([]))

    await rewardsController.setReward(vaults[0], toEther(100))
    await strategy.addFeeBypassUpdate(accounts[3], 1000)
    let data = await strategy.callStatic.updateDeposits('0x')

    assert.equal(fromEther(data.depositChange), 100)
    assert.equal(data.receivers[0], accounts[4])
    assert.equal(data.receivers[1], accounts[3])
    assert.equal(fromEther(data.amounts[0]), 5)
    assert.equal(fromEther(data.amounts[1]), 10)

    await token.transfer(strategy.address, toEther(100))
    data = await strategy.callStatic.updateDeposits('0x')

    assert.equal(fromEther(data.depositChange), 200)
    assert.equal(data.receivers[0], accounts[4])
    assert.equal(data.receivers[1], accounts[3])
    assert.equal(fromEther(data.amounts[0]), 10)
    assert.equal(fromEther(data.amounts[1]), 20)

    await strategy.updateDeposits('0x')
    await rewardsController.setReward(vaults[0], toEther(50))
    data = await strategy.callStatic.updateDeposits('0x')

    assert.equal(fromEther(data.depositChange), -50)
    assert.deepEqual(data.receivers, [])
    assert.deepEqual(data.amounts, [])
  })

  it('getMinDeposits should work correctly', async () => {
    await strategy.deposit(toEther(100), encodeVaults([]))
    assert.equal(fromEther(await strategy.getMinDeposits()), 100)

    await rewardsController.setReward(vaults[0], toEther(50))
    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getMinDeposits()), 150)
  })

  it('getMaxDeposits should work correctly', async () => {
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1500)

    await strategy.deposit(toEther(100), encodeVaults([]))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1500)

    await rewardsController.setReward(vaults[1], toEther(100))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1500)

    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1600)

    await stakingController.setMaxPoolSize(toEther(1000))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1010)
  })

  it('deployVault should work correctly', async () => {
    let newVaultImplementation = (await deployImplementation('OperatorVault')) as string
    await strategy.setVaultImplementation(newVaultImplementation)
    let vaultInterface = (await ethers.getContractFactory('OperatorVault')).interface as Interface

    for (let i = 1; i < 5; i++) {
      await strategy.deployVault(
        vaultInterface.encodeFunctionData('initialize', [
          token.address,
          strategy.address,
          stakingController.address,
          rewardsController.address,
          accounts[0],
          accounts[i],
          accounts[0],
        ])
      )
    }

    let vaults = await strategy.getVaults()

    for (let i = 1; i < 5; i++) {
      let vault = (await ethers.getContractAt('OperatorVault', vaults[14 + i])) as OperatorVault
      assert.equal(await vault.operator(), accounts[i])
    }
  })

  it('upgradeVaults should work correctly', async () => {
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
      assert.equal((await vault.getVersion()).toNumber(), i)
    }
  })

  it('setVaultImplementation should work correctly', async () => {
    let newVaultImplementation = (await deployImplementation('OperatorVault')) as string
    await strategy.setVaultImplementation(newVaultImplementation)
    assert.equal(await strategy.vaultImplementation(), newVaultImplementation)
  })

  it('setWithdrawalIndexes should work correctly', async () => {
    await strategy.setWithdrawalIndexes([5, 6, 7, 8, 9])
    await expect(strategy.setWithdrawalIndexes([0, 1, 2, 3, 5])).to.be.revertedWith(
      'InvalidWithdrawalIndexes()'
    )
  })
})
