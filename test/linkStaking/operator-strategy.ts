import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { Signer } from 'ethers'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  padBytes,
} from '../utils/helpers'
import { ERC677, OperatorStrategy, StakingMock } from '../../typechain-types'

describe('OperatorStrategy', () => {
  let token: ERC677
  let staking: StakingMock
  let strategy: OperatorStrategy
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    staking = (await deploy('StakingMock', [token.address])) as StakingMock

    strategy = (await deployUpgradeable('OperatorStrategy', [
      token.address,
      accounts[0],
      staking.address,
    ])) as OperatorStrategy

    await token.approve(strategy.address, ethers.constants.MaxUint256)
    await token.connect(signers[1]).approve(strategy.address, ethers.constants.MaxUint256)

    await strategy.deposit(toEther(100))
  })

  it('should be able to deposit', async () => {
    assert.equal(fromEther(await token.balanceOf(staking.address)), 100, 'balance does not match')
    assert.equal(fromEther(await strategy.totalDeposits()), 100, 'balance does not match')

    await strategy.deposit(toEther(1000))
    assert.equal(fromEther(await token.balanceOf(staking.address)), 1100, 'balance does not match')
    assert.equal(fromEther(await strategy.totalDeposits()), 1100, 'balance does not match')
  })

  it('deposit change should reflect rewards', async () => {
    assert.equal(fromEther(await strategy.depositChange()), 0, 'deposit change does not match')

    await staking.setBaseReward(toEther(100))
    await staking.setDelegationReward(toEther(200))

    assert.equal(fromEther(await strategy.depositChange()), 300, 'deposit change does not match')
  })

  it('withdrawing should revert', async () => {
    await expect(strategy.withdraw(toEther(10))).to.be.revertedWith(
      'withdrawals not yet implemented'
    )
  })

  it('should be able to update deposits', async () => {
    await staking.setBaseReward(toEther(100))

    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.totalDeposits()), 200, 'balance does not match')
  })

  it('should be able to update deposits on slash', async () => {
    await staking.setBaseReward(toEther(100))
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.totalDeposits()), 200, 'balance does not match')

    await staking.setBaseReward(toEther(50))
    assert.equal(fromEther(await strategy.depositChange()), -50, 'deposit change does not match')
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.totalDeposits()), 150, 'balance does not match')
  })

  it('can withdraw should be zero', async () => {
    assert.equal(fromEther(await strategy.canWithdraw()), 0, 'withdrawal amount does not match')
  })

  it('should be able to get max deposits', async () => {
    assert.equal(
      fromEther(await strategy.maxDeposits()),
      50000,
      'max deposit amount does not match'
    )
  })

  it('max deposits should be zero when the stake controller is not active', async () => {
    await staking.setActive(false)
    assert.equal(fromEther(await strategy.maxDeposits()), 0, 'max deposit amount does not match')
  })

  it('max deposits should be zero when the stake controller is paused', async () => {
    await staking.setActive(false)
    assert.equal(fromEther(await strategy.maxDeposits()), 0, 'max deposit amount does not match')
  })

  it('should be able to get min deposits', async () => {
    assert.equal(fromEther(await strategy.minDeposits()), 10, 'max deposit amount does not match')
  })

  it('should be able to migrate and then deposit', async () => {
    let staking2 = (await deploy('StakingMock', [token.address])) as StakingMock

    await staking.setMigration(staking2.address)
    await strategy.migrate('0x00')

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(staking2.address)), 200, 'balance does not match')
    assert.equal(fromEther(await strategy.totalDeposits()), 200, 'balance does not match')
  })

  it('should be able to change staking pool address if deployed empty', async () => {
    let newStrategy = (await deployUpgradeable('OperatorStrategy', [
      token.address,
      padBytes('0x0', 20),
      staking.address,
    ])) as OperatorStrategy
    await newStrategy.setStakingPool(accounts[0])
    assert.equal(await strategy.stakingPool(), accounts[0], 'staking pool address does not match')
  })

  it('should not be able to change staking pool address if already set', async () => {
    await expect(strategy.setStakingPool(accounts[1])).to.be.revertedWith(
      'Staking pool cannot be empty/pool is already set'
    )
  })
})
