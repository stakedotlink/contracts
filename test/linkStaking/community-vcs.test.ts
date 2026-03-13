import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  deployImplementation,
  getConnection,
} from '../utils/helpers'
import { ERC677, CommunityVCS, StakingMock, StakingRewardsMock } from '../../types/ethers-contracts'

const { ethers, loadFixture } = getConnection()

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

const encodeVaults = (vaults: number[]) => {
  return ethers.AbiCoder.defaultAbiCoder().encode(['uint64[]'], [vaults])
}

describe('CommunityVCS', () => {
  async function deployFixture() {
    const { accounts } = await getAccounts()

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

    const vaults = await strategy.getVaults()

    return { accounts, token, rewardsController, stakingController, strategy, vaults }
  }

  it('addVaults should work correctly', async () => {
    const { strategy, stakingController, rewardsController } = await loadFixture(deployFixture)

    await strategy.addVaults(10)
    let vaults = await strategy.getVaults()
    assert.equal(vaults.length, 30)
    for (let i = 0; i < vaults.length; i += 5) {
      let vault = await ethers.getContractAt('CommunityVault', vaults[i])
      assert.equal(await vault.token(), await strategy.token())
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
      'VaultsAboveThreshold'
    )

    await strategy.deposit(toEther(90), encodeVaults([]))
    await expect(strategy.performUpkeep('0x')).to.be.revertedWithCustomError(
      strategy,
      'VaultsAboveThreshold'
    )

    await strategy.deposit(toEther(10), encodeVaults([]))
    await strategy.performUpkeep('0x')
    assert.equal((await strategy.getVaults()).length, 40)
    assert.equal((await strategy.checkUpkeep('0x'))[0], false)
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
})
