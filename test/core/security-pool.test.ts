import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  deployUpgradeable,
} from '../utils/helpers'
import { ERC677, SecurityPool, RewardsPoolTimeBased } from '../../typechain-types'
import { ethers } from 'hardhat'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

describe('SecurityPool', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Token1',
      '1',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)
    adrs.token = await token.getAddress()

    const stakingToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'StakingToken',
      'ST',
      1000000000,
    ])) as ERC677
    await setupToken(stakingToken, accounts)
    adrs.stakingToken = await stakingToken.getAddress()

    const securityPool = (await deployUpgradeable('SecurityPool', [
      adrs.stakingToken,
      'name',
      'symbol',
      accounts[0],
      3000,
      0,
      0,
    ])) as SecurityPool
    adrs.securityPool = await securityPool.getAddress()

    const rewardsPool = (await deploy('RewardsPoolTimeBased', [
      adrs.securityPool,
      adrs.token,
      100,
      100000,
    ])) as RewardsPoolTimeBased
    adrs.rewardsPool = await rewardsPool.getAddress()

    await securityPool.addToken(adrs.token, adrs.rewardsPool)
    await stakingToken.approve(adrs.securityPool, ethers.MaxUint256)
    await stakingToken.connect(signers[1]).approve(adrs.securityPool, ethers.MaxUint256)
    await token.approve(adrs.rewardsPool, ethers.MaxUint256)
    await securityPool.deposit(1000)

    return { accounts, signers, adrs, token, stakingToken, securityPool, rewardsPool }
  }

  it('deposit should work correctly', async () => {
    const { accounts, signers, adrs, securityPool, stakingToken, rewardsPool } = await loadFixture(
      deployFixture
    )

    await securityPool.deposit(toEther(1000))
    await securityPool.connect(signers[1]).deposit(toEther(3000))
    await securityPool.withdraw(1000)

    assert.equal(fromEther(await securityPool.balanceOf(accounts[0])), 1000)
    assert.equal(fromEther(await securityPool.balanceOf(accounts[1])), 3000)
    assert.equal(fromEther(await securityPool.totalDeposits()), 4000)
    assert.equal(fromEther(await securityPool.totalStaked()), 4000)
    assert.equal(fromEther(await stakingToken.balanceOf(adrs.securityPool)), 4000)

    let ts: any = (await ethers.provider.getBlock('latest'))?.timestamp
    await rewardsPool.depositRewards(ts + 1000, toEther(1000))
    await time.increase(1000)

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 0)

    await securityPool.deposit(toEther(100))

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.25)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 250)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 0)
  })

  it('withdraw should work correctly', async () => {
    const { accounts, signers, adrs, securityPool, stakingToken, rewardsPool } = await loadFixture(
      deployFixture
    )

    await securityPool.setWithdrawalParams(10, 100)
    await securityPool.deposit(toEther(1200))
    await securityPool.connect(signers[1]).deposit(toEther(3000))

    await expect(securityPool.withdraw(toEther(200))).to.be.revertedWithCustomError(
      securityPool,
      'WithdrawalWindowInactive()'
    )

    await securityPool.requestWithdrawal()
    await time.increase(10)
    await securityPool.withdraw(toEther(200))

    assert.equal(fromEther(await securityPool.balanceOf(accounts[0])), 1000)
    assert.equal(fromEther(await securityPool.balanceOf(accounts[1])), 3000)
    assert.equal(fromEther(await securityPool.totalDeposits()), 4000)
    assert.equal(fromEther(await securityPool.totalStaked()), 4000)
    assert.equal(fromEther(await stakingToken.balanceOf(adrs.securityPool)), 4000)

    let ts: any = (await ethers.provider.getBlock('latest'))?.timestamp
    await rewardsPool.depositRewards(ts + 1000, toEther(1000))
    await time.increase(1000)

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 0)

    await securityPool.connect(signers[1]).requestWithdrawal()
    await time.increase(10)
    await securityPool.connect(signers[1]).withdraw(toEther(100))

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.25)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 750)
  })

  it('claim process should work correctly', async () => {
    const { accounts, signers, adrs, securityPool, stakingToken, rewardsPool, token } =
      await loadFixture(deployFixture)

    await expect(securityPool.executeClaim(10)).to.be.revertedWithCustomError(
      securityPool,
      'NoClaimInProgress()'
    )
    await expect(securityPool.resolveClaim()).to.be.revertedWithCustomError(
      securityPool,
      'NoClaimInProgress()'
    )

    await securityPool.deposit(toEther(1000))
    await securityPool.connect(signers[1]).deposit(toEther(3000))
    await token.transferAndCall(adrs.rewardsPool, toEther(1000), '0x')
    await securityPool.initiateClaim()

    assert.equal(await securityPool.claimInProgress(), true)
    await expect(securityPool.deposit(toEther(100))).to.be.revertedWithCustomError(
      securityPool,
      'ClaimInProgress()'
    )
    await expect(securityPool.withdraw(toEther(100))).to.be.revertedWithCustomError(
      securityPool,
      'ClaimInProgress()'
    )
    await expect(securityPool.executeClaim(toEther(1201))).to.be.revertedWithCustomError(
      securityPool,
      'ExceedsMaxClaimAmount()'
    )

    await securityPool.executeClaim(toEther(1200))

    assert.equal(await securityPool.claimInProgress(), true)
    assert.equal(fromEther(await rewardsPool.withdrawableRewards(accounts[0])), 250)
    assert.equal(fromEther(await rewardsPool.withdrawableRewards(accounts[1])), 750)
    assert.equal(fromEther(await securityPool.staked(accounts[0])), 1000)
    assert.equal(fromEther(await securityPool.staked(accounts[1])), 3000)
    assert.equal(fromEther(await securityPool.balanceOf(accounts[0])), 700)
    assert.equal(fromEther(await securityPool.balanceOf(accounts[1])), 2100)
    assert.equal(fromEther(await securityPool.totalDeposits()), 2800)
    assert.equal(fromEther(await securityPool.totalStaked()), 4000)
    assert.equal(fromEther(await stakingToken.balanceOf(adrs.securityPool)), 2800)

    await securityPool.resolveClaim()
  })
})
