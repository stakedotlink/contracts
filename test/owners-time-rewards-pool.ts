import { Signer } from 'ethers'
import { assert } from 'chai'
import { toEther, deploy, getAccounts, setupToken, assertThrowsAsync } from './utils/helpers'
import { Allowance, ERC677, OwnersTimeRewardsPool, PoolOwners } from '../typechain-types'
import { ethers, network } from 'hardhat'
import { fromEther } from './utils/helpers'

describe('OwnersTimeRewardsPool', () => {
  let ownersToken: ERC677
  let allowanceToken: Allowance
  let poolOwners: PoolOwners
  let token: ERC677
  let rewardsPool: OwnersTimeRewardsPool
  let signers: Signer[]
  let accounts: string[]
  let baseTime: number

  async function stake(account: number, amount: number) {
    await ownersToken
      .connect(signers[account])
      .transferAndCall(poolOwners.address, toEther(amount), '0x00')
  }

  async function withdraw(account: number, amount: number) {
    await poolOwners.connect(signers[account]).withdraw(toEther(amount))
  }

  before(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    ;({ signers, accounts } = await getAccounts())

    allowanceToken = (await deploy('Allowance', ['LinkPool Allowance', 'LPLA'])) as Allowance
    ownersToken = (await deploy('ERC677', ['LinkPool', 'LPL', 100000000])) as ERC677
    poolOwners = (await deploy('PoolOwners', [
      ownersToken.address,
      allowanceToken.address,
    ])) as PoolOwners

    rewardsPool = (await deploy('OwnersTimeRewardsPool', [
      poolOwners.address,
      token.address,
      'LinkPool Owners LINK',
      'lpoLINK',
    ])) as OwnersTimeRewardsPool

    await allowanceToken.setPoolOwners(poolOwners.address)
    await poolOwners.addToken(token.address, rewardsPool.address)
    await token.transfer(rewardsPool.address, toEther(750))
    await token.approve(rewardsPool.address, ethers.constants.MaxUint256)
    await setupToken(ownersToken, accounts)
    await stake(1, 750)
    await stake(2, 250)
  })

  it('rewards derivative name, symbol, decimals should be correct', async () => {
    assert.equal(await rewardsPool.name(), 'LinkPool Owners LINK', 'Name should be correct')
    assert.equal(await rewardsPool.symbol(), 'lpoLINK', 'Symbol should be correct')
    assert.equal((await rewardsPool.decimals()).toNumber(), 18, 'Decimals should be correct')
  })

  it('should be able to start reward distribution', async () => {
    await rewardsPool.startRewardsDistribution(toEther(1000), 60)

    const latestTimestamp = (await ethers.provider.getBlock('latest')).timestamp
    baseTime = latestTimestamp

    const periodFinish = (await rewardsPool.periodFinish()).toNumber()
    const lastUpdateTime = (await rewardsPool.lastUpdateTime()).toNumber()
    const rewardRate = fromEther(await rewardsPool.rewardRate())

    assert.equal(periodFinish, latestTimestamp + 60)
    assert.equal(lastUpdateTime, latestTimestamp)
    assert.equal(Math.round(rewardRate), 17)
  })

  it('rewards should distribute over time', async () => {
    await network.provider.send('evm_setNextBlockTimestamp', [baseTime + 6])
    await network.provider.send('evm_mine')

    assert.equal(fromEther(await rewardsPool.rewardPerTokenStored()), 0)
    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.1)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[1])), 75)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[2])), 25)
  })

  it('updateReward should update rewardPerTokenStored and userRewardPerTokenPaid', async () => {
    await network.provider.send('evm_setNextBlockTimestamp', [baseTime + 12])
    await rewardsPool.updateReward(accounts[1])

    assert.equal(fromEther(await rewardsPool.rewardPerTokenStored()), 0.2)
    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.2)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[1])), 0.2)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[2])), 0)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[1])), 150)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[2])), 50)
  })

  it('reward accounting when staking/withdrawing should be correct', async () => {
    await network.provider.send('evm_setNextBlockTimestamp', [baseTime + 18])
    await withdraw(1, 500)
    await network.provider.send('evm_setNextBlockTimestamp', [baseTime + 24])
    await stake(3, 500)

    assert.equal(fromEther(await rewardsPool.rewardPerTokenStored()), 0.5)
    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.5)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[1])), 0.3)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[2])), 0)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[3])), 0.5)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[1])), 275)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[2])), 125)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[3])), 0)
  })

  it('reward accounting when withdrawing rewards should be correct', async () => {
    await network.provider.send('evm_setNextBlockTimestamp', [baseTime + 30])
    await rewardsPool.connect(signers[3])['withdraw()']()

    assert.equal(fromEther(await rewardsPool.rewardPerTokenStored()), 0.6)
    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.6)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[1])), 0.3)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[2])), 0)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[3])), 0.6)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[1])), 300)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[2])), 150)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[3])), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[3])), 50)
  })

  it('should be able to start new reward distribution using onTokenTransfer, leftover should be added to new distribution', async () => {
    await network.provider.send('evm_setNextBlockTimestamp', [baseTime + 36])
    await token.transferAndCall(
      rewardsPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint'], [100])
    )

    const latestTimestamp = (await ethers.provider.getBlock('latest')).timestamp

    const periodFinish = (await rewardsPool.periodFinish()).toNumber()
    const lastUpdateTime = (await rewardsPool.lastUpdateTime()).toNumber()
    const rewardRate = fromEther(await rewardsPool.rewardRate())

    assert.equal(periodFinish, latestTimestamp + 100)
    assert.equal(lastUpdateTime, latestTimestamp)
    assert.equal(rewardRate, 8)
    assert.equal(fromEther(await rewardsPool.rewardPerTokenStored()), 0.7)
    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.7)
  })

  it('should be able to transfer rewards', async () => {
    await network.provider.send('evm_setNextBlockTimestamp', [baseTime + 46])
    await rewardsPool.connect(signers[2]).transfer(accounts[1], toEther(100))

    assert.equal(fromEther(await rewardsPool.rewardPerTokenStored()), 0.78)
    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0.78)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[1])), 0.3)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[2])), 0.78)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[3])), 0.6)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[1])), 445)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[2])), 95)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[3])), 90)
  })

  it('after distriubution period ends, all reward balances should be correct', async () => {
    await network.provider.send('evm_setNextBlockTimestamp', [baseTime + 146])
    await network.provider.send('evm_mine')

    assert.equal(fromEther(await rewardsPool.rewardPerTokenStored()), 0.78)
    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 1.5)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[1])), 0.3)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[2])), 0.78)
    assert.equal(fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[3])), 0.6)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[1])), 625)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[2])), 275)
    assert.equal(fromEther(await rewardsPool.balanceOf(accounts[3])), 450)
  })

  it('onTokenTransfer should only be callable by token', async () => {
    await assertThrowsAsync(async () => {
      await rewardsPool.onTokenTransfer(
        accounts[0],
        toEther(400),
        ethers.utils.defaultAbiCoder.encode(['uint'], [100])
      )
    }, 'revert')
  })

  it('only owner should be able to start new reward distributions', async () => {
    await token.transfer(accounts[4], toEther(5000))
    await token.connect(signers[4]).approve(rewardsPool.address, toEther(5000))

    await assertThrowsAsync(async () => {
      await token
        .connect(signers[4])
        .transferAndCall(
          rewardsPool.address,
          toEther(400),
          ethers.utils.defaultAbiCoder.encode(['uint'], [100])
        )
    }, 'revert')
    await assertThrowsAsync(async () => {
      await rewardsPool.connect(signers[4]).startRewardsDistribution(toEther(1000), 60)
    }, 'revert')
  })
})
