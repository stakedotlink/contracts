import { Signer } from 'ethers'
import { assert, expect } from 'chai'
import {
  toEther,
  assertThrowsAsync,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
} from './utils/helpers'
import { ERC677, PoolOwners, RewardsPool } from '../typechain-types'

describe('PoolOwners', () => {
  let ownersToken: ERC677
  let token: ERC677
  let rewardsPool: RewardsPool
  let poolOwners: PoolOwners
  let signers: Signer[]
  let accounts: string[]

  async function stake(account: number, amount: number) {
    await ownersToken.connect(signers[account]).approve(poolOwners.address, toEther(amount))
    await poolOwners.connect(signers[account]).stake(toEther(amount))
  }

  async function withdraw(account: number, amount: number) {
    await poolOwners.connect(signers[account]).withdraw(toEther(amount))
  }

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Token1', '1', 1000000000])) as ERC677
    await setupToken(token, accounts)
    ownersToken = (await deploy('ERC677', ['LinkPool', 'LPL', 1000000000])) as ERC677
    await setupToken(ownersToken, accounts)

    poolOwners = (await deploy('PoolOwners', [
      ownersToken.address,
      'stLPL',
      'Staked LinkPool',
    ])) as PoolOwners

    rewardsPool = (await deploy('RewardsPool', [
      poolOwners.address,
      token.address,
      '1',
      '1',
    ])) as RewardsPool

    await poolOwners.addToken(token.address, rewardsPool.address)
  })

  it('should be able to stake tokens', async () => {
    await stake(1, 1000)
    await stake(2, 500)

    assert.equal(
      fromEther(await ownersToken.balanceOf(poolOwners.address)),
      1500,
      'poolOwners balance incorrect'
    )
    assert.equal(
      fromEther(await poolOwners.balanceOf(accounts[1])),
      1000,
      'account-1 stake balance incorrect'
    )
    assert.equal(
      fromEther(await poolOwners.balanceOf(accounts[2])),
      500,
      'account-2 stake balance incorrect'
    )
  })

  it('should be able to stake tokens using onTokenTransfer', async () => {
    await ownersToken.connect(signers[1]).transferAndCall(poolOwners.address, toEther(1000), '0x00')

    assert.equal(
      fromEther(await ownersToken.balanceOf(poolOwners.address)),
      1000,
      'poolOwners balance incorrect'
    )
    assert.equal(
      fromEther(await poolOwners.balanceOf(accounts[1])),
      1000,
      'account-1 stake balance incorrect'
    )
  })

  it('should not be able to stake more tokens than balance', async () => {
    await assertThrowsAsync(async () => {
      await stake(1, 10001)
    }, 'revert')
  })

  it('should be able to withdraw tokens', async () => {
    await stake(1, 1000)
    await stake(2, 500)
    await withdraw(1, 100)
    await withdraw(2, 200)

    assert.equal(
      fromEther(await poolOwners.balanceOf(accounts[1])),
      900,
      'account-1 stake balance incorrect'
    )
    assert.equal(
      fromEther(await poolOwners.balanceOf(accounts[2])),
      300,
      'account-2 stake balance incorrect'
    )
    assert.equal(
      fromEther(await ownersToken.balanceOf(accounts[1])),
      9100,
      'account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await ownersToken.balanceOf(accounts[2])),
      9700,
      'account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await ownersToken.balanceOf(poolOwners.address)),
      1200,
      'poolOwners balance incorrect'
    )
  })

  it('should not be able to withdraw more tokens than staked balance', async () => {
    await stake(1, 1000)
    await assertThrowsAsync(async () => {
      await withdraw(1, 1001)
    }, 'revert')
  })

  it('staking/withdrawing should update rewardsPool rewards', async () => {
    await stake(1, 1000)
    await stake(2, 500)
    token.transferAndCall(rewardsPool.address, toEther(1500), '0x00')

    assert.equal(
      fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[1])),
      0,
      'userRewardPerTokenPaid incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[2])),
      0,
      'userRewardPerTokenPaid incorrect'
    )

    await withdraw(1, 500)
    await stake(2, 500)

    assert.equal(
      fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[1])),
      1,
      'userRewardPerTokenPaid incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.userRewardPerTokenPaid(accounts[2])),
      1,
      'userRewardPerTokenPaid incorrect'
    )
  })

  it.only('should update rewardsPool rewards on derivative transfer', async () => {
    await stake(1, 1000)
    await stake(2, 500)
    await token.transferAndCall(poolOwners.address, toEther(1500), '0x00')

    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[1])),
      1000,
      'reward balance incorrect'
    )
    await poolOwners.connect(signers[1]).transfer(accounts[2], toEther(1000))

    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[1])),
      1000,
      'reward balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[2])),
      500,
      'reward balance incorrect'
    )

    await poolOwners.connect(signers[1]).withdrawRewards([token.address])
    await poolOwners.connect(signers[2]).transfer(accounts[1], toEther(500))
    await token.transferAndCall(poolOwners.address, toEther(1500), '0x00')

    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[1])),
      500,
      'reward balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[2])),
      1500,
      'reward balance incorrect'
    )
  })

  it('rpcStaked and rpcTotalStaked should work correctly', async () => {
    await stake(1, 1000)
    await stake(2, 500)

    assert.equal(fromEther(await poolOwners.rpcStaked(accounts[1])), 1000, 'rpcStaked incorrect')
    assert.equal(fromEther(await poolOwners.rpcTotalStaked()), 1500, 'rpcTotalStaked incorrect')
  })

  it('should be able to distribute rewards onTokenTransfer', async () => {
    await stake(1, 1000)
    await stake(2, 500)

    await token.transferAndCall(poolOwners.address, toEther(1500), '0x00')

    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[1])),
      1000,
      'reward token balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[2])),
      500,
      'reward token balance incorrect'
    )
  })

  it('should not be able to distribute non-supported token onTokenTransfer', async () => {
    await stake(1, 1000)
    await stake(2, 500)

    let token2 = (await deploy('ERC677', ['Token1', '1', 1000000000])) as ERC677
    await setupToken(token2, accounts)

    await expect(
      token2.transferAndCall(poolOwners.address, toEther(1500), '0x00')
    ).to.be.revertedWith('Sender must be staking token or supported rewards token')
  })
})
