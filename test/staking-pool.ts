import { ethers } from 'hardhat'
import { Signer } from 'ethers'
import { assert } from 'chai'
import { toEther, assertThrowsAsync, deploy } from './utils/helpers'
import { ERC677, ExampleStrategy, StakingPool } from '../typechain-types'

describe('StakingPool', () => {
  let token: ERC677
  let stakingPool: StakingPool
  let strategy1: ExampleStrategy
  let strategy2: ExampleStrategy
  let strategy3: ExampleStrategy
  let ownersRewards: string
  let signers: Signer[]
  let accounts: string[]

  async function stake(signer: number, amount: string) {
    await token
      .connect(signers[signer])
      .transferAndCall(stakingPool.address, toEther(amount), '0x00')
  }

  async function withdraw(signer: number, amount: string) {
    await stakingPool.connect(signers[signer]).withdraw(toEther(amount))
  }

  before(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

    signers = await ethers.getSigners()
    accounts = await Promise.all(
      signers.map(async (signer, index) => {
        let account = await signer.getAddress()
        await token.transfer(account, toEther(index < 4 ? '10000' : '0'))
        return account
      })
    )
    ownersRewards = accounts[4]

    stakingPool = (await deploy('StakingPool', [
      token.address,
      'LinkPool LINK',
      'lpLINK',
      ownersRewards,
      '2500',
    ])) as StakingPool

    strategy1 = (await deploy('ExampleStrategy', [
      token.address,
      stakingPool.address,
      accounts[0],
      toEther('5000'),
      toEther('10'),
    ])) as ExampleStrategy
    strategy2 = (await deploy('ExampleStrategy', [
      token.address,
      stakingPool.address,
      accounts[0],
      toEther('2000'),
      toEther('20'),
    ])) as ExampleStrategy
    strategy3 = (await deploy('ExampleStrategy', [
      token.address,
      stakingPool.address,
      accounts[0],
      toEther('10000'),
      toEther('10'),
    ])) as ExampleStrategy

    await stakingPool.addStrategy(strategy1.address)
    await stakingPool.addStrategy(strategy2.address)
  })

  it('derivative name, symbol, decimals should be correct', async () => {
    assert.equal(await stakingPool.name(), 'LinkPool LINK', 'Name should be correct')
    assert.equal(await stakingPool.symbol(), 'lpLINK', 'Symbol should be correct')
    assert.equal((await stakingPool.decimals()).toNumber(), 18, 'Decimals should be correct')
  })

  it('should be able to add new strategies', async () => {
    await stakingPool.addStrategy(strategy3.address)
    assert.equal(await stakingPool.strategies('2'), strategy3.address, 'Strategy-3 should be added')
  })

  it('should not be able to add strategy that has already been added', async () => {
    await assertThrowsAsync(async () => {
      await stakingPool.addStrategy(strategy3.address)
    }, 'revert')
  })

  it('should be able to stake asset and receive derivative tokens 1:1', async () => {
    await stake(1, '5000')

    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(accounts[1])),
      '5000.0',
      'Account-1 asset balance should be 5000'
    )
    assert.equal(
      ethers.utils.formatEther(await stakingPool.balanceOf(accounts[1])),
      '5000.0',
      'Account-1 derivative balance should be 5000'
    )
  })

  it('only asset token should be able to call ERC677 stake function', async () => {
    await assertThrowsAsync(async () => {
      await stakingPool.onTokenTransfer(accounts[2], toEther('1'), '0x00')
    }, 'revert')
  })

  it('should be able to stake using ERC20 stake function', async () => {
    await token.connect(signers[2]).approve(stakingPool.address, toEther('5000'))
    await stakingPool.connect(signers[2]).stake(toEther('5000'))

    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(accounts[2])),
      '5000.0',
      'Account-2 asset balance should be 5000'
    )
    assert.equal(
      ethers.utils.formatEther(await stakingPool.balanceOf(accounts[2])),
      '5000.0',
      'Account-2 derivative balance should be 5000'
    )
  })

  it('should not be able to stake more than asset balance', async () => {
    await token.connect(signers[2]).approve(stakingPool.address, toEther('6000'))
    await assertThrowsAsync(async () => {
      await stakingPool.connect(signers[2]).stake(toEther('6000'))
    }, 'revert')
  })

  it('stakes should be deposited into strategies in order of priority', async () => {
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(strategy1.address)),
      '5000.0',
      'Strategy-1 should be full'
    )
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(strategy2.address)),
      '2000.0',
      'Strategy-2 should be full'
    )
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(strategy3.address)),
      '3000.0',
      'Strategy-3 should hold remainder of assets'
    )
  })

  it('should be able to claim rewards from all strategies at once', async () => {
    await token.transfer(strategy1.address, toEther('2000'))
    await token.transfer(strategy2.address, toEther('1000'))
    await token.transfer(strategy3.address, toEther('1000'))
    await stakingPool.claimStrategyRewards()

    assert.equal(
      ethers.utils.formatEther(await stakingPool.ownersRewards()),
      '1000.0',
      'Owners rewards should be 1000'
    )
    assert.equal(
      ethers.utils.formatEther(await stakingPool.rewardPerToken()),
      '0.3',
      'Reward per token should be 0.3'
    )
  })

  it('should be able to claim rewards from single strategy', async () => {
    await token.transfer(strategy2.address, toEther('2000'))
    await stakingPool.claimSingleStrategyRewards('1')
    assert.equal(
      ethers.utils.formatEther(await stakingPool.rewardPerToken()),
      '0.45',
      'Reward per token should be 0.45'
    )
  })

  it('account derivative balances should reflect new rewards', async () => {
    assert.equal(
      ethers.utils.formatEther(await stakingPool.balanceOf(accounts[1])),
      '7250.0',
      'Account-1 derivative balance should be 7250'
    )
    assert.equal(
      ethers.utils.formatEther(await stakingPool.balanceOf(accounts[2])),
      '7250.0',
      'Account-2 derivative balance should be 7250'
    )
  })

  it('should not be able to claim rewards from strategies when nothing to claim', async () => {
    await stakingPool.claimSingleStrategyRewards('0')
    await stakingPool.claimStrategyRewards()
    assert.equal(
      ethers.utils.formatEther(await stakingPool.balanceOf(accounts[1])),
      '7250.0',
      'Account-1 derivative balance should remain unchanged'
    )
    assert.equal(
      ethers.utils.formatEther(await stakingPool.balanceOf(accounts[2])),
      '7250.0',
      'Account-2 derivative balance should remain unchanged'
    )
  })

  it('owners rewards should reflect new rewards and be claimable', async () => {
    await stakingPool.claimOwnersRewards()
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(ownersRewards)),
      '1500.0',
      'Rewards pool should contain 1500'
    )
  })

  it('should not be able to claim owners rewards when nothing to claim', async () => {
    await assertThrowsAsync(async () => {
      await stakingPool.claimOwnersRewards()
    }, 'revert')
  })

  it('should be able to withdraw assets by burning derivative tokens 1:1', async () => {
    //having funds withdrawn from strategies at time of withdrawal should have no effect
    await stakingPool.strategyWithdraw('2', toEther('1000'))
    await withdraw(1, '3250')
    await withdraw(2, '5250')

    assert.equal(
      ethers.utils.formatEther(await stakingPool.balanceOf(accounts[1])),
      '4000.0',
      'Account-1 derivative balance should be 4000'
    )
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(accounts[1])),
      '8250.0',
      'Account-1 asset balance should be 8250'
    )

    assert.equal(
      ethers.utils.formatEther(await stakingPool.balanceOf(accounts[2])),
      '2000.0',
      'Account-2 derivative balance should be 2000'
    )
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(accounts[2])),
      '10250.0',
      'Account-2 asset balance should be 10250'
    )
  })

  it('assets should have been withdrawn from strategies in reverse priority order', async () => {
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(strategy3.address)),
      '10.0',
      'Strategy-3 should hold minimum limit'
    )
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(strategy2.address)),
      '20.0',
      'Strategy-2 should hold minimum limit'
    )
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(strategy1.address)),
      '5970.0',
      'Strategy-1 should hold 5970'
    )
  })

  it('should not be able to withdraw more than derivative token balance', async () => {
    await assertThrowsAsync(async () => {
      await withdraw(1, '6000')
    }, 'revert')
  })

  it('should be able to perform deposit/withdraw on strategies using governance functions', async () => {
    await stakingPool.strategyWithdraw('0', toEther('10'))
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(strategy1.address)),
      '5960.0',
      '10 should be withdrawn from strategy'
    )
    await stakingPool.strategyDeposit('1', toEther('10'))
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(strategy2.address)),
      '30.0',
      '10 should be deposited into strategy'
    )
  })

  it('should not be able to withdraw more than is available', async () => {
    await assertThrowsAsync(async () => {
      await stakingPool.strategyWithdraw('0', toEther('5960'))
    }, 'revert')
    await assertThrowsAsync(async () => {
      await stakingPool.strategyWithdraw('2', toEther('1'))
    }, 'revert')
  })

  it('staking/withdrawing should have no effect on rewards', async () => {
    await token.transfer(strategy1.address, toEther('2000'))
    await token.transfer(strategy2.address, toEther('2000'))
    await stakingPool.strategyWithdraw('0', toEther('2000'))
    await stakingPool.strategyDeposit('2', toEther('1500'))
    await stakingPool.claimStrategyRewards()
    await stakingPool.strategyDeposit('1', toEther('500'))
    await stake(3, '1000')
    await withdraw(2, '1000')
    await stake(1, '1000')

    assert.equal(
      ethers.utils.formatEther(await stakingPool.balanceOf(accounts[3])),
      '1000.0',
      'Account-3 derivative balance should be 1000'
    )
    assert.equal(
      ethers.utils.formatEther(await stakingPool.balanceOf(accounts[2])),
      '2000.0',
      'Account-2 derivative balance should be 2000'
    )
    assert.equal(
      ethers.utils.formatEther(await stakingPool.balanceOf(accounts[1])),
      '7000.0',
      'Account-1 derivative balance should be 7000'
    )
  })

  it('should be able to set ownersTakePercent, and governance', async () => {
    await stakingPool.setOwnersTakePercent('3000')
    await stakingPool.setGovernance(accounts[1])

    assert.equal(
      (await stakingPool.ownersTakePercent()).toNumber(),
      3000,
      'ownersTakePercent should be changed'
    )
    assert.equal(await stakingPool.governance(), accounts[1], 'governance should be changed')
    await stakingPool.connect(signers[1]).setGovernance(accounts[0])
  })

  it('should be able to reorder strategies only when newOrder is valid', async () => {
    await assertThrowsAsync(async () => {
      await stakingPool.reorderStrategies([1, 1, 2])
    }, 'revert')
    await assertThrowsAsync(async () => {
      await stakingPool.reorderStrategies([0, 1])
    }, 'revert')
    await assertThrowsAsync(async () => {
      await stakingPool.reorderStrategies([0, 1, 2, 3])
    }, 'revert')
    await stakingPool.reorderStrategies([1, 2, 0])
    assert.equal(
      await stakingPool.strategies('2'),
      strategy1.address,
      'Strategy-1 should be switched'
    )
    assert.equal(
      await stakingPool.strategies('0'),
      strategy2.address,
      'Strategy-2 should be switched'
    )
    assert.equal(
      await stakingPool.strategies('1'),
      strategy3.address,
      'Strategy-3 should be switched'
    )
    await stakingPool.reorderStrategies([2, 0, 1])
  })

  it('should be able to remove strategies', async () => {
    await strategy1.setDepositMin('0')
    await strategy2.setDepositMin('0')
    await strategy3.setDepositMin('0')
    let strategies = [strategy1.address, strategy2.address, strategy3.address]
    for (let i = 0; i < 6; i++) {
      let strategy = await deploy('ExampleStrategy', [
        token.address,
        stakingPool.address,
        accounts[0],
        toEther('5000'),
        toEther('0'),
      ])
      await stakingPool.addStrategy(strategy.address)
      strategies.push(strategy.address)
    }

    await stakingPool.removeStrategy('0')
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(strategy1.address)),
      '0.0',
      'Strategy-1 should be empty'
    )
    assert.equal(
      await stakingPool.strategies('0'),
      strategy2.address,
      'Strategies[0] should be correct'
    )
    assert.equal(
      await stakingPool.strategies('3'),
      strategies[4],
      'Strategies[3] should be correct'
    )
    assert.equal(
      await stakingPool.strategies('7'),
      strategies[8],
      'Strategies[length-1] should be correct'
    )

    await stakingPool.removeStrategy('7')
    assert.equal(
      await stakingPool.strategies('0'),
      strategy2.address,
      'Strategies[0] should be correct'
    )
    assert.equal(
      await stakingPool.strategies('6'),
      strategies[7],
      'Strategies[length-1] should be correct'
    )

    await stakingPool.removeStrategy('3')
    assert.equal(
      await stakingPool.strategies('0'),
      strategy2.address,
      'Strategies[0] should be correct'
    )
    assert.equal(
      await stakingPool.strategies('3'),
      strategies[5],
      'Strategies[3] should be correct'
    )
    assert.equal(
      await stakingPool.strategies('5'),
      strategies[7],
      'Strategies[length-1] should be correct'
    )
  })

  it('removing strategy should claim rewards and withdraw all liquidity', async () => {
    await token.transfer(strategy2.address, toEther('1000'))
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(strategy2.address)),
      '3530.0',
      'Strategy-2 should contain 3530'
    )
    await stakingPool.removeStrategy('0')
    assert.equal(
      ethers.utils.formatEther(await token.balanceOf(strategy2.address)),
      '0.0',
      'Strategy-2 should be emptied of assets'
    )
  })

  it('only governance should be able to call governance functions', async () => {
    //strategyDeposit, strategyWithdraw, addStrategy, removeStrategy, reorderStrategies,
    //setOwnersTakePercent, setGovernance
    await assertThrowsAsync(async () => {
      await stakingPool.connect(signers[1]).strategyDeposit('0', toEther('0'))
    }, 'revert')
    await assertThrowsAsync(async () => {
      await stakingPool.connect(signers[1]).strategyWithdraw('0', toEther('0'))
    }, 'revert')
    await assertThrowsAsync(async () => {
      await stakingPool.connect(signers[1]).addStrategy(strategy1.address)
    }, 'revert')
    await assertThrowsAsync(async () => {
      await stakingPool.connect(signers[1]).removeStrategy('0')
    }, 'revert')
    await assertThrowsAsync(async () => {
      await stakingPool.connect(signers[1]).reorderStrategies([4, 3, 2, 1, 0])
    }, 'revert')
    await assertThrowsAsync(async () => {
      await stakingPool.connect(signers[1]).setOwnersTakePercent('1')
    }, 'revert')
    await assertThrowsAsync(async () => {
      await stakingPool.connect(signers[1]).setGovernance(accounts[1])
    }, 'revert')
  })
})
