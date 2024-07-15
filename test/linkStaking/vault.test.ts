import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import { ERC677, CommunityVault, StakingMock, StakingRewardsMock } from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('Vault', () => {
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

    const vault = (await deployUpgradeable('CommunityVault', [
      adrs.token,
      accounts[0],
      adrs.stakingController,
      adrs.rewardsController,
    ])) as CommunityVault
    adrs.vault = await vault.getAddress()

    await token.approve(adrs.vault, ethers.MaxUint256)

    return { accounts, adrs, token, rewardsController, stakingController, vault }
  }

  it('should be able to deposit', async () => {
    const { adrs, vault, token, stakingController } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 100)
    assert.equal(
      fromEther(await stakingController.getStakerPrincipal(adrs.vault)),
      100,
      'balance does not match'
    )

    await vault.deposit(toEther(200))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 300)
    assert.equal(
      fromEther(await stakingController.getStakerPrincipal(adrs.vault)),
      300,
      'balance does not match'
    )
  })

  it('should not be able to withdraw', async () => {
    const { vault } = await loadFixture(deployFixture)

    await expect(vault.withdraw(toEther(10))).to.be.revertedWith('withdrawals not yet implemented')
  })

  it('getPrincipalDeposits should work correctly', async () => {
    const { vault } = await loadFixture(deployFixture)

    await vault.deposit(toEther(10))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 10)

    await vault.deposit(toEther(30))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 40)
  })

  it('getRewards should work correctly', async () => {
    const { adrs, vault, rewardsController } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    await rewardsController.setReward(adrs.vault, toEther(10))
    assert.equal(fromEther(await vault.getRewards()), 10)

    await rewardsController.setReward(adrs.vault, toEther(40))
    assert.equal(fromEther(await vault.getRewards()), 40)
  })

  it('getTotalDeposits should work correctly', async () => {
    const { adrs, vault, rewardsController } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    await rewardsController.setReward(adrs.vault, toEther(10))
    assert.equal(fromEther(await vault.getTotalDeposits()), 110)

    await vault.deposit(toEther(150))
    await rewardsController.setReward(adrs.vault, toEther(40))
    assert.equal(fromEther(await vault.getTotalDeposits()), 290)
  })
})
