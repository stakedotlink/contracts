//@ts-nocheck

import { ethers } from 'hardhat'
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
import { ERC677, RewardsPool, RewardsPoolControllerMock } from '../typechain-types'

describe('RewardsPoolController', () => {
  let stakingToken: ERC677
  let token1: ERC677
  let token2: ERC677
  let rewardsPool1: RewardsPool
  let rewardsPool2: RewardsPool
  let controller: RewardsPoolControllerMock
  let signers: Signer[]
  let accounts: string[]

  async function stake(account: number, amount: number) {
    await stakingToken.connect(signers[account]).approve(controller.address, toEther(amount))
    await controller.connect(signers[account]).stake(toEther(amount))
  }

  async function withdraw(account: number, amount: number) {
    await controller.connect(signers[account]).withdraw(toEther(amount))
  }

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token1 = (await deploy('ERC677', ['Token1', '1', 1000000000])) as ERC677
    await setupToken(token1, accounts)
    token2 = (await deploy('ERC677', ['Token2', '2', 1000000000])) as ERC677
    await setupToken(token2, accounts)
    stakingToken = (await deploy('ERC677', ['StakingToken', 'ST', 1000000000])) as ERC677
    await setupToken(stakingToken, accounts)

    controller = (await deploy('RewardsPoolControllerMock', [
      stakingToken.address,
    ])) as RewardsPoolControllerMock

    rewardsPool1 = (await deploy('RewardsPool', [
      controller.address,
      token1.address,
      '1',
      '1',
    ])) as RewardsPool
    rewardsPool2 = (await deploy('RewardsPool', [
      controller.address,
      token2.address,
      '2',
      '2',
    ])) as RewardsPool

    await controller.addToken(token1.address, rewardsPool1.address)
    await controller.addToken(token2.address, rewardsPool2.address)
  })

  it('should be able to add tokens', async () => {
    const token3 = (await deploy('ERC677', ['Token3', '3', 1000000000])) as ERC677
    const rewardsPool3 = (await deploy('RewardsPool', [
      controller.address,
      token3.address,
      '3',
      '3',
    ])) as RewardsPool
    await controller.addToken(token3.address, rewardsPool3.address)
    assert.equal(
      JSON.stringify(await controller.supportedTokens()),
      JSON.stringify([
        [token1.address, rewardsPool1.address],
        [token2.address, rewardsPool2.address],
        [token3.address, rewardsPool3.address],
      ]),
      'supportedTokens incorrect'
    )
  })

  it('should not be able to add token thats already supported', async () => {
    await assertThrowsAsync(async () => {
      await controller.addToken(token1.address, rewardsPool1.address)
    }, 'revert')
  })

  it('should be able to remove tokens', async () => {
    await controller.removeToken(0)
    assert.equal(
      JSON.stringify(await controller.supportedTokens()),
      JSON.stringify([[token2.address, rewardsPool2.address]]),
      'supportedTokens incorrect'
    )
  })

  it('should not be able to remove token thats not supported', async () => {
    await assertThrowsAsync(async () => {
      await controller.removeToken(2)
    }, 'revert')
  })

  it('withdrawableRewards should work correctly', async () => {
    await stake(1, 1000)
    await stake(2, 500)
    await token1.transferAndCall(rewardsPool1.address, toEther(900), '0x00')
    await token2.transferAndCall(rewardsPool2.address, toEther(300), '0x00')

    assert.equal(
      JSON.stringify((await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))),
      JSON.stringify([600, 200]),
      'account-1 withdrawableRewards incorrect'
    )
    assert.equal(
      JSON.stringify((await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))),
      JSON.stringify([300, 100]),
      'account-2 withdrawableRewards incorrect'
    )
  })

  it('withdrawRewards should work correctly', async () => {
    await stake(1, 1000)
    await stake(2, 500)
    await token1.transferAndCall(rewardsPool1.address, toEther(900), '0x00')
    await token2.transferAndCall(rewardsPool2.address, toEther(300), '0x00')
    await controller.connect(signers[1]).withdrawRewards([0, 1])
    await controller.connect(signers[2]).withdrawRewards([1])

    assert.equal(
      fromEther(await token1.balanceOf(accounts[1])),
      10600,
      'account-1 token-1 balance incorrect'
    )
    assert.equal(
      fromEther(await token2.balanceOf(accounts[1])),
      10200,
      'account-1 token-2 balance incorrect'
    )
    assert.equal(
      fromEther(await token1.balanceOf(accounts[2])),
      10000,
      'account-2 token-1 balance incorrect'
    )
    assert.equal(
      fromEther(await token2.balanceOf(accounts[2])),
      10100,
      'account-2 token-2 balance incorrect'
    )
    assert.equal(
      JSON.stringify((await controller.withdrawableRewards(accounts[1])).map((r) => fromEther(r))),
      JSON.stringify([0, 0]),
      'account-1 withdrawableRewards incorrect'
    )
    assert.equal(
      JSON.stringify((await controller.withdrawableRewards(accounts[2])).map((r) => fromEther(r))),
      JSON.stringify([300, 0]),
      'account-2 withdrawableRewards incorrect'
    )
  })

  it('staking/withdrawing should update all rewards', async () => {
    await stake(1, 1000)
    await stake(2, 500)
    await token1.transferAndCall(rewardsPool1.address, toEther(900), '0x00')
    await token2.transferAndCall(rewardsPool2.address, toEther(300), '0x00')

    assert.equal(
      await rewardsPool1.userRewardPerTokenPaid(accounts[1]),
      0,
      'userRewardPerTokenPaid incorrect'
    )
    assert.equal(
      await rewardsPool1.userRewardPerTokenPaid(accounts[2]),
      0,
      'userRewardPerTokenPaid incorrect'
    )
    assert.equal(
      await rewardsPool2.userRewardPerTokenPaid(accounts[1]),
      0,
      'userRewardPerTokenPaid incorrect'
    )
    assert.equal(
      await rewardsPool2.userRewardPerTokenPaid(accounts[2]),
      0,
      'userRewardPerTokenPaid incorrect'
    )

    await withdraw(1, 500)
    await stake(2, 500)

    assert.equal(
      fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[1])),
      0.6,
      'userRewardPerTokenPaid incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[2])),
      0.6,
      'userRewardPerTokenPaid incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[1])),
      0.2,
      'userRewardPerTokenPaid incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[2])),
      0.2,
      'userRewardPerTokenPaid incorrect'
    )
  })
})
