import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import {
  ERC20,
  PolygonFundFlowController,
  PolygonStakeManagerMock,
  PolygonStrategy,
  PolygonValidatorShareMock,
  StakingPool,
  WithdrawalPoolMock,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

const withdrawalDelay = 86400

describe('PolygonFundFlowController', () => {
  async function deployFixture() {
    const { accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Polygon',
      'POL',
      1000000000,
    ])) as ERC20
    await setupToken(token, accounts)

    const stakeManager = (await deploy('PolygonStakeManagerMock', [
      token.target,
      withdrawalDelay,
    ])) as PolygonStakeManagerMock

    const validatorShare = (await deploy('PolygonValidatorShareMock', [
      stakeManager.target,
    ])) as PolygonValidatorShareMock

    const validatorShare2 = (await deploy('PolygonValidatorShareMock', [
      stakeManager.target,
    ])) as PolygonValidatorShareMock

    const validatorShare3 = (await deploy('PolygonValidatorShareMock', [
      stakeManager.target,
    ])) as PolygonValidatorShareMock

    const stakingPool = (await deployUpgradeable('StakingPool', [
      token.target,
      'Staking Polygon',
      'stPOL',
      [],
      0,
    ])) as StakingPool

    const vaultImp = await deployImplementation('PolygonVault')

    const strategy = (await deployUpgradeable('PolygonStrategy', [
      token.target,
      stakingPool.target,
      stakeManager.target,
      vaultImp,
      2500,
      [],
    ])) as PolygonStrategy

    const wsdToken = await deploy('WrappedSDToken', [stakingPool.target, 'Wrapped stPOL', 'wstPOL'])

    const mevRewardsPool = await deploy('RewardsPoolWSD', [
      strategy.target,
      stakingPool.target,
      wsdToken.target,
    ])

    const withdrawalPool = (await deploy('WithdrawalPoolMock')) as WithdrawalPoolMock

    const fundFlowController = (await deployUpgradeable('PolygonFundFlowController', [
      strategy.target,
      withdrawalPool.target,
      accounts[0],
      100000,
    ])) as PolygonFundFlowController

    await stakingPool.addStrategy(strategy.target)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])
    await strategy.setValidatorMEVRewardsPool(mevRewardsPool.target)
    await strategy.setFundFlowController(fundFlowController.target)

    await strategy.addValidator(validatorShare.target, accounts[1])
    await strategy.addValidator(validatorShare2.target, accounts[2])
    await strategy.addValidator(validatorShare3.target, accounts[3])

    await token.approve(stakingPool.target, ethers.MaxUint256)
    await token.approve(stakeManager.target, ethers.MaxUint256)

    let vaultAddresses: any = await strategy.getVaults()
    let vaults = []
    for (let i = 0; i < vaultAddresses.length; i++) {
      vaults.push(await ethers.getContractAt('PolygonVault', vaultAddresses[i]))
    }

    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await fundFlowController.depositQueuedTokens([0, 1, 2], [toEther(10), toEther(20), toEther(30)])

    return {
      accounts,
      token,
      stakeManager,
      validatorShare,
      strategy,
      validatorShare2,
      validatorShare3,
      stakingPool,
      vaults,
      mevRewardsPool,
      fundFlowController,
      withdrawalPool,
    }
  }

  it('depositQueuedTokens should work correctly', async () => {
    const { token, strategy, stakeManager, vaults } = await loadFixture(deployFixture)

    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 60)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 940)
    assert.equal(fromEther(await strategy.totalQueued()), 940)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 10)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 20)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 30)
  })

  it('unbondVaults should work correctly', async () => {
    const { token, strategy, stakeManager, vaults, fundFlowController, withdrawalPool } =
      await loadFixture(deployFixture)

    await withdrawalPool.setTotalQueuedWithdrawals(toEther(500))

    assert.equal(await fundFlowController.shouldUnbondVaults(), false)
    await expect(fundFlowController.unbondVaults()).to.be.revertedWithCustomError(
      fundFlowController,
      'NoUnbondingNeeded()'
    )

    await withdrawalPool.setTotalQueuedWithdrawals(toEther(960))

    assert.equal(await fundFlowController.shouldUnbondVaults(), true)

    await fundFlowController.unbondVaults()

    assert.equal(await fundFlowController.shouldUnbondVaults(), false)
    await expect(fundFlowController.unbondVaults()).to.be.revertedWithCustomError(
      fundFlowController,
      'NoUnbondingNeeded()'
    )

    assert.equal(await strategy.validatorWithdrawalIndex(), 2n)
    assert.equal(await strategy.numVaultsUnbonding(), 2n)
    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 60)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 940)
    assert.equal(fromEther(await strategy.totalQueued()), 940)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 10)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 10)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 0)
    assert.equal(await vaults[0].isUnbonding(), true)
    assert.equal(await vaults[1].isUnbonding(), true)
    assert.equal(await vaults[2].isUnbonding(), false)

    await strategy.queueValidatorRemoval(1)
    await time.increase(withdrawalDelay)
    await fundFlowController.withdrawVaults([0])

    await withdrawalPool.setTotalQueuedWithdrawals(toEther(995))

    assert.equal(await fundFlowController.shouldUnbondVaults(), false)
    await expect(fundFlowController.unbondVaults()).to.be.revertedWithCustomError(
      fundFlowController,
      'NoUnbondingNeeded()'
    )

    await time.increase(50000)

    assert.equal(await fundFlowController.shouldUnbondVaults(), true)
    await fundFlowController.unbondVaults()
  })

  it('withdrawVaults should work correctly', async () => {
    const { token, strategy, stakeManager, vaults, fundFlowController, withdrawalPool } =
      await loadFixture(deployFixture)

    assert.equal((await fundFlowController.shouldWithdrawVaults())[0], false)

    await withdrawalPool.setTotalQueuedWithdrawals(toEther(960))
    await fundFlowController.unbondVaults()

    assert.equal((await fundFlowController.shouldWithdrawVaults())[0], false)

    await time.increase(86700)

    assert.deepEqual(await fundFlowController.shouldWithdrawVaults(), [true, [0n, 1n]])

    await fundFlowController.withdrawVaults([0, 1])

    assert.equal((await fundFlowController.shouldWithdrawVaults())[0], false)
    assert.equal(await strategy.validatorWithdrawalIndex(), 2n)
    assert.equal(await strategy.numVaultsUnbonding(), 0n)
    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 40)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 960)
    assert.equal(fromEther(await strategy.totalQueued()), 960)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 0)
    assert.equal(fromEther(await vaults[1].getTotalDeposits()), 10)
    assert.equal(fromEther(await vaults[2].getTotalDeposits()), 30)
    assert.equal(await vaults[0].isUnbonding(), false)
    assert.equal(await vaults[1].isUnbonding(), false)
    assert.equal(await vaults[2].isUnbonding(), false)
  })

  it('restakeRewards should work correctly', async () => {
    const {
      fundFlowController,
      strategy,
      validatorShare,
      validatorShare2,
      validatorShare3,
      vaults,
    } = await loadFixture(deployFixture)

    await validatorShare.addReward(vaults[0].target, toEther(10))
    await validatorShare2.addReward(vaults[1].target, toEther(20))
    await validatorShare3.addReward(vaults[2].target, toEther(30))

    await strategy.restakeRewards([0, 2])

    assert.deepEqual(
      (await fundFlowController.getVaultRewards()).map((v) => fromEther(v)),
      [0, 20, 0]
    )

    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 20)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 60)
  })

  it('getWithdrawableVaults should work correctly', async () => {
    const { strategy, fundFlowController, withdrawalPool } = await loadFixture(deployFixture)

    assert.deepEqual(await fundFlowController.getWithdrawableVaults(), [])

    await withdrawalPool.setTotalQueuedWithdrawals(toEther(960))
    await fundFlowController.unbondVaults()

    assert.deepEqual(await fundFlowController.getWithdrawableVaults(), [])

    await time.increase(86700)

    assert.deepEqual(await fundFlowController.getWithdrawableVaults(), [0n, 1n])

    await strategy.queueValidatorRemoval(1)

    assert.deepEqual(await fundFlowController.getWithdrawableVaults(), [0n])

    await fundFlowController.withdrawVaults([0])

    assert.deepEqual(await fundFlowController.getWithdrawableVaults(), [])
  })

  it('getUnbondingVaults should work correctly', async () => {
    const { strategy, fundFlowController, withdrawalPool } = await loadFixture(deployFixture)

    assert.deepEqual(await fundFlowController.getUnbondingVaults(), [])

    await withdrawalPool.setTotalQueuedWithdrawals(toEther(960))
    await fundFlowController.unbondVaults()

    assert.deepEqual(await fundFlowController.getUnbondingVaults(), [0n, 1n])

    await strategy.queueValidatorRemoval(1)

    assert.deepEqual(await fundFlowController.getUnbondingVaults(), [0n])

    await time.increase(86700)

    assert.deepEqual(await fundFlowController.getUnbondingVaults(), [])
  })

  it('getVaultDeposits should work correctly', async () => {
    const { fundFlowController, withdrawalPool } = await loadFixture(deployFixture)

    assert.deepEqual(
      (await fundFlowController.getVaultDeposits()).map((d) => fromEther(d)),
      [10, 20, 30]
    )

    await withdrawalPool.setTotalQueuedWithdrawals(toEther(960))
    await fundFlowController.unbondVaults()
    await time.increase(withdrawalDelay)
    await fundFlowController.withdrawVaults([0n, 1n])

    assert.deepEqual(
      (await fundFlowController.getVaultDeposits()).map((v) => fromEther(v)),
      [0, 10, 30]
    )
  })

  it('getVaultRewards should work correctly', async () => {
    const {
      fundFlowController,
      strategy,
      validatorShare,
      validatorShare2,
      validatorShare3,
      vaults,
    } = await loadFixture(deployFixture)

    assert.deepEqual(
      (await fundFlowController.getVaultRewards()).map((v) => fromEther(v)),
      [0, 0, 0]
    )

    await validatorShare.addReward(vaults[0].target, toEther(5))
    await validatorShare2.addReward(vaults[1].target, toEther(10))
    await validatorShare3.addReward(vaults[2].target, toEther(15))

    assert.deepEqual(
      (await fundFlowController.getVaultRewards()).map((v) => fromEther(v)),
      [5, 10, 15]
    )

    await strategy.restakeRewards([1])

    assert.deepEqual(
      (await fundFlowController.getVaultRewards()).map((v) => fromEther(v)),
      [5, 0, 15]
    )
  })
})
