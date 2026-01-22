import { ethers } from 'hardhat'
import { assert } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
} from '../../utils/helpers'
import {
  ERC677,
  StrategyMock,
  StakingPool,
  WrappedSDToken,
  WLSTUnderlyingChainlinkPriceAdapter,
} from '../../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('WLSTUnderlyingChainlinkPriceAdapter', () => {
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

    const adapter = (await deploy(
      'contracts/core/integrations/WLSTUnderlyingChainlinkPriceAdapter.sol:WLSTUnderlyingChainlinkPriceAdapter',
      [wsdToken.target]
    )) as WLSTUnderlyingChainlinkPriceAdapter

    await stakingPool.addStrategy(strategy.target)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    await token.approve(stakingPool.target, ethers.MaxUint256)
    await stakingPool.deposit(accounts[0], 1000, ['0x'])

    return { signers, accounts, token, stakingPool, wsdToken, strategy, adapter }
  }

  it('should return correct decimals', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(Number(await adapter.decimals()), 18)
  })

  it('should return correct price at 1:1 exchange rate', async () => {
    const { adapter } = await loadFixture(deployFixture)

    const [roundId, answer, startedAt, updatedAt, answeredInRound] = await adapter.latestRoundData()

    assert.equal(Number(roundId), 1)
    assert.equal(fromEther(answer), 1)
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

    assert.equal(fromEther(answer), 1.25)
  })

  it('should return correct price after large rewards accrue (2:1 exchange rate)', async () => {
    const { signers, accounts, adapter, token, strategy, stakingPool } = await loadFixture(
      deployFixture
    )

    await token.connect(signers[1]).transfer(accounts[0], toEther(1000))
    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await token.transfer(strategy.target, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')

    const [, answer, , ,] = await adapter.latestRoundData()

    assert.equal(fromEther(answer), 2)
  })
})
