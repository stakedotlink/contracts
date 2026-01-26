import { ethers } from 'hardhat'
import { assert } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, setupToken } from '../../utils/helpers'
import {
  ERC677,
  StrategyMock,
  StakingPool,
  WrappedSDToken,
  WLSTUSDCChainlinkPriceAdapter,
  ChainlinkAggregatorMock,
} from '../../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('WLSTUSDCChainlinkPriceAdapter', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    const stakingPool = (await deployUpgradeable('StakingPool', [
      token.target,
      'LinkPool LINK',
      'lplLINK',
      [[accounts[4], 0]],
      toEther(10000),
    ])) as StakingPool

    const wsdToken = (await deploy('WrappedSDToken', [
      stakingPool.target,
      'Wrapped LinkPool LINK',
      'wlplLINK',
    ])) as WrappedSDToken

    const strategy = (await deployUpgradeable('StrategyMock', [
      token.target,
      stakingPool.target,
      toEther(1000),
      toEther(10),
    ])) as StrategyMock

    // Deploy mock Chainlink feeds with 8 decimals (standard for USD pairs)
    // underlyingUSDFeed: price of underlying (LINK) in USD (e.g., LINK/USD = $20)
    const underlyingUSDFeed = (await deploy(
      'ChainlinkAggregatorMock',
      [8, 2000000000]
    )) as ChainlinkAggregatorMock // $20 with 8 decimals

    // usdcUSDFeed: price of USDC in USD (e.g., USDC/USD = $1)
    const usdcUSDFeed = (await deploy(
      'ChainlinkAggregatorMock',
      [8, 100000000]
    )) as ChainlinkAggregatorMock // $1 with 8 decimals

    const adapter = (await deploy(
      'contracts/core/integrations/WLSTUSDCChainlinkPriceAdapter.sol:WLSTUSDCChainlinkPriceAdapter',
      [wsdToken.target, underlyingUSDFeed.target, usdcUSDFeed.target]
    )) as WLSTUSDCChainlinkPriceAdapter

    await stakingPool.addStrategy(strategy.target)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    await token.approve(stakingPool.target, ethers.MaxUint256)
    await stakingPool.deposit(accounts[0], 1000, ['0x'])

    return {
      signers,
      accounts,
      token,
      stakingPool,
      wsdToken,
      strategy,
      underlyingUSDFeed,
      usdcUSDFeed,
      adapter,
    }
  }

  it('should return correct decimals', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(Number(await adapter.decimals()), 8)
  })

  it('should return correct price at 1:1 exchange rate with $20 LINK', async () => {
    const { adapter } = await loadFixture(deployFixture)

    const [roundId, answer, startedAt, updatedAt, answeredInRound] = await adapter.latestRoundData()

    assert.equal(Number(roundId), 1)
    assert.equal(Number(answer), 2000000000)
    assert.equal(Number(answeredInRound), 1)
    assert.isAbove(Number(updatedAt), 0)
    assert.isAbove(Number(startedAt), 0)
  })

  it('should return correct price after rewards accrue (1.25:1 exchange rate)', async () => {
    const { signers, accounts, adapter, token, strategy, stakingPool } = await loadFixture(
      deployFixture
    )

    await token.connect(signers[1]).transfer(accounts[0], toEther(1000))
    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await token.transfer(strategy.target, toEther(250))
    await stakingPool.updateStrategyRewards([0], '0x')

    const [, answer, , ,] = await adapter.latestRoundData()
    assert.closeTo(Number(answer) / 1e8, 25, 0.01)
  })

  it('should return correct price when USDC depegs to $0.99', async () => {
    const { adapter, usdcUSDFeed } = await loadFixture(deployFixture)

    await usdcUSDFeed.updateAnswer(99000000)

    const [, answer, , ,] = await adapter.latestRoundData()
    assert.closeTo(Number(answer) / 1e8, 20.2, 0.01)
  })

  it('should return correct price when LINK drops to $15', async () => {
    const { adapter, underlyingUSDFeed } = await loadFixture(deployFixture)

    await underlyingUSDFeed.updateAnswer(1500000000)

    const [, answer, , ,] = await adapter.latestRoundData()
    assert.equal(Number(answer), 1500000000)
  })

  it('should return correct price when LINK pumps to $50', async () => {
    const { adapter, underlyingUSDFeed } = await loadFixture(deployFixture)

    await underlyingUSDFeed.updateAnswer(5000000000)

    const [, answer, , ,] = await adapter.latestRoundData()
    assert.equal(Number(answer), 5000000000)
  })

  it('should handle combined exchange rate increase and price change', async () => {
    const { signers, accounts, adapter, token, strategy, stakingPool, underlyingUSDFeed } =
      await loadFixture(deployFixture)

    await token.connect(signers[1]).transfer(accounts[0], toEther(1000))
    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await token.transfer(strategy.target, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')

    await underlyingUSDFeed.updateAnswer(3000000000)

    const [, answer, , ,] = await adapter.latestRoundData()
    assert.closeTo(Number(answer) / 1e8, 60, 0.01)
  })
})
