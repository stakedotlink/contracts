import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  getConnection,
} from '../utils/helpers'
import type {
  ERC677,
  OperatorVCSMock,
  OperatorVault,
  PFAlertsControllerMock,
  StakingMock,
  StakingRewardsMock,
} from '../../types/ethers-contracts'

const { ethers, loadFixture, networkHelpers } = getConnection()
const time = networkHelpers.time

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

describe('OperatorVault', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677

    const rewardsController = (await deploy('StakingRewardsMock', [
      token.target,
    ])) as StakingRewardsMock

    const stakingController = (await deploy('StakingMock', [
      token.target,
      rewardsController.target,
      toEther(10),
      toEther(100),
      toEther(10000),
      unbondingPeriod,
      claimPeriod,
    ])) as StakingMock

    const pfAlertsController = (await deploy('PFAlertsControllerMock', [
      token.target,
    ])) as PFAlertsControllerMock

    const strategy = (await deploy('OperatorVCSMock', [
      token.target,
      1000,
      5000,
    ])) as OperatorVCSMock

    const vault = (await deployUpgradeable(
      'OperatorVault',
      [
        token.target,
        strategy.target,
        stakingController.target,
        rewardsController.target,
        accounts[0],
        pfAlertsController.target,
        accounts[1],
        accounts[2],
      ],
      { unsafeAllow: ['missing-initializer-call'] }
    )) as OperatorVault

    await strategy.addVault(vault.target)
    await token.approve(strategy.target, toEther(100000000))
    await strategy.deposit(toEther(100))
    await token.transfer(rewardsController.target, toEther(1000))
    await token.transfer(pfAlertsController.target, toEther(1000))

    return {
      signers,
      accounts,
      token,
      rewardsController,
      stakingController,
      pfAlertsController,
      strategy,
      vault,
    }
  }

  it('deposit should work correctly', async () => {
    const { strategy, token, stakingController, vault } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(stakingController.target)), 200)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vault.target)), 200)
    assert.equal(fromEther(await vault.getTotalDeposits()), 200)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 200)
  })

  it('withdraw should work correctly', async () => {
    const { strategy, token, stakingController, vault } = await loadFixture(deployFixture)

    await strategy.unbond()

    await expect(strategy.withdraw(toEther(30))).to.be.revertedWithCustomError(
      stakingController,
      'NotInClaimPeriod()'
    )

    await time.increase(unbondingPeriod + 1)

    await strategy.withdraw(toEther(30))
    assert.equal(fromEther(await token.balanceOf(stakingController.target)), 70)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vault.target)), 70)
    assert.equal(fromEther(await vault.getTotalDeposits()), 70)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 70)
  })

  it('raiseAlert should work correctly', async () => {
    const { signers, accounts, token, strategy, vault } = await loadFixture(deployFixture)

    await vault.connect(signers[1]).raiseAlert(accounts[5])
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 11.7)
    assert.equal(fromEther(await token.balanceOf(vault.target)), 1.3)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.3)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 100)
    await expect(vault.raiseAlert(accounts[5])).to.be.revertedWithCustomError(
      vault,
      'OnlyOperator()'
    )
  })

  it('getPrincipalDeposits should work correctly', async () => {
    const { stakingController, vault } = await loadFixture(deployFixture)

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    await stakingController.removeOperator(vault.target)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
  })

  it('getPendingRewards should work correctly', async () => {
    const { accounts, strategy, vault, rewardsController } = await loadFixture(deployFixture)

    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    await rewardsController.setReward(vault.target, toEther(10))
    assert.equal(fromEther(await vault.getPendingRewards()), 1)
    await rewardsController.setReward(vault.target, toEther(15))
    assert.equal(fromEther(await vault.getPendingRewards()), 1.5)
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getPendingRewards()), 1.5)
    await rewardsController.setReward(vault.target, toEther(10))
    assert.equal(fromEther(await vault.getPendingRewards()), 1)

    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    await rewardsController.setReward(vault.target, toEther(11))
    assert.equal(fromEther(await vault.getPendingRewards()), 0.1)
    await rewardsController.setReward(vault.target, toEther(6))
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
  })

  it('updateDeposits should work correctly', async () => {
    const { accounts, strategy, vault, rewardsController, stakingController } = await loadFixture(
      deployFixture
    )

    await rewardsController.setReward(vault.target, toEther(10))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0, accounts[3])).map((v: bigint) => fromEther(v)),
      [110, 100, 1]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await rewardsController.setReward(vault.target, toEther(5))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0, accounts[3])).map((v: bigint) => fromEther(v)),
      [105, 100, 0]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await rewardsController.setReward(vault.target, toEther(8))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0, accounts[3])).map((v: bigint) => fromEther(v)),
      [108, 100, 0]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await rewardsController.setReward(vault.target, toEther(11))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0, accounts[3])).map((v: bigint) => fromEther(v)),
      [111, 100, 0.1]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 111)

    await strategy.updateDeposits(toEther(12), accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 111)

    await strategy.updateDeposits(toEther(11), accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 100)

    await expect(vault.updateDeposits(0, accounts[0])).to.be.revertedWithCustomError(
      vault,
      'OnlyVaultController()'
    )
  })

  it('withdrawRewards should work correctly', async () => {
    const { signers, accounts, strategy, token, vault, rewardsController } = await loadFixture(
      deployFixture
    )

    await rewardsController.setReward(vault.target, toEther(10))
    await strategy.updateDeposits(0, accounts[3])

    await expect(vault.withdrawRewards()).to.be.revertedWithCustomError(
      vault,
      'OnlyRewardsReceiver()'
    )

    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0.5)

    await vault.connect(signers[1]).raiseAlert(accounts[5])
    await vault.connect(signers[2]).withdrawRewards()

    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0.25)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 1.3)

    await strategy.setWithdrawalPercentage(10000)
    await vault.connect(signers[2]).withdrawRewards()

    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0)
  })

  it('exitVault should work correctly', async () => {
    const { accounts, strategy, token, vault, rewardsController, stakingController } =
      await loadFixture(deployFixture)

    await rewardsController.setReward(vault.target, toEther(10))
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    assert.equal(fromEther(await vault.getTotalDeposits()), 110)

    await expect(strategy.removeVault()).to.be.revertedWithCustomError(
      vault,
      'OperatorNotRemoved()'
    )

    await stakingController.removeOperator(vault.target)
    assert.deepEqual(
      (await strategy.removeVault.staticCall()).map((v: bigint) => fromEther(v)),
      [100, 10]
    )
    await strategy.removeVault()

    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0.5)
    assert.equal(fromEther(await vault.getTotalDeposits()), 0)
  })

  it('setRewardsReceiver should work correctly', async () => {
    const {
      signers,
      accounts,
      token,
      strategy,
      stakingController,
      rewardsController,
      pfAlertsController,
    } = await loadFixture(deployFixture)

    let newVault = (await deployUpgradeable(
      'OperatorVault',
      [
        token.target,
        strategy.target,
        stakingController.target,
        rewardsController.target,
        accounts[0],
        pfAlertsController.target,
        accounts[1],
        ethers.ZeroAddress,
      ],
      { unsafeAllow: ['missing-initializer-call'] }
    )) as OperatorVault

    await expect(
      newVault.connect(signers[1]).setRewardsReceiver(accounts[1])
    ).to.be.revertedWithCustomError(newVault, 'OnlyRewardsReceiver()')
    await newVault.setRewardsReceiver(accounts[1])

    await expect(newVault.setRewardsReceiver(accounts[0])).to.be.revertedWithCustomError(
      newVault,
      'OnlyRewardsReceiver()'
    )
    await newVault.connect(signers[1]).setRewardsReceiver(accounts[0])
    assert.equal(await newVault.rewardsReceiver(), accounts[0])
  })
})
