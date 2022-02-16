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

describe('OwnersRewardsPool', () => {
  let ownersToken: ERC677
  let allowanceToken: Allowance
  let poolOwners: PoolOwners
  let token: ERC677
  let rewardsPool: OwnersRewardsPool
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

    await allowanceToken.setPoolOwners(poolOwners.address)
    await poolOwners.addToken(token.address, rewardsPool.address)
    await token.transfer(rewardsPool.address, toEther(750))
    await setupToken(ownersToken, accounts)
  })

  it('rewards derivative name, symbol, decimals should be correct', async () => {
    assert.equal(await rewardsPool.name(), 'LinkPool Owners LINK', 'Name should be correct')
    assert.equal(await rewardsPool.symbol(), 'lpoLINK', 'Symbol should be correct')
    assert.equal((await rewardsPool.decimals()).toNumber(), 18, 'Decimals should be correct')
  })

  it('should not be able to distribute rewards when nothing is staked', async () => {
    await assertThrowsAsync(async () => {
      await rewardsPool.distributeRewards()
    }, 'revert')
  })

  it('rewards should not be withdrawable if distribute has not been called', async () => {
    await stake(1, 2500)
    await stake(2, 1250)

    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards()),
      0,
      'Distributed rewards should be 0'
    )
    assert.equal(fromEther(await rewardsPool.rewardPerToken()), 0, 'Reward per token should be 0')
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[1])),
      0,
      'Account-1 reward balance should be 0'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[2])),
      0,
      'Account-2 reward balance should be 0'
    )
  })

  it('should be able to distribute rewards, rewardPerToken and withdrawableRewards should be updated', async () => {
    await rewardsPool.distributeRewards()

    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards()),
      750,
      'Distributed rewards should be 750'
    )
    assert.equal(
      fromEther(await rewardsPool.rewardPerToken()),
      0.2,
      'Reward per token should be 0.2'
    )
  })

  it('should not be able to distribute more rewards than available', async () => {
    await rewardsPool.distributeRewards()

    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards()),
      750,
      'Distributed rewards should be 750'
    )
    assert.equal(
      fromEther(await rewardsPool.rewardPerToken()),
      0.2,
      'Reward per token should be 0.2'
    )
  })

  it('account reward balances should reflect new rewards', async () => {
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[1])),
      500,
      'Account-1 reward balance should be 500'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[2])),
      250,
      'Account-2 reward balance should be 250'
    )
  })

  it('should be able to deposit and distribute rewards using ERC677 function', async () => {
    await token.transferAndCall(rewardsPool.address, toEther(750), '0x00')

    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards()),
      1500,
      'Distributed rewards should be 1500'
    )
    assert.equal(
      fromEther(await rewardsPool.rewardPerToken()),
      0.4,
      'Reward per token should be 0.4'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[1])),
      1000,
      'Account-1 reward balance should be 1000'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[2])),
      500,
      'Account-2 reward balance should be 500'
    )
  })

  it('only rewards token should be able to call ERC677 function', async () => {
    await assertThrowsAsync(async () => {
      await rewardsPool.onTokenTransfer(accounts[0], toEther(750), '0x00')
    }, 'revert')
  })

  it('should be able to withdraw rewards', async () => {
    await rewardsPool.connect(signers[1])['withdraw()']()

    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[1])),
      0,
      'Account-1 reward balance should be 0'
    )
    assert.equal(
      fromEther(await token.balanceOf(accounts[1])),
      1000,
      'Account-1 token balance should be 1000'
    )

    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[2])),
      500,
      'Account-2 reward balance should be 500'
    )
    assert.equal(
      fromEther(await token.balanceOf(accounts[2])),
      0,
      'Account-2 token balance should be 0'
    )

    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards()),
      500,
      'Withdrawable rewards should be 500'
    )
  })

  it('should not be able to withdraw rewards if there are none', async () => {
    await assertThrowsAsync(async () => {
      await rewardsPool.connect(signers[1])['withdraw()']()
    }, 'revert')
  })

  it('staking should have no effect on rewards', async () => {
    await token.transferAndCall(rewardsPool.address, toEther(1500), '0x00')
    await stake(2, 1250)
    await stake(3, 1250)

    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[1])),
      1000,
      'Account-1 unclaimed reward balance should be 1000'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[2])),
      1000,
      'Account-2 unclaimed reward balance should be 1000'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[3])),
      0,
      'Account-3 unclaimed reward balance should be 0'
    )
  })

  it('withdrawing should have no effect on rewards', async () => {
    await token.transferAndCall(rewardsPool.address, toEther(2500), '0x00')
    await withdraw(1, 2500)
    await withdraw(2, 1250)

    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[1])),
      2000,
      'Account-1 unclaimed reward balance should be 2000'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[2])),
      2000,
      'Account-2 unclaimed reward balance should be 2000'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[3])),
      500,
      'Account-3 unclaimed reward balance should be 500'
    )
  })

  it('should be able to transfer unclaimed rewards', async () => {
    await token.transferAndCall(rewardsPool.address, toEther(1000), '0x00')
    await rewardsPool.connect(signers[2]).transfer(accounts[3], toEther(500))

    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[2])),
      2000,
      'Account-2 unclaimed reward balance should be 2000'
    )
    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[3])),
      1500,
      'Account-3 unclaimed reward balance should be 1500'
    )
  })
})
