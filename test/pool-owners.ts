import { Signer } from 'ethers'
import { assert } from 'chai'
import {
  toEther,
  assertThrowsAsync,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
} from './utils/helpers'
import { Allowance, ERC677, OwnersRewardsPool, PoolOwners } from '../typechain-types'
import { ethers } from 'hardhat'

describe('PoolOwners', () => {
  let token: ERC677
  let token2: ERC677
  let rewardsPool: OwnersRewardsPool
  let rewardsPool2: OwnersRewardsPool
  let ownersToken: ERC677
  let allowanceToken: Allowance
  let poolOwners: PoolOwners
  let signers: Signer[]
  let accounts: string[]

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
    token2 = (await deploy('ERC677', ['Token 2', 'T2', 1000000])) as ERC677
    ;({ signers, accounts } = await getAccounts())

    allowanceToken = (await deploy('Allowance', ['LinkPool Allowance', 'LPLA'])) as Allowance
    ownersToken = (await deploy('ERC677', ['LinkPool', 'LPL', 100000000])) as ERC677
    poolOwners = (await deploy('PoolOwners', [
      ownersToken.address,
      allowanceToken.address,
    ])) as PoolOwners

    rewardsPool = (await deploy('OwnersRewardsPool', [
      poolOwners.address,
      token.address,
      'LinkPool Owners LINK',
      'lpoLINK',
    ])) as OwnersRewardsPool
    rewardsPool2 = (await deploy('OwnersRewardsPool', [
      poolOwners.address,
      token2.address,
      'LinkPool Owners T2',
      'lpoT2',
    ])) as OwnersRewardsPool

    await allowanceToken.setPoolOwners(poolOwners.address)
    await poolOwners.addToken(token.address, rewardsPool.address)
    await setupToken(ownersToken, accounts)
  })

  it('should be able to stake LPL and receive allowance tokens', async () => {
    await stake(1, 3000)

    assert.equal(
      fromEther(await ownersToken.balanceOf(accounts[1])),
      7000,
      'Account-1 LPL balance should be 7000'
    )
    assert.equal(
      fromEther(await poolOwners.balanceOf(accounts[1])),
      3000,
      'Account-1 staked balance should be 3000'
    )
    assert.equal(
      fromEther(await allowanceToken.balanceOf(accounts[1])),
      3000,
      'Account-1 allowance balance should be 3000'
    )
  })

  it('only ownersToken should be able to call ERC677 stake function', async () => {
    await assertThrowsAsync(async () => {
      await poolOwners.onTokenTransfer(accounts[2], toEther(1), '0x00')
    }, 'revert')
  })

  it('should be able to stake using ERC20 stake function', async () => {
    await ownersToken.connect(signers[2]).approve(poolOwners.address, toEther(500))
    await ownersToken.connect(signers[3]).approve(poolOwners.address, toEther(500))
    await poolOwners.connect(signers[2]).stake(toEther(500))
    await poolOwners.connect(signers[3]).stake(toEther(500))

    assert.equal(
      fromEther(await ownersToken.balanceOf(accounts[2])),
      9500,
      'Account-2 LPL balance should be 9500'
    )
    assert.equal(
      fromEther(await poolOwners.balanceOf(accounts[2])),
      500,
      'Account-2 staked balance should be 500'
    )
    assert.equal(
      fromEther(await allowanceToken.balanceOf(accounts[2])),
      500,
      'Account-2 allowance balance should be 500'
    )
  })

  it('should not be able to stake more than LPL balance', async () => {
    await assertThrowsAsync(async () => {
      await stake(1, 7001)
    }, 'revert')
  })

  it('totalSupply, balanceOf should return correct amounts', async () => {
    assert.equal(fromEther(await poolOwners.totalSupply()), 4000, 'Total supply should be 4000')
    assert.equal(
      fromEther(await poolOwners.balanceOf(accounts[2])),
      500,
      'Account-2 balance should be 500'
    )
  })

  it('should be able to add reward tokens', async () => {
    await poolOwners.addToken(token2.address, rewardsPool2.address)

    let supportedTokens = await poolOwners.supportedTokens()
    assert.equal(supportedTokens[1], token2.address, 'New token address should be added')
    assert.equal(
      await poolOwners.rewardPools(supportedTokens[1]),
      rewardsPool2.address,
      'New reward pool should be added'
    )
  })

  it('should not be able to add reward token that has already been added', async () => {
    await assertThrowsAsync(async () => {
      await poolOwners.addToken(token2.address, rewardsPool2.address)
    }, 'revert')
  })

  it('withdrawableRewards should show correct amounts', async () => {
    await token.transferAndCall(rewardsPool.address, toEther(1000), '0x00')
    await token2.transferAndCall(rewardsPool2.address, toEther(2000), '0x00')

    const withdrawable1 = await poolOwners.withdrawableRewards(accounts[1])
    const withdrawable2 = await poolOwners.withdrawableRewards(accounts[2])

    assert.equal(
      fromEther(withdrawable1[0]),
      750,
      'Account-1 first token withdrawable should be 750'
    )
    assert.equal(
      fromEther(withdrawable2[0]),
      125,
      'Account-2 first token withdrawable should be 125'
    )
    assert.equal(
      fromEther(withdrawable1[1]),
      1500,
      'Account-1 second token withdrawable should be 1500'
    )
    assert.equal(
      fromEther(withdrawable2[1]),
      250,
      'Account-2 second token withdrawable should be 250'
    )
  })

  it('should be able to withdraw rewards for all assets', async () => {
    await poolOwners.connect(signers[1]).withdrawAllRewards()
    await poolOwners.connect(signers[2]).withdrawAllRewards()

    assert.equal(
      fromEther(await token.balanceOf(accounts[1])),
      750,
      'Account-1 first token balance should be 750'
    )
    assert.equal(
      fromEther(await token.balanceOf(accounts[2])),
      125,
      'Account-2 first token balance should be 125'
    )
    assert.equal(
      fromEther(await token2.balanceOf(accounts[1])),
      1500,
      'Account-1 second token balance should be 1500'
    )
    assert.equal(
      fromEther(await token2.balanceOf(accounts[2])),
      250,
      'Account-2 second token balance should be 250'
    )
  })

  it('should not be able to withdraw more rewards than earned', async () => {
    await poolOwners.connect(signers[1]).withdrawAllRewards()
    await poolOwners.connect(signers[2]).withdrawAllRewards()
    await poolOwners.connect(signers[1]).withdrawRewards(token.address)
    await poolOwners.connect(signers[2]).withdrawRewards(token2.address)

    assert.equal(
      fromEther(await token.balanceOf(accounts[1])),
      750,
      'Account-1 first token balance should be 750'
    )
    assert.equal(
      fromEther(await token.balanceOf(accounts[2])),
      125,
      'Account-2 first token balance should be 125'
    )
    assert.equal(
      fromEther(await token2.balanceOf(accounts[1])),
      1500,
      'Account-1 second token balance should be 1500'
    )
    assert.equal(
      fromEther(await token2.balanceOf(accounts[2])),
      250,
      'Account-2 second token balance should be 250'
    )
  })

  it('should be able to withdraw rewards for a single asset', async () => {
    await poolOwners.connect(signers[3]).withdrawRewards(token.address)

    assert.equal(
      fromEther(await token.balanceOf(accounts[3])),
      125,
      'Account-3 first token balance should be 125'
    )
  })

  it('should be able to withdraw LPL', async () => {
    await withdraw(1, 1500)

    assert.equal(
      fromEther(await ownersToken.balanceOf(accounts[1])),
      8500,
      'Account-1 LPL balance should be 8500'
    )
    assert.equal(
      fromEther(await poolOwners.balanceOf(accounts[1])),
      1500,
      'Account-1 staked balance should be 1500'
    )
    assert.equal(
      fromEther(await allowanceToken.balanceOf(accounts[1])),
      1500,
      'Account-1 allowance balance should be 1500'
    )
  })

  it('staking/withdrawing LPL should have no effect on rewards', async () => {
    await token.transferAndCall(rewardsPool.address, toEther(1000), '0x00')
    await token2.transferAndCall(rewardsPool2.address, toEther(2000), '0x00')
    await withdraw(1, 1500)
    await stake(2, 500)
    await stake(3, 500)
    await poolOwners.connect(signers[1]).withdrawAllRewards()
    await poolOwners.connect(signers[2]).withdrawAllRewards()

    assert.equal(
      fromEther(await token.balanceOf(accounts[1])),
      1350,
      'Account-1 first token balance should be 1350'
    )
    assert.equal(
      fromEther(await token.balanceOf(accounts[2])),
      325,
      'Account-2 first token balance should be 325'
    )
    assert.equal(
      fromEther(await token2.balanceOf(accounts[1])),
      2700,
      'Account-1 second token balance should be 2700'
    )
    assert.equal(
      fromEther(await token2.balanceOf(accounts[2])),
      650,
      'Account-2 second token balance should be 650'
    )
  })

  it('should not be able to withdraw more LPL than staked balance balance', async () => {
    await stake(1, 1000)
    await allowanceToken.connect(signers[2]).transfer(accounts[1], toEther(100))
    await assertThrowsAsync(async () => {
      await withdraw(1, 1100)
    }, 'revert')
    await allowanceToken.connect(signers[1]).transfer(accounts[2], toEther(100))
  })

  it('should not be able to withrdaw more LPL than allowance balance', async () => {
    await allowanceToken.connect(signers[1]).transfer(accounts[0], toEther(900))
    await assertThrowsAsync(async () => {
      await withdraw(1, 101)
    }, 'revert')
    await allowanceToken.transfer(accounts[1], toEther(900))
    await withdraw(1, 1000)
  })

  it('exiting should withdraw all rewards and staked LPL', async () => {
    await token.transferAndCall(rewardsPool.address, toEther(1000), '0x00')
    await token2.transferAndCall(rewardsPool2.address, toEther(1000), '0x00')
    await poolOwners.connect(signers[2]).exit()

    assert.equal(
      fromEther(await ownersToken.balanceOf(accounts[2])),
      10000,
      'Account-2 LPL balance should be 10000'
    )
    assert.equal(
      fromEther(await poolOwners.balanceOf(accounts[2])),
      0,
      'Account-2 staked balance should be 0'
    )
    assert.equal(
      fromEther(await allowanceToken.balanceOf(accounts[2])),
      0,
      'Account-2 allowance balance should be 0'
    )
    assert.equal(
      Math.round(Number(fromEther(await token.balanceOf(accounts[2])))),
      825,
      'Account-2 first token balance should be 825'
    )
    assert.equal(
      Math.round(Number(fromEther(await token2.balanceOf(accounts[2])))),
      1150,
      'Account-2 second token balance should be 1150'
    )
  })

  it('should be able to remove reward tokens', async () => {
    await poolOwners.removeToken(token.address)

    const supportedTokens = await poolOwners.supportedTokens()

    assert.equal(supportedTokens.length, 1, 'Token should be removed')
    assert.equal(
      await poolOwners.rewardPools(token.address),
      ethers.constants.AddressZero,
      'Reward pool should be removed'
    )

    assert.equal(supportedTokens[0], token2.address, 'Second token should still exists')
    assert.equal(
      await poolOwners.rewardPools(token2.address),
      rewardsPool2.address,
      'Second reward pool should still exists'
    )
  })

  it('should not be able to remove unsupported reward token', async () => {
    await assertThrowsAsync(async () => {
      await poolOwners.removeToken(token.address)
    }, 'revert')
  })

  it('only owner should be able to add/remove reward tokens', async () => {
    await assertThrowsAsync(async () => {
      await poolOwners.connect(signers[1]).removeToken(token2.address)
    }, 'revert')
    await assertThrowsAsync(async () => {
      await poolOwners.connect(signers[1]).addToken(token.address, rewardsPool.address)
    }, 'revert')
  })
})
