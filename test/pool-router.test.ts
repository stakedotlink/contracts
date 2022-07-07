import { ethers } from 'hardhat'
import { Signer } from 'ethers'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  padBytes,
} from './utils/helpers'
import {
  ERC677,
  StrategyMock,
  StakingPool,
  WrappedSDToken,
  PoolRouter,
  StakingAllowance,
} from '../typechain-types'

describe('PoolRouter', () => {
  let token1: ERC677
  let token2: ERC677
  let allowanceToken: StakingAllowance
  let poolRouter: PoolRouter
  let stakingPool1: StakingPool
  let stakingPool2: StakingPool
  let stakingPool3: StakingPool
  let ownersRewards: string
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
    ownersRewards = accounts[4]
  })

  async function createPool(poolRouter: PoolRouter, token: string): Promise<StakingPool> {
    let stakingPool = (await deploy('StakingPool', [
      token,
      'LinkPool LINK',
      'lpLINK',
      [[ownersRewards, 1000]],
      poolRouter.address,
    ])) as StakingPool

    let wsdToken = (await deploy('WrappedSDToken', [
      stakingPool.address,
      'Wrapped LinkPool LINK',
      'wlplLINK',
    ])) as WrappedSDToken
    await stakingPool.setWSDToken(wsdToken.address)

    let strategy1 = (await deployUpgradeable('StrategyMock', [
      token,
      stakingPool.address,
      toEther(1000),
      toEther(0),
    ])) as StrategyMock
    let strategy2 = (await deployUpgradeable('StrategyMock', [
      token,
      stakingPool.address,
      toEther(2000),
      toEther(0),
    ])) as StrategyMock
    let strategy3 = (await deployUpgradeable('StrategyMock', [
      token,
      stakingPool.address,
      toEther(10000),
      toEther(0),
    ])) as StrategyMock

    await stakingPool.addStrategy(strategy1.address)
    await stakingPool.addStrategy(strategy2.address)
    await stakingPool.addStrategy(strategy3.address)

    await poolRouter.addPool(token, stakingPool.address, true)
    await token1.approve(stakingPool.address, ethers.constants.MaxUint256)
    await token2.approve(stakingPool.address, ethers.constants.MaxUint256)

    return stakingPool
  }

  async function stakeAllowances() {
    await allowanceToken.transferAndCall(poolRouter.address, toEther(10), '0x')
    await allowanceToken.connect(signers[1]).transferAndCall(poolRouter.address, toEther(20), '0x')
    await allowanceToken.connect(signers[2]).transferAndCall(poolRouter.address, toEther(30), '0x')
  }

  beforeEach(async () => {
    token1 = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token1, accounts)

    token2 = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token2, accounts)

    allowanceToken = (await deploy('StakingAllowance', [
      'Staking Allowance',
      'STA',
    ])) as StakingAllowance
    await allowanceToken.connect(signers[0])
    await allowanceToken.mint(accounts[0], toEther(10000))
    await allowanceToken.transfer(accounts[1], toEther(2000))
    await allowanceToken.transfer(accounts[2], toEther(2000))

    poolRouter = (await deploy('PoolRouter', [allowanceToken.address])) as PoolRouter

    stakingPool1 = await createPool(poolRouter, token1.address)
    stakingPool2 = await createPool(poolRouter, token1.address)
    stakingPool3 = await createPool(poolRouter, token2.address)

    await stakeAllowances()
  })

  it('should return a list of supported tokens', async () => {
    let supportedTokens = await poolRouter.supportedTokens()
    assert.equal(
      JSON.stringify(supportedTokens),
      JSON.stringify([token1.address, token2.address]),
      'supported tokens do not match'
    )
  })

  it('should return a list of supported pools by token address', async () => {
    let pools = await poolRouter.poolsByToken(token1.address)
    assert.equal(
      JSON.stringify(pools),
      JSON.stringify([stakingPool1.address, stakingPool2.address]),
      'pools do not match'
    )
    pools = await poolRouter.poolsByToken(token2.address)
    assert.equal(
      JSON.stringify(pools),
      JSON.stringify([stakingPool3.address]),
      'pools do not match'
    )
  })

  it('should return a list of all pools', async () => {
    let pools = await poolRouter.allPools()
    assert.equal(
      JSON.stringify(pools),
      JSON.stringify([
        [token1.address, token1.address, token2.address],
        [stakingPool1.address, stakingPool2.address, stakingPool3.address],
      ]),
      'pools do not match'
    )
  })

  it('should be able to stake allowance token by transferAndCall', async () => {
    let stakedAllowance = await poolRouter.allowanceStakes(accounts[0])
    assert.equal(fromEther(stakedAllowance), 10, 'staked balances do not match')
    stakedAllowance = await poolRouter.allowanceStakes(accounts[1])
    assert.equal(fromEther(stakedAllowance), 20, 'staked balances do not match')
    stakedAllowance = await poolRouter.allowanceStakes(accounts[2])
    assert.equal(fromEther(stakedAllowance), 30, 'staked balances do not match')
  })

  it('should not be able to stake an unsupported token', async () => {
    let token = (await deploy('ERC677', ['Unknown', 'ANON', 1000000000])) as ERC677
    await setupToken(token, accounts)
    await expect(token.transferAndCall(poolRouter.address, toEther(10), '0x')).to.be.revertedWith(
      'Only callable by supported tokens'
    )
  })

  it('should be able to stake allowance', async () => {
    await allowanceToken.approve(poolRouter.address, toEther(10))
    await poolRouter.stakeAllowance(toEther(10))
    let stakedAllowance = await poolRouter.allowanceStakes(accounts[0])
    assert.equal(fromEther(stakedAllowance), 20, 'staked balances do not match')
  })

  it('should correctly calculate allowance required', async () => {
    let allowanceRequired = await poolRouter.allowanceRequired(token1.address, 0, toEther(1.3))
    assert.equal(fromEther(allowanceRequired), 1, 'allowance required does not match')

    await allowanceToken.mint(accounts[0], toEther(10000))
    allowanceRequired = await poolRouter.allowanceRequired(token1.address, 0, toEther(0.65))
    assert.equal(fromEther(allowanceRequired), 1, 'allowance required does not match')

    await poolRouter.setAllowanceRequired(token1.address, 0, false)
    allowanceRequired = await poolRouter.allowanceRequired(token1.address, 0, toEther(0.65))
    assert.equal(fromEther(allowanceRequired), 0, 'allowance required does not match')
  })

  it('should be able to stake via transferAndCall', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    let stakedAmount = await poolRouter.stakedAmount(token1.address, 0, accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')

    stakedAmount = await stakingPool1.balanceOf(accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')
  })

  it('should be able to stake via transferAndCall with index', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x1', 32))

    let stakedAmount = await poolRouter.stakedAmount(token1.address, 1, accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')

    stakedAmount = await stakingPool2.balanceOf(accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')
  })

  it('should be able to stake via transferAndCall with another token', async () => {
    await token2.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    let stakedAmount = await poolRouter.stakedAmount(token2.address, 0, accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')

    stakedAmount = await stakingPool3.balanceOf(accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')
  })

  it('should not be able to stake more than allowance', async () => {
    await expect(
      token1.transferAndCall(poolRouter.address, toEther(13.1), padBytes('0x0', 32))
    ).to.be.revertedWith('Not enough allowance staked')
  })

  it('should be able to stake twice', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(7), padBytes('0x0', 32))

    let stakedAmount = await poolRouter.stakedAmount(token1.address, 0, accounts[0])
    assert.equal(fromEther(stakedAmount), 7, 'staked amount does not match')

    await token1.transferAndCall(poolRouter.address, toEther(6), padBytes('0x0', 32))

    stakedAmount = await poolRouter.stakedAmount(token1.address, 0, accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')
  })

  it('should not be able to stake twice exceeding allowance', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(7), padBytes('0x0', 32))

    let stakedAmount = await poolRouter.stakedAmount(token1.address, 0, accounts[0])
    assert.equal(fromEther(stakedAmount), 7, 'staked amount does not match')

    await expect(
      token1.transferAndCall(poolRouter.address, toEther(7), padBytes('0x0', 32))
    ).to.be.revertedWith('Not enough allowance staked')
  })

  it('should be able to stake via ERC20', async () => {
    await token1.approve(poolRouter.address, toEther(13))
    await poolRouter.stake(token1.address, 0, toEther(13))

    let stakedAmount = await poolRouter.stakedAmount(token1.address, 0, accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')
  })

  it('should not be able to stake with an unsupported token', async () => {
    let token = (await deploy('ERC677', ['Unknown', 'ANON', 1000000000])) as ERC677
    await setupToken(token, accounts)
    await expect(poolRouter.stake(token.address, 0, toEther(10))).to.be.revertedWith(
      'Token not supported'
    )
  })

  it('should be able to stake into multiple pools', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    let stakedAmount = await poolRouter.stakedAmount(token1.address, 0, accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')

    stakedAmount = await stakingPool1.balanceOf(accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')

    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x1', 32))

    stakedAmount = await poolRouter.stakedAmount(token1.address, 1, accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')

    stakedAmount = await stakingPool2.balanceOf(accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')
  })

  it('should be able to withdraw', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    await poolRouter.withdraw(token1.address, 0, toEther(6.5))

    let stakedAmount = await poolRouter.stakedAmount(token1.address, 0, accounts[0])
    assert.equal(fromEther(stakedAmount), 6.5, 'staked amount does not match')

    stakedAmount = await stakingPool1.balanceOf(accounts[0])
    assert.equal(fromEther(stakedAmount), 6.5, 'staked amount does not match')
  })

  it('should be able to withdraw then stake again', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    await poolRouter.withdraw(token1.address, 0, toEther(6.5))
    await token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))

    let stakedAmount = await poolRouter.stakedAmount(token1.address, 0, accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')
  })

  it('should not be able to withdraw when amount exceeds stake', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))
    await token1
      .connect(signers[1])
      .transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    await expect(poolRouter.withdraw(token1.address, 0, toEther(13.5))).to.be.revertedWith(
      'Amount exceeds staked balance'
    )
  })

  it('should be able to stake and withdraw when allowance is not required', async () => {
    await poolRouter.setAllowanceRequired(token1.address, 0, false)

    await token1.transferAndCall(poolRouter.address, toEther(5000), padBytes('0x0', 32))
    let stakedAmount = await poolRouter.stakedAmount(token1.address, 0, accounts[0])
    assert.equal(fromEther(stakedAmount), 5000, 'staked amount does not match')

    await poolRouter.withdraw(token1.address, 0, toEther(5000))
    stakedAmount = await poolRouter.stakedAmount(token1.address, 0, accounts[0])
    assert.equal(fromEther(stakedAmount), 0, 'staked amount does not match')
  })

  it('should be able to withdraw allowance', async () => {
    await poolRouter.withdrawAllowance(toEther(5))

    let stakedAllowance = await poolRouter.allowanceStakes(accounts[0])
    assert.equal(fromEther(stakedAllowance), 5, 'staked allowance does not match')
  })

  it('should be able to withdraw unused allowance when staked', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))
    await poolRouter.withdrawAllowance(toEther(5))

    let stakedAllowance = await poolRouter.allowanceStakes(accounts[0])
    assert.equal(fromEther(stakedAllowance), 5, 'staked allowance does not match')
  })

  it('should not be able to withdraw more allowance than staked', async () => {
    await expect(poolRouter.withdrawAllowance(toEther(10.1))).to.be.revertedWith(
      'Cannot withdraw more than staked allowance balance'
    )
  })

  it('should not be able to withdraw allowance that is being used', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))

    await expect(poolRouter.withdrawAllowance(toEther(5.1))).to.be.revertedWith(
      'Cannot withdraw allowance that is in use'
    )
  })

  it('should be able to remove a pool', async () => {
    await poolRouter.removePool(token1.address, 1)

    let pools = await poolRouter.allPools()
    assert.equal(
      JSON.stringify(pools),
      JSON.stringify([
        [token1.address, token2.address],
        [stakingPool1.address, stakingPool3.address],
      ]),
      'pools do not match'
    )

    let supportedTokens = await poolRouter.supportedTokens()
    assert.equal(
      JSON.stringify(supportedTokens),
      JSON.stringify([token1.address, token2.address]),
      'supported tokens do not match'
    )
  })

  it('should be able to remove a pool and it pops supported tokens', async () => {
    await poolRouter.removePool(token2.address, 0)

    let pools = await poolRouter.allPools()
    assert.equal(
      JSON.stringify(pools),
      JSON.stringify([
        [token1.address, token1.address],
        [stakingPool1.address, stakingPool2.address],
      ]),
      'pools do not match'
    )

    let supportedTokens = await poolRouter.supportedTokens()
    assert.equal(
      JSON.stringify(supportedTokens),
      JSON.stringify([token1.address]),
      'supported tokens do not match'
    )
  })

  it('should not be able to remove a pool for a non supported token', async () => {
    let token = (await deploy('ERC677', ['Unknown', 'ANON', 1000000000])) as ERC677

    await expect(poolRouter.removePool(token.address, 0)).to.be.revertedWith(
      'Cannot remove token that is not supported'
    )
  })

  it('should not be able to remove an out of bounds pool', async () => {
    await expect(poolRouter.removePool(token2.address, 2)).to.be.revertedWith(
      'Pool index is out of bounds'
    )
  })

  it('should not be able to remove a pool with an active stake', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))

    await expect(poolRouter.removePool(token1.address, 0)).to.be.revertedWith(
      'Only can remove a pool with no active stake'
    )
  })
})
