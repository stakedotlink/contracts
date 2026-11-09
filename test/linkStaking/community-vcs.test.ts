import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  deployImplementation,
  ethers,
  loadFixture,
} from '../utils/helpers'
import {
  ERC677,
  CommunityVCS,
  StakingMock,
  StakingRewardsMock,
  FundFlowControllerMock,
} from '../../typechain-types'

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

const encodeVaults = (vaults: number[]) => {
  return ethers.AbiCoder.defaultAbiCoder().encode(['uint64[]'], [vaults])
}

describe('CommunityVCS', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

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

    let vaultImplementation = await deployImplementation('CommunityVault')

    const vaultDepositController = await deploy('VaultDepositController')

    const strategy = (await deployUpgradeable(
      'CommunityVCS',
      [
        token.target,
        accounts[0],
        stakingController.target,
        vaultImplementation,
        [[accounts[4], 500]],
        9000,
        toEther(100),
        10,
        20,
        vaultDepositController.target,
      ],
      { unsafeAllow: ['delegatecall'] }
    )) as CommunityVCS

    await token.approve(strategy.target, ethers.MaxUint256)
    await token.transfer(rewardsController.target, toEther(10000))
    await strategy.setDepositUpdater(accounts[0])

    const fundFlowController = (await deploy('FundFlowControllerMock')) as FundFlowControllerMock

    await strategy.setFundFlowController(fundFlowController.target)
    await fundFlowController.setClaimPeriodActive(true)

    const vaults = await strategy.getVaults()

    return {
      signers,
      accounts,
      token,
      rewardsController,
      stakingController,
      strategy,
      fundFlowController,
      vaults,
    }
  }

  it('addVaults should work correctly', async () => {
    const { token, stakingController, rewardsController, strategy } = await loadFixture(
      deployFixture
    )

    await strategy.addVaults(10)
    let vaults = await strategy.getVaults()
    assert.equal(vaults.length, 30)
    for (let i = 0; i < vaults.length; i += 5) {
      let vault = await ethers.getContractAt('CommunityVault', vaults[i])
      assert.equal(await vault.token(), token.target)
      assert.equal(await vault.vaultController(), strategy.target)
      assert.equal(await vault.stakeController(), stakingController.target)
      assert.equal(await vault.rewardsController(), rewardsController.target)
    }
  })

  it('checkUpkeep should work correctly', async () => {
    const { strategy } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(1000), encodeVaults([]))
    assert.equal((await strategy.checkUpkeep('0x'))[0], false)

    await strategy.deposit(toEther(90), encodeVaults([]))
    assert.equal((await strategy.checkUpkeep('0x'))[0], false)

    await strategy.deposit(toEther(10), encodeVaults([]))
    assert.equal((await strategy.checkUpkeep('0x'))[0], true)
  })

  it('performUpkeep should work correctly', async () => {
    const { strategy } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(1000), encodeVaults([]))
    await expect(strategy.performUpkeep('0x')).to.be.revertedWithCustomError(
      strategy,
      'VaultsAboveThreshold()'
    )

    await strategy.deposit(toEther(90), encodeVaults([]))
    await expect(strategy.performUpkeep('0x')).to.be.revertedWithCustomError(
      strategy,
      'VaultsAboveThreshold()'
    )

    await strategy.deposit(toEther(10), encodeVaults([]))
    await strategy.performUpkeep('0x')
    assert.equal((await strategy.getVaults()).length, 40)
    assert.equal((await strategy.checkUpkeep('0x'))[0], false)
  })

  it('vault deployment is blocked while a deposit-update batch is in progress', async () => {
    const { strategy } = await loadFixture(deployFixture)

    // deposit and start a batched deposit update (20 vaults / 5 per batch)
    await strategy.deposit(toEther(1000), encodeVaults([]))
    await strategy.setVaultsPerBatch(5)
    await strategy.updateVaultDeposits()
    assert.notEqual(Number(await strategy.currentVaultIndex()), 0)

    // checkUpkeep must not signal work while a batch is in progress
    assert.equal((await strategy.checkUpkeep('0x'))[0], false)

    // both vault-deployment paths must be blocked mid-batch so vaults.length cannot outrun the batch
    await expect(strategy.performUpkeep('0x')).to.be.revertedWithCustomError(
      strategy,
      'DepositUpdateInProgress'
    )
    await expect(strategy.addVaults(5)).to.be.revertedWithCustomError(
      strategy,
      'DepositUpdateInProgress'
    )

    // finish the remaining batches and consume the update (resets currentVaultIndex to 0)
    await strategy.updateVaultDeposits()
    await strategy.updateVaultDeposits()
    await strategy.updateVaultDeposits()
    await strategy.updateDeposits('0x')
    assert.equal(Number(await strategy.currentVaultIndex()), 0)

    // deployment paths work again once no batch is in progress
    await strategy.addVaults(5)
  })

  it('claimRewards should work correctly', async () => {
    const { strategy, rewardsController, token } = await loadFixture(deployFixture)

    let vaults = await strategy.getVaults()
    await strategy.deposit(toEther(1000), encodeVaults([]))
    await rewardsController.setReward(vaults[1], toEther(5))
    await rewardsController.setReward(vaults[3], toEther(7))
    await rewardsController.setReward(vaults[5], toEther(8))

    await strategy.claimRewards([1, 3, 5], toEther(10))
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 0)

    await rewardsController.setReward(vaults[6], toEther(10))
    await rewardsController.setReward(vaults[7], toEther(7))
    await rewardsController.setReward(vaults[8], toEther(15))

    await strategy.claimRewards([6, 7, 8], toEther(10))
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 25)

    await rewardsController.setReward(vaults[9], toEther(15))
    await rewardsController.setReward(vaults[10], toEther(15))
    await rewardsController.setReward(vaults[11], toEther(15))

    await strategy.claimRewards([9, 10, 11], toEther(10))
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 70)

    await expect(strategy.claimRewards([100], 0)).to.revert(ethers)
  })

  it('deposit should work correctly', async () => {
    const { strategy, token, stakingController, vaults } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(50), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(stakingController.target)), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 50)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 50)

    await strategy.deposit(toEther(150), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(stakingController.target)), 200)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 200)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 200)

    await token.transfer(strategy.target, toEther(300))
    await strategy.deposit(toEther(520), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(stakingController.target)), 720)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 720)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 720)

    await stakingController.setDepositLimits(toEther(10), toEther(120))
    await strategy.deposit(toEther(80), encodeVaults([0, 1, 2, 3, 4, 5, 6]))
    assert.equal(fromEther(await token.balanceOf(stakingController.target)), 800)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[5])), 120)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[6])), 120)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[7])), 60)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 800)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 800)
  })

  it('updateDeposits should work without batching when vaultsPerBatch is 0', async () => {
    const { accounts, strategy, rewardsController } = await loadFixture(deployFixture)

    let vaults = await strategy.getVaults()
    await strategy.deposit(toEther(1000), encodeVaults([]))

    // vaultsPerBatch defaults to 0, so updateDeposits should use getDepositChange directly
    await rewardsController.setReward(vaults[0], toEther(50))
    await rewardsController.setReward(vaults[5], toEther(30))

    let data = await strategy.updateDeposits.staticCall('0x')
    assert.equal(fromEther(data.depositChange), 80)
    assert.equal(data.receivers[0], accounts[4])
    assert.equal(fromEther(data.amounts[0]), 4)

    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1080)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    // negative change (slashing)
    await rewardsController.setReward(vaults[0], toEther(0))
    data = await strategy.updateDeposits.staticCall('0x')
    assert.equal(fromEther(data.depositChange), -50)
    assert.deepEqual(data.receivers, [])
    assert.deepEqual(data.amounts, [])
  })

  it('batched updateDeposits should work correctly', async () => {
    const { signers, accounts, strategy, token, rewardsController, fundFlowController } =
      await loadFixture(deployFixture)

    let vaults = await strategy.getVaults()
    await strategy.deposit(toEther(1000), encodeVaults([]))
    await fundFlowController.setTotalUnbonded(strategy.target, toEther(500))

    // setVaultsPerBatch
    await strategy.setVaultsPerBatch(5)
    assert.equal(Number(await strategy.vaultsPerBatch()), 5)

    await rewardsController.setReward(vaults[0], toEther(10))
    await rewardsController.setReward(vaults[5], toEther(20))

    // updateDeposits should revert before any batches are processed
    await expect(strategy.updateDeposits('0x')).to.be.revertedWithCustomError(
      strategy,
      'DepositUpdateNotReady'
    )

    // first batch should revert for non-depositsUpdater
    await expect(strategy.connect(signers[1]).updateVaultDeposits()).to.be.revertedWithCustomError(
      strategy,
      'SenderNotAuthorized'
    )

    // process all 4 batches (20 vaults / 5 per batch)
    await strategy.updateVaultDeposits()
    assert.equal(Number(await strategy.currentVaultIndex()), 5)

    // updateDeposits should revert while batching is incomplete
    await expect(strategy.updateDeposits('0x')).to.be.revertedWithCustomError(
      strategy,
      'DepositUpdateNotReady'
    )

    // canDeposit and canWithdraw should return 0 during update
    assert.equal(fromEther(await strategy.canDeposit()), 0)
    assert.equal(fromEther(await strategy.canWithdraw()), 0)

    // deposit, withdraw, and claimRewards should revert during update
    await expect(strategy.deposit(toEther(100), encodeVaults([]))).to.be.revertedWithCustomError(
      strategy,
      'DepositUpdateInProgress'
    )
    await expect(strategy.withdraw(toEther(100), encodeVaults([0]))).to.be.revertedWithCustomError(
      strategy,
      'DepositUpdateInProgress'
    )
    await expect(strategy.claimRewards([0], toEther(5))).to.be.revertedWithCustomError(
      strategy,
      'DepositUpdateInProgress'
    )

    // subsequent batches callable by anyone
    await strategy.connect(signers[1]).updateVaultDeposits()
    assert.equal(Number(await strategy.currentVaultIndex()), 10)

    await strategy.connect(signers[2]).updateVaultDeposits()
    assert.equal(Number(await strategy.currentVaultIndex()), 15)

    await strategy.updateVaultDeposits()
    assert.equal(Number(await strategy.currentVaultIndex()), 20)

    // now updateDeposits should work and fees should be correct
    let data = await strategy.updateDeposits.staticCall('0x')
    assert.equal(fromEther(data.depositChange), 30)
    assert.equal(data.receivers[0], accounts[4])
    assert.equal(fromEther(data.amounts[0]), 1.5)

    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1030)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    // state should be reset
    assert.equal(Number(await strategy.currentVaultIndex()), 0)
    assert.equal(Number(await strategy.totalVaultDepositsAccum()), 0)

    // canDeposit and canWithdraw should return non-zero after batch completes
    assert.notEqual(fromEther(await strategy.canDeposit()), 0)
    assert.notEqual(fromEther(await strategy.canWithdraw()), 0)

    // negative deposit change with batching
    await rewardsController.setReward(vaults[0], toEther(0))
    await strategy.updateVaultDeposits()
    await strategy.updateVaultDeposits()
    await strategy.updateVaultDeposits()
    await strategy.updateVaultDeposits()
    data = await strategy.updateDeposits.staticCall('0x')
    assert.equal(fromEther(data.depositChange), -10)

    await strategy.updateDeposits('0x')

    // uneven batch size: 20 vaults with batch size 7 = 3 batches (7, 7, 6)
    await strategy.setVaultsPerBatch(7)
    await rewardsController.setReward(vaults[0], toEther(10))

    await strategy.updateVaultDeposits()
    assert.equal(Number(await strategy.currentVaultIndex()), 7)

    await strategy.updateVaultDeposits()
    assert.equal(Number(await strategy.currentVaultIndex()), 14)

    await strategy.updateVaultDeposits()
    assert.equal(Number(await strategy.currentVaultIndex()), 20)

    await strategy.updateDeposits('0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1030)

    // token balance should be transferred to staking pool
    await strategy.setVaultsPerBatch(20)
    await token.transfer(strategy.target, toEther(50))

    await strategy.updateVaultDeposits()
    await strategy.updateDeposits('0x')

    assert.equal(fromEther(await token.balanceOf(strategy.target)), 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1030)
  })
})
