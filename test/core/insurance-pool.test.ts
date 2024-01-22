import { BigNumber, Signer } from 'ethers'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  deployUpgradeable,
} from '../utils/helpers'
import { ERC677, InsurancePool, RewardsPoolTimeBased } from '../../typechain-types'
import { ethers, network } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'

describe('InsurancePool', () => {
  let stakingToken: ERC677
  let token: ERC677
  let rewardsPool: RewardsPoolTimeBased
  let insurancePool: InsurancePool
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Token1', '1', 1000000000])) as ERC677
    await setupToken(token, accounts)
    stakingToken = (await deploy('ERC677', ['StakingToken', 'ST', 1000000000])) as ERC677
    await setupToken(stakingToken, accounts)

    insurancePool = (await deployUpgradeable('InsurancePool', [
      stakingToken.address,
      'name',
      'symbol',
      accounts[0],
      3000,
    ])) as InsurancePool

    rewardsPool = (await deploy('RewardsPoolTimeBased', [
      insurancePool.address,
      token.address,
      100,
      100000,
    ])) as RewardsPoolTimeBased

    await insurancePool.setRewardsPool(rewardsPool.address)
    await stakingToken.approve(insurancePool.address, ethers.constants.MaxUint256)
    await stakingToken
      .connect(signers[1])
      .approve(insurancePool.address, ethers.constants.MaxUint256)
    await token.approve(rewardsPool.address, ethers.constants.MaxUint256)
  })

  it('deposit should work correctly', async () => {
    await insurancePool.deposit(toEther(1000))
    await insurancePool.connect(signers[1]).deposit(toEther(3000))

    assert.equal(fromEther(await insurancePool.balanceOf(accounts[0])), 1000)
    assert.equal(fromEther(await insurancePool.balanceOf(accounts[1])), 3000)
    assert.equal(fromEther(await insurancePool.totalDeposits()), 4000)
    assert.equal(fromEther(await insurancePool.totalStaked()), 4000)
    assert.equal(fromEther(await stakingToken.balanceOf(insurancePool.address)), 4000)

    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await rewardsPool.depositRewards(ts + 1000, toEther(1000))
    await time.increase(1000)

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 0)

    await insurancePool.deposit(toEther(100))

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.25)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 250)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 0)
  })

  it('withdraw should work correctly', async () => {
    await insurancePool.deposit(toEther(1200))
    await insurancePool.connect(signers[1]).deposit(toEther(3000))
    await insurancePool.withdraw(toEther(200))

    assert.equal(fromEther(await insurancePool.balanceOf(accounts[0])), 1000)
    assert.equal(fromEther(await insurancePool.balanceOf(accounts[1])), 3000)
    assert.equal(fromEther(await insurancePool.totalDeposits()), 4000)
    assert.equal(fromEther(await insurancePool.totalStaked()), 4000)
    assert.equal(fromEther(await stakingToken.balanceOf(insurancePool.address)), 4000)

    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await rewardsPool.depositRewards(ts + 1000, toEther(1000))
    await time.increase(1000)

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 0)

    await insurancePool.connect(signers[1]).withdraw(toEther(100))

    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.25)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 0)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 750)
  })

  it('claim process should work correctly', async () => {
    await insurancePool.deposit(toEther(1000))
    await insurancePool.connect(signers[1]).deposit(toEther(3000))
    await token.transferAndCall(rewardsPool.address, toEther(1000), '0x')
    await insurancePool.initiateClaim()

    assert.equal(await insurancePool.claimInProgress(), true)
    await expect(insurancePool.deposit(toEther(100))).to.be.revertedWith('ClaimInProgress()')
    await expect(insurancePool.withdraw(toEther(100))).to.be.revertedWith('ClaimInProgress()')
    await expect(insurancePool.executeClaim(toEther(1201))).to.be.revertedWith(
      'ExceedsMaxClaimAmount()'
    )

    await insurancePool.executeClaim(toEther(1200))

    assert.equal(await insurancePool.claimInProgress(), false)
    assert.equal(fromEther(await rewardsPool.withdrawableRewards(accounts[0])), 250)
    assert.equal(fromEther(await rewardsPool.withdrawableRewards(accounts[1])), 750)
    assert.equal(fromEther(await insurancePool.staked(accounts[0])), 1000)
    assert.equal(fromEther(await insurancePool.staked(accounts[1])), 3000)
    assert.equal(fromEther(await insurancePool.balanceOf(accounts[0])), 700)
    assert.equal(fromEther(await insurancePool.balanceOf(accounts[1])), 2100)
    assert.equal(fromEther(await insurancePool.totalDeposits()), 2800)
    assert.equal(fromEther(await insurancePool.totalStaked()), 4000)
    assert.equal(fromEther(await stakingToken.balanceOf(insurancePool.address)), 2800)
  })
})
