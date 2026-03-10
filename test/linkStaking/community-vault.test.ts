import { assert } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther, getConnection } from '../utils/helpers'
import { ERC677, CommunityVault, StakingMock, StakingRewardsMock } from '../../types/ethers-contracts'

const { ethers, loadFixture } = getConnection()

describe('CommunityVault', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

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
      28 * 86400,
      7 * 86400,
    ])) as StakingMock

    const vault = (await deployUpgradeable('CommunityVault', [
      token.target,
      accounts[1],
      stakingController.target,
      rewardsController.target,
      accounts[0],
    ])) as CommunityVault

    await token.connect(signers[1]).approve(vault.target, ethers.MaxUint256)
    await token.transfer(rewardsController.target, toEther(10000))
    await token.transfer(accounts[1], toEther(100))

    return { signers, accounts, token, rewardsController, stakingController, vault }
  }

  it('claimRewards should work correctly', async () => {
    const { signers, accounts, vault, rewardsController, token } = await loadFixture(
      deployFixture
    )

    await vault.connect(signers[1]).deposit(toEther(100))
    await vault.connect(signers[1]).claimRewards(0, accounts[5])
    await rewardsController.setReward(vault.target, toEther(10))
    await vault.connect(signers[1]).claimRewards(toEther(11), accounts[5])
    assert.equal(fromEther(await vault.getRewards()), 10)
    assert.equal(fromEther(await token.balanceOf(accounts[5])), 0)

    await vault.connect(signers[1]).claimRewards(toEther(10), accounts[5])
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[5])), 10)
  })
})
