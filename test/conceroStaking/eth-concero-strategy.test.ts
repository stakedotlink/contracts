import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../utils/helpers'
import {
  StakingPool,
  ConceroPoolMock,
  WithdrawalPoolMock,
  ConceroStrategy,
  WrappedETH,
} from '../../typechain-types'
import { time } from '@nomicfoundation/hardhat-network-helpers'

describe('ETHConceroStrategy', () => {
  let token: WrappedETH
  let conceroPool: ConceroPoolMock
  let strategy: ConceroStrategy
  let stakingPool: StakingPool
  let withdrawalPool: WithdrawalPoolMock
  let accounts: string[]

  async function deposit(account: string, amount: number) {
    await token.wrap({ value: toEther(amount) })
    await stakingPool.deposit(account, toEther(amount), ['0x'])
  }

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('WrappedETH')) as WrappedETH

    conceroPool = (await deploy('ConceroPoolMock')) as ConceroPoolMock

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'Test',
      'stTEST',
      [],
    ])) as StakingPool

    withdrawalPool = (await deploy('WithdrawalPoolMock', [toEther(100)])) as WithdrawalPoolMock

    strategy = (await deployUpgradeable('ETHConceroStrategy', [
      token.address,
      stakingPool.address,
      conceroPool.address,
      withdrawalPool.address,
      toEther(10000),
      0,
      0,
    ])) as ConceroStrategy

    await stakingPool.addStrategy(strategy.address)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    await token.approve(stakingPool.address, ethers.constants.MaxUint256)
  })

  it('deposit should work correctly', async () => {
    await deposit(accounts[0], 50)
    assert.equal(fromEther(await ethers.provider.getBalance(conceroPool.address)), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 50)

    await deposit(accounts[0], 200)
    assert.equal(fromEther(await ethers.provider.getBalance(conceroPool.address)), 250)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 250)
  })

  it('withdraw should work correctly', async () => {
    await deposit(accounts[0], 100)
    await expect(
      stakingPool.withdraw(accounts[0], accounts[0], toEther(11), ['0x'])
    ).to.be.revertedWith('Not enough liquidity available to withdraw')

    await stakingPool.withdraw(accounts[0], accounts[0], toEther(10), ['0x'])
    assert.equal(fromEther(await ethers.provider.getBalance(conceroPool.address)), 90)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 90)

    await withdrawalPool.setTotalQueuedWithdrawals(toEther(80))
    await strategy.performUpkeep('0x')
    await stakingPool.withdraw(accounts[0], accounts[0], toEther(80), ['0x'])
    assert.equal(fromEther(await ethers.provider.getBalance(conceroPool.address)), 10)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 10)
  })

  it('checkUpkeep and performUpkeep should work correctly', async () => {
    await deposit(accounts[0], 100)
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(10))
    await strategy.setWithdrawalRequestThreshold(toEther(12))
    assert.deepEqual(await strategy.checkUpkeep('0x'), [false, '0x'])
    await expect(strategy.performUpkeep('0x')).to.be.revertedWith('InsufficientQueuedWithdrawals()')

    await strategy.setWithdrawalRequestThreshold(toEther(10))
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(11))
    assert.deepEqual(await strategy.checkUpkeep('0x'), [true, '0x'])

    await strategy.performUpkeep('0x')
    assert.equal(
      (await strategy.timeOfLastWithdrawalRequest()).toNumber(),
      (await ethers.provider.getBlock('latest')).timestamp
    )
    assert.equal(fromEther((await conceroPool.getRequestInfo(ethers.constants.AddressZero))[1]), 11)
    await stakingPool.withdraw(accounts[0], accounts[0], toEther(11), ['0x'])

    await strategy.setWithdrawalRequestThreshold(0)
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(8))
    assert.deepEqual(await strategy.checkUpkeep('0x'), [false, '0x'])
    await expect(strategy.performUpkeep('0x')).to.be.revertedWith('UnnecessaryRequest()')

    await withdrawalPool.setTotalQueuedWithdrawals(toEther(9))
    assert.deepEqual(await strategy.checkUpkeep('0x'), [true, '0x'])

    await strategy.performUpkeep('0x')
    assert.equal(
      (await strategy.timeOfLastWithdrawalRequest()).toNumber(),
      (await ethers.provider.getBlock('latest')).timestamp
    )
    assert.equal(fromEther((await conceroPool.getRequestInfo(ethers.constants.AddressZero))[1]), 9)
    await stakingPool.withdraw(accounts[0], accounts[0], toEther(9), ['0x'])

    await strategy.setMinTimeBetweenWithdrawalRequests(1000)
    assert.deepEqual(await strategy.checkUpkeep('0x'), [false, '0x'])
    await expect(strategy.performUpkeep('0x')).to.be.revertedWith('MinTimeNotElapsed()')

    await time.increase(1000)
    assert.deepEqual(await strategy.checkUpkeep('0x'), [true, '0x'])

    await strategy.performUpkeep('0x')
    assert.equal(
      (await strategy.timeOfLastWithdrawalRequest()).toNumber(),
      (await ethers.provider.getBlock('latest')).timestamp
    )
    assert.equal(fromEther((await conceroPool.getRequestInfo(ethers.constants.AddressZero))[1]), 9)
  })

  it('getDepositChange should work correctly', async () => {
    await deposit(accounts[0], 1200)

    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await conceroPool.addReward(strategy.address, ethers.constants.AddressZero, toEther(100))
    assert.equal(fromEther(await strategy.getDepositChange()), 100)

    await conceroPool.addReward(strategy.address, ethers.constants.AddressZero, toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 150)

    await stakingPool.updateStrategyRewards([0], '0x')
    await conceroPool.addReward(strategy.address, ethers.constants.AddressZero, toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 50)
  })

  it('getPendingFees should work correctly', async () => {
    await deposit(accounts[0], 1200)

    await conceroPool.addReward(strategy.address, ethers.constants.AddressZero, toEther(100))
    assert.equal(fromEther(await strategy.getPendingFees()), 0)
  })

  it('getMaxDeposits and getMinDeposits should work correctly', async () => {
    assert.equal(fromEther(await strategy.canDeposit()), 10000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 10000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0)

    await deposit(accounts[0], 2000)
    assert.equal(fromEther(await strategy.canDeposit()), 8000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 10000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 1800)

    await deposit(accounts[0], 8000)
    assert.equal(fromEther(await strategy.canDeposit()), 0)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 10000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 9000)

    await withdrawalPool.setTotalQueuedWithdrawals(toEther(5000))
    await strategy.performUpkeep('0x')
    assert.equal(fromEther(await strategy.canDeposit()), 0)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 10000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 5000)
  })

  it('updateDeposits should work correctly', async () => {
    await deposit(accounts[0], 400)

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await conceroPool.addReward(strategy.address, ethers.constants.AddressZero, toEther(100))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await conceroPool.addReward(strategy.address, ethers.constants.AddressZero, toEther(50))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
  })
})
