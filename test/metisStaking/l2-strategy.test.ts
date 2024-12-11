import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../utils/helpers'
import { StakingPool, ERC20, SequencerVault, L2Strategy } from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

describe('L2Strategy', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Metis',
      'METIS',
      1000000000,
    ])) as ERC20
    adrs.token = await token.getAddress()

    const stakingPool = (await deployUpgradeable('StakingPool', [
      adrs.token,
      'Staked LINK',
      'stLINK',
      [],
      toEther(10000),
    ])) as StakingPool
    adrs.stakingPool = await stakingPool.getAddress()

    const strategy = (await deployUpgradeable('L2Strategy', [
      adrs.token,
      adrs.stakingPool,
      [],
      toEther(5000),
    ])) as L2Strategy
    adrs.strategy = await strategy.getAddress()

    await strategy.setL2Transmitter(accounts[0])
    await stakingPool.addStrategy(adrs.strategy)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    await token.approve(adrs.stakingPool, ethers.MaxUint256)
    await token.approve(adrs.strategy, ethers.MaxUint256)

    return {
      signers,
      accounts,
      adrs,
      token,
      stakingPool,
      strategy,
    }
  }

  it('deposit should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(50), ['0x'])
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 50)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 50)

    await stakingPool.deposit(accounts[0], toEther(200), ['0x'])
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 250)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 250)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 250)
  })

  it('withdraw should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(5000), ['0x'])
    await strategy.handleOutgoingTokensToL1(toEther(1500))

    await stakingPool.withdraw(accounts[0], accounts[1], toEther(500), ['0x'])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 4500)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 3000)
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3000)

    await token.transfer(strategy.target, toEther(100))
    await stakingPool.withdraw(accounts[0], accounts[1], toEther(200), ['0x'])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 4300)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 2900)
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 2900)
  })

  it('handleOutgoingTokensToL1 should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(500), ['0x'])
    await strategy.handleOutgoingTokensToL1(toEther(100))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 400)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 400)
    assert.equal(fromEther(await strategy.tokensInTransitToL1()), 100)
  })

  it('handleIncomingTokensFromL1 should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(500), ['0x'])
    await strategy.handleUpdateFromL1(toEther(100), toEther(75), 0, [], [])

    await expect(strategy.handleIncomingTokensFromL1(toEther(76))).to.be.revertedWithCustomError(
      strategy,
      'ExceedsTokensInTransitFromL1()'
    )

    await strategy.handleIncomingTokensFromL1(toEther(50))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 550)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 675)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 550)
    assert.equal(fromEther(await strategy.tokensInTransitFromL1()), 25)
  })

  it('handleUpdateFromL1 should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(500), ['0x'])
    await strategy.handleOutgoingTokensToL1(toEther(50))
    await strategy.handleUpdateFromL1(
      toEther(100),
      toEther(75),
      toEther(50),
      [accounts[1], accounts[2]],
      [toEther(10), toEther(20)]
    )

    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await strategy.getOperatorRewards(accounts[1])), 10)
    assert.equal(fromEther(await strategy.getOperatorRewards(accounts[2])), 20)
    assert.equal(fromEther(await strategy.getTotalOperatorRewards()), 30)

    await token.transfer(strategy.target, toEther(625))
    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 1075)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1250)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 1075)
    assert.equal(fromEther(await strategy.tokensInTransitFromL1()), 75)
    assert.equal(fromEther(await strategy.tokensInTransitToL1()), 0)

    assert.equal(fromEther(await strategy.getOperatorRewards(accounts[1])), 20)
    assert.equal(fromEther(await strategy.getOperatorRewards(accounts[2])), 40)
    assert.equal(fromEther(await strategy.getTotalOperatorRewards()), 60)
  })

  it('getDepositChange should work correctly', async () => {
    const { accounts, strategy, stakingPool, token } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(5000), ['0x'])
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await token.transfer(strategy.target, toEther(100))
    assert.equal(fromEther(await strategy.getDepositChange()), 100)

    await strategy.handleOutgoingTokensToL1(toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 100)

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
  })

  it('getMaxDeposits and getMinDeposits should work correctly', async () => {
    const { accounts, strategy, stakingPool } = await loadFixture(deployFixture)

    assert.equal(fromEther(await strategy.canDeposit()), 5000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0)

    await stakingPool.deposit(accounts[0], toEther(2000), ['0x'])
    assert.equal(fromEther(await strategy.canDeposit()), 3000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0)

    await strategy.handleOutgoingTokensToL1(toEther(500))
    assert.equal(fromEther(await strategy.canDeposit()), 3000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 500)

    await strategy.handleUpdateFromL1(toEther(600), toEther(50), toEther(500), [], [])
    assert.equal(fromEther(await strategy.canDeposit()), 2850)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 650)

    await strategy.handleIncomingTokensFromL1(toEther(50))
    assert.equal(fromEther(await strategy.canDeposit()), 2850)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 600)

    await stakingPool.deposit(accounts[0], toEther(2850), ['0x'])
    assert.equal(fromEther(await strategy.canDeposit()), 0)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 600)
  })

  it('updateDeposits should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(400), ['0x'])
    await strategy.addFee(accounts[4], 2000)
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)

    await strategy.handleOutgoingTokensToL1(toEther(100))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 300)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)

    await strategy.handleUpdateFromL1(
      toEther(150),
      toEther(25),
      toEther(100),
      [accounts[1], accounts[2]],
      [toEther(3), toEther(4)]
    )
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 475)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 300)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 7)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 15)

    await strategy.handleIncomingTokensFromL1(toEther(10))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 475)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 310)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 7)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 15)

    await token.transfer(adrs.strategy, toEther(237.5))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 712.5)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 547.5)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 9.8)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 68.5)
  })

  it('updateDeposits should work correctly with slashing', async () => {
    const { accounts, adrs, strategy, stakingPool } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(400), ['0x'])
    await strategy.handleOutgoingTokensToL1(toEther(100))
    await strategy.handleUpdateFromL1(toEther(50), 0, toEther(100), [accounts[1]], [toEther(5)])
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 350)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 300)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 5)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)

    await strategy.handleUpdateFromL1(toEther(20), toEther(10), 0, [accounts[1]], [toEther(1)])
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 330)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 300)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 5.7)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)
  })

  it('withdrawOperatorRewards should work correctly', async () => {
    const { signers, accounts, adrs, token, strategy, stakingPool } = await loadFixture(
      deployFixture
    )

    await stakingPool.deposit(accounts[0], toEther(400), ['0x'])
    await strategy.handleUpdateFromL1(
      toEther(100),
      0,
      0,
      [accounts[1], accounts[2]],
      [toEther(1), toEther(2)]
    )
    await token.transfer(strategy.target, toEther(200))
    await stakingPool.updateStrategyRewards([0], '0x')

    expect(strategy.withdrawOperatorRewards()).to.be.revertedWithCustomError(
      strategy,
      'NoRewards()'
    )

    await strategy.connect(signers[1]).withdrawOperatorRewards()
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 2.8)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 1.4)
    assert.equal(fromEther(await strategy.getOperatorRewards(accounts[1])), 0)
    assert.equal(fromEther(await strategy.getTotalOperatorRewards()), 2.8)

    await strategy.handleUpdateFromL1(toEther(30), 0, 0, [], [])

    await strategy.connect(signers[2]).withdrawOperatorRewards()
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 2.52)
    assert.equal(fromEther(await strategy.getOperatorRewards(accounts[2])), 0)
    assert.equal(fromEther(await strategy.getTotalOperatorRewards()), 0)
  })
})
