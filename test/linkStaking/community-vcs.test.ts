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
import { ERC677, CommunityVCS, StakingMock, StakingRewardsMock } from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

const encodeVaults = (vaults: number[]) => {
  return ethers.AbiCoder.defaultAbiCoder().encode(['uint64[]'], [vaults])
}

describe('CommunityVCS', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()
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
      unbondingPeriod,
      claimPeriod,
    ])) as StakingMock
    adrs.stakingController = await stakingController.getAddress()

    let vaultImplementation = await deployImplementation('CommunityVault')

    const vaultDepositController = await deploy('VaultDepositController')

    const strategy = (await deployUpgradeable(
      'CommunityVCS',
      [
        adrs.token,
        accounts[0],
        adrs.stakingController,
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
    adrs.strategy = await strategy.getAddress()

    await token.approve(adrs.strategy, ethers.MaxUint256)
    await token.transfer(adrs.rewardsController, toEther(10000))
    await strategy.setDepositUpdater(accounts[0])

    const vaults = await strategy.getVaults()

    return {
      signers,
      accounts,
      adrs,
      token,
      rewardsController,
      stakingController,
      strategy,
      vaults,
    }
  }

  it('addVaults should work correctly', async () => {
    const { adrs, strategy } = await loadFixture(deployFixture)

    await strategy.addVaults(10)
    let vaults = await strategy.getVaults()
    assert.equal(vaults.length, 30)
    for (let i = 0; i < vaults.length; i += 5) {
      let vault = await ethers.getContractAt('CommunityVault', vaults[i])
      assert.equal(await vault.token(), adrs.token)
      assert.equal(await vault.vaultController(), adrs.strategy)
      assert.equal(await vault.stakeController(), adrs.stakingController)
      assert.equal(await vault.rewardsController(), adrs.rewardsController)
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
    expect(strategy.performUpkeep('0x')).to.be.revertedWith('VaultsAboveThreshold()')

    await strategy.deposit(toEther(90), encodeVaults([]))
    expect(strategy.performUpkeep('0x')).to.be.revertedWith('VaultsAboveThreshold()')

    await strategy.deposit(toEther(10), encodeVaults([]))
    await strategy.performUpkeep('0x')
    assert.equal((await strategy.getVaults()).length, 40)
    assert.equal((await strategy.checkUpkeep('0x'))[0], false)
  })

  it('claimRewards should work correctly', async () => {
    const { adrs, strategy, rewardsController, token } = await loadFixture(deployFixture)

    let vaults = await strategy.getVaults()
    await strategy.deposit(toEther(1000), encodeVaults([]))
    await rewardsController.setReward(vaults[1], toEther(5))
    await rewardsController.setReward(vaults[3], toEther(7))
    await rewardsController.setReward(vaults[5], toEther(8))

    await strategy.claimRewards([1, 3, 5], toEther(10))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 0)

    await rewardsController.setReward(vaults[6], toEther(10))
    await rewardsController.setReward(vaults[7], toEther(7))
    await rewardsController.setReward(vaults[8], toEther(15))

    await strategy.claimRewards([6, 7, 8], toEther(10))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 25)

    await rewardsController.setReward(vaults[9], toEther(15))
    await rewardsController.setReward(vaults[10], toEther(15))
    await rewardsController.setReward(vaults[11], toEther(15))

    await strategy.claimRewards([9, 10, 11], toEther(10))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 70)

    await expect(strategy.claimRewards([100], 0)).to.be.reverted
  })

  it('deposit should work correctly', async () => {
    const { adrs, strategy, token, stakingController, vaults } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(50), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 50)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(vaults[0])), 50)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 50)

    await strategy.deposit(toEther(150), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 200)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 200)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 200)

    await token.transfer(adrs.strategy, toEther(300))
    await strategy.deposit(toEther(520), encodeVaults([]))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 720)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 720)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 720)

    await stakingController.setDepositLimits(toEther(10), toEther(120))
    await strategy.deposit(toEther(80), encodeVaults([0, 1, 2, 3, 4, 5, 6]))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 800)
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
    const { signers, accounts, adrs, strategy, token, rewardsController } = await loadFixture(
      deployFixture
    )

    let vaults = await strategy.getVaults()
    await strategy.deposit(toEther(1000), encodeVaults([]))

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
    await token.transfer(adrs.strategy, toEther(50))

    await strategy.updateVaultDeposits()
    await strategy.updateDeposits('0x')

    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1030)
  })
})
