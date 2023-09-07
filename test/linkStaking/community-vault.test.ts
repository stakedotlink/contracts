import { ethers } from 'hardhat'
import { assert } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../utils/helpers'
import { ERC677, CommunityVault, StakingMock, StakingRewardsMock } from '../../typechain-types'
import { Signer } from 'ethers'

describe('CommunityVault', () => {
  let token: ERC677
  let stakingController: StakingMock
  let rewardsController: StakingRewardsMock
  let vault: CommunityVault
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

    stakingController = (await deploy('StakingMock', [token.address])) as StakingMock
    rewardsController = (await deploy('StakingRewardsMock', [token.address])) as StakingRewardsMock

    vault = (await deployUpgradeable('CommunityVault', [
      token.address,
      accounts[1],
      stakingController.address,
      rewardsController.address,
    ])) as CommunityVault

    await token.connect(signers[1]).approve(vault.address, ethers.constants.MaxUint256)
    await token.transfer(rewardsController.address, toEther(10000))
    await token.transfer(accounts[1], toEther(100))
  })

  it('claimRewards should work correctly', async () => {
    await vault.connect(signers[1]).deposit(toEther(100))
    await vault.connect(signers[1]).claimRewards(0)
    await rewardsController.setReward(vault.address, toEther(10))
    await vault.connect(signers[1]).claimRewards(toEther(11))
    assert.equal(fromEther(await vault.getRewards()), 10)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 0)

    await vault.connect(signers[1]).claimRewards(toEther(10))
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 10)
  })
})
