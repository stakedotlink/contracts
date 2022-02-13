import { ethers } from 'hardhat'
import { Signer } from 'ethers'
import { assert } from 'chai'
import {
  toEther,
  deploy,
  getAccounts,
  assertThrowsAsync,
  setupToken,
  fromEther,
} from './utils/helpers'
import { ERC677, ExampleStrategy, PoolRouter, StakingPool } from '../typechain-types'

describe('PoolRouter', () => {
  let token: ERC677
  let token2: ERC677
  let allowance: ERC677
  let poolRouter: PoolRouter
  let stakingPool: StakingPool
  let stakingPool2: StakingPool
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    token2 = (await deploy('ERC677', ['Token 2', 'T2', 1000000000])) as ERC677
    ;({ signers, accounts } = await getAccounts())

    allowance = (await deploy('ERC677', ['LinkPool Allowance', 'LPLA', 100000000])) as ERC677
    poolRouter = (await deploy('PoolRouter', [allowance.address])) as PoolRouter

    stakingPool = (await deploy('StakingPool', [
      token.address,
      'LinkPool LINK',
      'lpLINK',
      accounts[4],
      '2500',
      poolRouter.address,
    ])) as StakingPool
    stakingPool2 = (await deploy('StakingPool', [
      token2.address,
      'LinkPool T2',
      'lpT2',
      accounts[4],
      '2500',
      poolRouter.address,
    ])) as StakingPool

    const strategy = (await deploy('ExampleStrategy', [
      token.address,
      stakingPool.address,
      accounts[0],
      toEther(5000),
      toEther(10),
    ])) as ExampleStrategy
    const strategy2 = (await deploy('ExampleStrategy', [
      token2.address,
      stakingPool2.address,
      accounts[0],
      toEther(5000),
      toEther(10),
    ])) as ExampleStrategy

    await stakingPool.addStrategy(strategy.address)
    await stakingPool2.addStrategy(strategy2.address)

    await setupToken(token, accounts)
    await setupToken(token2, accounts)
    await setupToken(allowance, accounts)
  })

  it('should be able to add new tokens', async () => {
    await poolRouter.addToken(token.address, stakingPool.address, toEther(0.1))
    await poolRouter.addToken(token2.address, stakingPool2.address, toEther(0.5))

    const tokens = await poolRouter.supportedTokens()

    assert.equal(tokens[0], token.address)
    assert.equal(tokens[1], token2.address)

    const config = await poolRouter.tokenConfigs(tokens[0])
    const config2 = await poolRouter.tokenConfigs(tokens[1])

    assert.equal(config[0], token.address)
    assert.equal(config[1], stakingPool.address)
    assert.equal(fromEther(config[2]), 0.1)

    assert.equal(config2[0], token2.address)
    assert.equal(config2[1], stakingPool2.address)
    assert.equal(fromEther(config2[2]), 0.5)
  })

  it('should be able to stake allowance using onTokenTransfer', async () => {
    await allowance.connect(signers[1]).transferAndCall(poolRouter.address, toEther(2000), '0x00')
    await allowance.connect(signers[2]).transferAndCall(poolRouter.address, toEther(10000), '0x00')
    await allowance.connect(signers[3]).transferAndCall(poolRouter.address, toEther(3000), '0x00')

    assert.equal(fromEther(await poolRouter.allowanceStakes(accounts[1])), 2000)
    assert.equal(fromEther(await poolRouter.allowanceStakes(accounts[2])), 10000)
    assert.equal(fromEther(await poolRouter.allowanceStakes(accounts[3])), 3000)
    assert.equal(fromEther(await allowance.balanceOf(poolRouter.address)), 15000)
  })

  it('should not be able to stake more than allowance balance', async () => {
    await assertThrowsAsync(async () => {
      await allowance
        .connect(signers[1])
        .transferAndCall(poolRouter.address, toEther(10000), '0x00')
    }, 'revert')
  })

  it('should be able to stake tokens using onTokenTransfer and stake functions', async () => {
    await token.connect(signers[1]).transferAndCall(poolRouter.address, toEther(100), '0x00')
    await token2.connect(signers[2]).transferAndCall(poolRouter.address, toEther(200), '0x00')
    await token.connect(signers[3]).transferAndCall(poolRouter.address, toEther(300), '0x00')
    await token2.connect(signers[1]).approve(poolRouter.address, toEther(10000))
    await token.connect(signers[2]).approve(poolRouter.address, toEther(10000))
    await token2.connect(signers[3]).approve(poolRouter.address, toEther(10000))
    await poolRouter.connect(signers[1]).stake(token2.address, toEther(400))
    await poolRouter.connect(signers[2]).stake(token.address, toEther(500))
    await poolRouter.connect(signers[3]).stake(token2.address, toEther(600))

    assert.equal(fromEther(await poolRouter.tokenStakes(token.address, accounts[1])), 100)
    assert.equal(fromEther(await poolRouter.tokenStakes(token2.address, accounts[2])), 200)
    assert.equal(fromEther(await poolRouter.tokenStakes(token.address, accounts[3])), 300)
    assert.equal(fromEther(await poolRouter.tokenStakes(token2.address, accounts[1])), 400)
    assert.equal(fromEther(await poolRouter.tokenStakes(token.address, accounts[2])), 500)
    assert.equal(fromEther(await poolRouter.tokenStakes(token2.address, accounts[3])), 600)

    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 100)
    assert.equal(fromEther(await stakingPool2.balanceOf(accounts[2])), 200)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[3])), 300)
    assert.equal(fromEther(await stakingPool2.balanceOf(accounts[1])), 400)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 500)
    assert.equal(fromEther(await stakingPool2.balanceOf(accounts[3])), 600)
  })

  it('should not be able to stake more than token balance', async () => {
    await token.connect(signers[2]).transfer(accounts[0], toEther(9000))
    await assertThrowsAsync(async () => {
      await token.connect(signers[2]).transferAndCall(poolRouter.address, toEther(501), '0x00')
    }, 'revert')
    await assertThrowsAsync(async () => {
      await poolRouter.connect(signers[2]).stake(token.address, toEther(501))
    }, 'revert')
  })

  it('should be able to withdraw allowance', async () => {
    await poolRouter.connect(signers[1]).withdrawAllowance(toEther(500))
    await poolRouter.connect(signers[2]).withdrawAllowance(toEther(400))

    assert.equal(fromEther(await poolRouter.allowanceStakes(accounts[1])), 1500)
    assert.equal(fromEther(await poolRouter.allowanceStakes(accounts[2])), 9600)
    assert.equal(fromEther(await allowance.balanceOf(accounts[1])), 8500)
    assert.equal(fromEther(await allowance.balanceOf(accounts[2])), 400)
  })

  it('should be able to withdraw tokens', async () => {
    await poolRouter.connect(signers[1]).withdraw(token.address, toEther(100))
    await poolRouter.connect(signers[2]).withdraw(token2.address, toEther(150))

    assert.equal(fromEther(await poolRouter.tokenStakes(token.address, accounts[1])), 0)
    assert.equal(fromEther(await poolRouter.tokenStakes(token2.address, accounts[2])), 50)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 10000)
    assert.equal(fromEther(await token2.balanceOf(accounts[2])), 9950)
  })

  it('should not be able to withdraw more allowance than balance or allowance that is in use', async () => {
    await assertThrowsAsync(async () => {
      await poolRouter.connect(signers[1]).withdrawAllowance(toEther(1501))
    }, 'revert')
    await assertThrowsAsync(async () => {
      await poolRouter.connect(signers[3]).withdrawAllowance(toEther(1))
    }, 'revert')
  })

  it('should not be able to withdraw more tokens than balance', async () => {
    await assertThrowsAsync(async () => {
      await poolRouter.connect(signers[2]).withdraw(token2.address, toEther(51))
    }, 'revert')
  })

  it('unusedAllowance calculations should be correct', async () => {
    await token.connect(signers[1]).transferAndCall(poolRouter.address, toEther(10), '0x00')

    assert.equal(fromEther(await poolRouter.unusedAllowance(accounts[1])), 700)
    assert.equal(fromEther(await poolRouter.unusedAllowance(accounts[2])), 4600)
    assert.equal(fromEther(await poolRouter.unusedAllowance(accounts[3])), 0)
  })

  it('onTokenTransfer should only be callable by allowance or tokens', async () => {
    await assertThrowsAsync(async () => {
      await poolRouter.connect(signers[2]).onTokenTransfer(accounts[2], toEther(1), '0x00')
    }, 'revert')
  })

  it('should be able to remove token', async () => {
    await poolRouter.removeToken(token.address)

    const tokens = await poolRouter.supportedTokens()

    assert.equal(tokens[0], token2.address)
    assert.equal(tokens.length, 1)

    const config = await poolRouter.tokenConfigs(token.address)
    const config2 = await poolRouter.tokenConfigs(tokens[0])

    assert.equal(config[0], ethers.constants.AddressZero)

    assert.equal(config2[0], token2.address)
    assert.equal(config2[1], stakingPool2.address)
    assert.equal(fromEther(config2[2]), 0.5)
  })

  it('should be able to set stake per allowance', async () => {
    await poolRouter.setStakePerAllowance(token2.address, toEther(100))
    assert.equal(fromEther((await poolRouter.tokenConfigs(token2.address))[2]), 100)
  })

  it('only owner should be able to add/remove tokens, set stake per allowance', async () => {
    await assertThrowsAsync(async () => {
      await poolRouter.connect(signers[1]).addToken(token.address, stakingPool.address, 1)
    }, 'revert')
    await assertThrowsAsync(async () => {
      await poolRouter.connect(signers[1]).removeToken(token2.address)
    }, 'revert')
    await assertThrowsAsync(async () => {
      await poolRouter.connect(signers[1]).setStakePerAllowance(token2.address, toEther(1))
    }, 'revert')
  })
})
