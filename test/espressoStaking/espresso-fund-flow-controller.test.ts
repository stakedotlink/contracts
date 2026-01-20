import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  deployImplementation,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import {
  ERC20,
  EspressoStakingMock,
  EspressoRewardsMock,
  EspressoStrategy,
  EspressoFundFlowController,
  EspressoVault,
  StakingPool,
  WithdrawalPoolMock,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

const exitEscrowPeriod = 7 * 86400 // 7 days
const minTimeBetweenUnbonding = 10 * 86400 // 10 days

describe('EspressoFundFlowController', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Espresso',
      'ESP',
      1000000000,
    ])) as ERC20
    await setupToken(token, accounts)

    const espressoStaking = (await deploy('EspressoStakingMock', [
      token.target,
      exitEscrowPeriod,
    ])) as EspressoStakingMock

    const espressoRewards = (await deploy('EspressoRewardsMock', [
      token.target,
      0,
    ])) as EspressoRewardsMock

    const withdrawalPool = (await deploy('WithdrawalPoolMock', [])) as WithdrawalPoolMock

    const stakingPool = (await deployUpgradeable('StakingPool', [
      token.target,
      'Staking Espresso',
      'stESP',
      [],
      0,
    ])) as StakingPool

    const vaultImplementation = await deployImplementation('EspressoVault')

    const strategy = (await deployUpgradeable('EspressoStrategy', [
      token.target,
      stakingPool.target,
      espressoStaking.target,
      espressoRewards.target,
      vaultImplementation,
      10000,
      [],
    ])) as EspressoStrategy

    const fundFlowController = (await deployUpgradeable('EspressoFundFlowController', [
      strategy.target,
      withdrawalPool.target,
      accounts[0],
      minTimeBetweenUnbonding,
    ])) as EspressoFundFlowController

    await stakingPool.addStrategy(strategy.target)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])
    await strategy.setFundFlowController(fundFlowController.target)
    await strategy.setRewardsOracle(accounts[0])

    const validators = [accounts[5], accounts[6], accounts[7]]
    for (const validator of validators) {
      await espressoStaking.registerValidator(validator)
      await strategy.addVault(validator)
    }

    await token.transfer(espressoRewards.target, toEther(10000))
    await token.approve(stakingPool.target, ethers.MaxUint256)

    const vaultAddresses = await strategy.getVaults()
    const vaults: EspressoVault[] = []
    for (const vaultAddress of vaultAddresses) {
      vaults.push(await ethers.getContractAt('EspressoVault', vaultAddress))
    }

    return {
      signers,
      accounts,
      token,
      espressoStaking,
      espressoRewards,
      withdrawalPool,
      stakingPool,
      strategy,
      fundFlowController,
      vaultImplementation,
      vaults,
      validators,
    }
  }

  it('shouldDepositQueuedTokens should work correctly', async () => {
    const { stakingPool, fundFlowController, accounts } = await loadFixture(deployFixture)

    // Initially no queued tokens
    let [shouldDeposit, amount] = await fundFlowController.shouldDepositQueuedTokens()
    assert.equal(shouldDeposit, false)
    assert.equal(fromEther(amount), 0)

    // Deposit tokens into strategy (tokens go to queue first)
    await stakingPool.deposit(accounts[0], toEther(100), ['0x'])

    // Should now indicate deposits are needed
    ;[shouldDeposit, amount] = await fundFlowController.shouldDepositQueuedTokens()
    assert.equal(shouldDeposit, true)
    assert.equal(fromEther(amount), 100)

    // Deposit more tokens
    await stakingPool.deposit(accounts[0], toEther(200), ['0x'])
    ;[shouldDeposit, amount] = await fundFlowController.shouldDepositQueuedTokens()
    assert.equal(shouldDeposit, true)
    assert.equal(fromEther(amount), 300)

    // Deposit queued tokens into vaults
    await fundFlowController.depositQueuedTokens([0, 1], [toEther(150), toEther(150)])

    // Should no longer need deposits
    ;[shouldDeposit, amount] = await fundFlowController.shouldDepositQueuedTokens()
    assert.equal(shouldDeposit, false)
    assert.equal(fromEther(amount), 0)

    // Partial deposit scenario
    await stakingPool.deposit(accounts[0], toEther(50), ['0x'])
    await fundFlowController.depositQueuedTokens([2], [toEther(30)])
    ;[shouldDeposit, amount] = await fundFlowController.shouldDepositQueuedTokens()
    assert.equal(shouldDeposit, true)
    assert.equal(fromEther(amount), 20)
  })

  it('depositQueuedTokens should work correctly', async () => {
    const {
      signers,
      stakingPool,
      strategy,
      fundFlowController,
      vaults,
      espressoStaking,
      validators,
      accounts,
    } = await loadFixture(deployFixture)

    // Should revert if caller is not deposit controller
    await expect(
      fundFlowController.connect(signers[1]).depositQueuedTokens([0], [toEther(100)])
    ).to.be.revertedWithCustomError(fundFlowController, 'SenderNotAuthorized')

    // Deposit tokens into strategy
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])

    assert.equal(fromEther(await strategy.totalQueued()), 300)

    // Deposit to single vault
    await fundFlowController.depositQueuedTokens([0], [toEther(100)])

    assert.equal(fromEther(await strategy.totalQueued()), 200)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100)
    assert.equal(fromEther(await espressoStaking.delegations(validators[0], vaults[0].target)), 100)

    // Deposit to multiple vaults
    await fundFlowController.depositQueuedTokens([1, 2], [toEther(100), toEther(100)])

    assert.equal(fromEther(await strategy.totalQueued()), 0)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 100)

    // Add more deposits and verify cumulative deposits
    await stakingPool.deposit(accounts[0], toEther(150), ['0x'])
    await fundFlowController.depositQueuedTokens([0], [toEther(150)])

    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 250)
    assert.equal(fromEther(await espressoStaking.delegations(validators[0], vaults[0].target)), 250)
  })

  it('shouldUnbondVaults should work correctly', async () => {
    const { stakingPool, fundFlowController, withdrawalPool, accounts } = await loadFixture(
      deployFixture
    )

    // Initially no queued withdrawals
    assert.equal(await fundFlowController.shouldUnbondVaults(), false)

    // Deposit and stake tokens
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(100))

    // Should unbond now (queued withdrawals > queued deposits)
    assert.equal(await fundFlowController.shouldUnbondVaults(), true)

    // Add queued deposits that exceed withdrawals
    await stakingPool.deposit(accounts[0], toEther(150), ['0x'])
    assert.equal(await fundFlowController.shouldUnbondVaults(), false)

    // Deposit the queued tokens and unbond
    await fundFlowController.depositQueuedTokens([0], [toEther(150)])
    await fundFlowController.unbondVaults()
    assert.equal(await fundFlowController.shouldUnbondVaults(), false)

    // Wait for unbonding period and withdraw
    await time.increase(exitEscrowPeriod)
    await fundFlowController.withdrawVaults([0])
    // After withdrawing, totalQueued = 100. Set withdrawals higher than queued deposits
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(150))

    // Should not unbond yet (minTimeBetweenUnbonding not elapsed)
    assert.equal(await fundFlowController.shouldUnbondVaults(), false)

    // Wait for minTimeBetweenUnbonding
    await time.increase(minTimeBetweenUnbonding)
    assert.equal(await fundFlowController.shouldUnbondVaults(), true)
  })

  it('unbondVaults should work correctly', async () => {
    const { stakingPool, strategy, fundFlowController, withdrawalPool, vaults, accounts } =
      await loadFixture(deployFixture)

    // Deposit and stake tokens
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )

    // Should revert if no unbonding needed
    await expect(fundFlowController.unbondVaults()).to.be.revertedWithCustomError(
      fundFlowController,
      'NoUnbondingNeeded'
    )

    // Unbond vaults
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(150))
    await fundFlowController.unbondVaults()

    assert.equal(await vaults[0].isUnbonding(), true)
    assert.equal(await vaults[1].isUnbonding(), true)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 100)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 50)
    assert.equal(Number(await strategy.numVaultsUnbonding()), 2)

    // Should revert while vaults are unbonding
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(200))
    await expect(fundFlowController.unbondVaults()).to.be.revertedWithCustomError(
      fundFlowController,
      'NoUnbondingNeeded'
    )

    // Should revert if minTimeBetweenUnbonding not elapsed
    await time.increase(exitEscrowPeriod)
    await fundFlowController.withdrawVaults([0, 1])
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(200))
    await expect(fundFlowController.unbondVaults()).to.be.revertedWithCustomError(
      fundFlowController,
      'NoUnbondingNeeded'
    )

    // Can unbond again after minTimeBetweenUnbonding
    await time.increase(minTimeBetweenUnbonding)
    await fundFlowController.unbondVaults()

    assert.equal(await vaults[2].isUnbonding(), true)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 50)
  })

  it('forceUnbondVaults should work correctly', async () => {
    const { signers, stakingPool, fundFlowController, vaults, accounts } = await loadFixture(
      deployFixture
    )

    // Deposit and stake tokens
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )

    // Should revert if caller is not deposit controller
    await expect(
      fundFlowController.connect(signers[1]).forceUnbondVaults([0], [toEther(50)])
    ).to.be.revertedWithCustomError(fundFlowController, 'SenderNotAuthorized')

    // Force unbond specific amounts from specific vaults
    await fundFlowController.forceUnbondVaults([0, 2], [toEther(30), toEther(50)])

    assert.equal(await vaults[0].isUnbonding(), true)
    assert.equal(await vaults[1].isUnbonding(), false)
    assert.equal(await vaults[2].isUnbonding(), true)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 30)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 50)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 70)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 50)
  })

  it('shouldWithdrawVaults should work correctly', async () => {
    const { stakingPool, fundFlowController, withdrawalPool, accounts } = await loadFixture(
      deployFixture
    )

    // Initially no withdrawable vaults
    let [shouldWithdraw, withdrawableVaults] = await fundFlowController.shouldWithdrawVaults()
    assert.equal(shouldWithdraw, false)
    assert.equal(withdrawableVaults.length, 0)

    // Deposit, stake, and unbond
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(150))
    await fundFlowController.unbondVaults()

    // Not yet withdrawable (escrow period not elapsed)
    ;[shouldWithdraw, withdrawableVaults] = await fundFlowController.shouldWithdrawVaults()
    assert.equal(shouldWithdraw, false)
    assert.equal(withdrawableVaults.length, 0)

    // Wait for escrow period
    await time.increase(exitEscrowPeriod)
    ;[shouldWithdraw, withdrawableVaults] = await fundFlowController.shouldWithdrawVaults()
    assert.equal(shouldWithdraw, true)
    assert.equal(withdrawableVaults.length, 2)
    assert.equal(Number(withdrawableVaults[0]), 0)
    assert.equal(Number(withdrawableVaults[1]), 1)

    // Withdraw all unbonding vaults
    await fundFlowController.withdrawVaults([0, 1])
    ;[shouldWithdraw, withdrawableVaults] = await fundFlowController.shouldWithdrawVaults()
    assert.equal(shouldWithdraw, false)
    assert.equal(withdrawableVaults.length, 0)
  })

  it('withdrawVaults should work correctly', async () => {
    const { stakingPool, strategy, fundFlowController, withdrawalPool, vaults, accounts } =
      await loadFixture(deployFixture)

    // Deposit, stake, and unbond
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(200))
    await fundFlowController.unbondVaults()

    // Wait for escrow period
    await time.increase(exitEscrowPeriod)

    assert.equal(fromEther(await strategy.totalQueued()), 0)
    assert.equal(Number(await withdrawalPool.performUpkeepCalls()), 0)

    // Withdraw all unbonding vaults
    await fundFlowController.withdrawVaults([0, 1])

    assert.equal(fromEther(await strategy.totalQueued()), 200)
    assert.equal(await vaults[0].isWithdrawable(), false)
    assert.equal(await vaults[0].isUnbonding(), false)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 0)
    assert.equal(await vaults[1].isWithdrawable(), false)
    assert.equal(await vaults[1].isUnbonding(), false)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 0)

    // Verify withdrawal pool upkeep was called
    assert.equal(Number(await withdrawalPool.performUpkeepCalls()), 1)

    // Verify upkeep is not called when checkUpkeep returns false
    await time.increase(minTimeBetweenUnbonding)
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(250))
    await fundFlowController.unbondVaults()
    await time.increase(exitEscrowPeriod)
    await withdrawalPool.setTotalQueuedWithdrawals(0)
    await fundFlowController.withdrawVaults([2])

    assert.equal(Number(await withdrawalPool.performUpkeepCalls()), 1)
  })

  it('restakeRewards should work correctly', async () => {
    const {
      stakingPool,
      strategy,
      fundFlowController,
      vaults,
      espressoStaking,
      validators,
      accounts,
    } = await loadFixture(deployFixture)

    // Deposit and stake tokens
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )

    // Simulate rewards by updating lifetime rewards
    await strategy.updateLifetimeRewards([0, 1], [toEther(20), toEther(30)])

    assert.equal(fromEther(await vaults[0].getRewards()), 20)
    assert.equal(fromEther(await vaults[1].getRewards()), 30)

    // Restake rewards
    await fundFlowController.restakeRewards([0, 1], [toEther(20), toEther(30)], ['0x', '0x'])

    // Rewards should be converted to principal
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 120)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 130)
    assert.equal(fromEther(await vaults[0].getRewards()), 0)
    assert.equal(fromEther(await vaults[1].getRewards()), 0)
    assert.equal(fromEther(await espressoStaking.delegations(validators[0], vaults[0].target)), 120)
    assert.equal(fromEther(await espressoStaking.delegations(validators[1], vaults[1].target)), 130)
  })

  it('withdrawRewards should work correctly', async () => {
    const { token, stakingPool, strategy, fundFlowController, vaults, accounts } =
      await loadFixture(deployFixture)

    // Deposit and stake tokens
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )

    // Simulate rewards by updating lifetime rewards
    await strategy.updateLifetimeRewards([0, 1], [toEther(20), toEther(30)])

    assert.equal(fromEther(await vaults[0].getRewards()), 20)
    assert.equal(fromEther(await vaults[1].getRewards()), 30)

    const preBalance = await token.balanceOf(strategy.target)

    // Withdraw rewards
    await fundFlowController.withdrawRewards([0, 1], [toEther(20), toEther(30)], ['0x', '0x'])

    // Rewards should be withdrawn to strategy
    assert.equal(fromEther(await vaults[0].getRewards()), 0)
    assert.equal(fromEther(await vaults[1].getRewards()), 0)
    assert.equal(fromEther((await token.balanceOf(strategy.target)) - preBalance), 50)
    assert.equal(fromEther(await strategy.totalQueued()), 50)

    // Principal should remain unchanged
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 100)
  })

  it('getVaultDeposits should work correctly', async () => {
    const { stakingPool, strategy, fundFlowController, vaults, accounts } = await loadFixture(
      deployFixture
    )

    // Initially all vaults have zero deposits
    let deposits = await fundFlowController.getVaultDeposits()
    assert.equal(deposits.length, 3)
    assert.equal(fromEther(deposits[0]), 0)
    assert.equal(fromEther(deposits[1]), 0)
    assert.equal(fromEther(deposits[2]), 0)

    // Deposit tokens into vaults with varying amounts
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(150), toEther(50)]
    )

    deposits = await fundFlowController.getVaultDeposits()
    assert.equal(fromEther(deposits[0]), 100)
    assert.equal(fromEther(deposits[1]), 150)
    assert.equal(fromEther(deposits[2]), 50)

    // Add rewards to verify getTotalDeposits includes rewards
    await strategy.updateLifetimeRewards([0, 1], [toEther(10), toEther(20)])

    deposits = await fundFlowController.getVaultDeposits()
    assert.equal(fromEther(deposits[0]), 110)
    assert.equal(fromEther(deposits[1]), 170)
    assert.equal(fromEther(deposits[2]), 50)
  })

  it('getVaultRewards should work correctly', async () => {
    const { stakingPool, strategy, fundFlowController, accounts } = await loadFixture(deployFixture)

    // Initially all vaults have zero rewards
    let rewards = await fundFlowController.getVaultRewards()
    assert.equal(rewards.length, 3)
    assert.equal(fromEther(rewards[0]), 0)
    assert.equal(fromEther(rewards[1]), 0)
    assert.equal(fromEther(rewards[2]), 0)

    // Deposit tokens into vaults
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )

    // Add rewards to vaults with varying amounts
    await strategy.updateLifetimeRewards([0, 1, 2], [toEther(10), toEther(25), toEther(5)])

    rewards = await fundFlowController.getVaultRewards()
    assert.equal(fromEther(rewards[0]), 10)
    assert.equal(fromEther(rewards[1]), 25)
    assert.equal(fromEther(rewards[2]), 5)

    // Withdraw some rewards and verify updated values
    await fundFlowController.withdrawRewards([0], [toEther(10)], ['0x'])

    rewards = await fundFlowController.getVaultRewards()
    assert.equal(fromEther(rewards[0]), 0)
    assert.equal(fromEther(rewards[1]), 25)
    assert.equal(fromEther(rewards[2]), 5)
  })

  it('getUnbondingVaults should work correctly', async () => {
    const { stakingPool, fundFlowController, withdrawalPool, vaults, accounts } = await loadFixture(
      deployFixture
    )

    // Initially no vaults are unbonding
    let unbondingVaults = await fundFlowController.getUnbondingVaults()
    assert.equal(unbondingVaults.length, 0)

    // Deposit and stake tokens
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )

    // Unbond some vaults
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(150))
    await fundFlowController.unbondVaults()

    unbondingVaults = await fundFlowController.getUnbondingVaults()
    assert.equal(unbondingVaults.length, 2)
    assert.equal(Number(unbondingVaults[0]), 0)
    assert.equal(Number(unbondingVaults[1]), 1)

    // Wait for escrow period and withdraw all unbonding vaults
    await time.increase(exitEscrowPeriod)
    await fundFlowController.withdrawVaults([0, 1])

    unbondingVaults = await fundFlowController.getUnbondingVaults()
    assert.equal(unbondingVaults.length, 0)
  })

  it('getWithdrawableVaults should work correctly', async () => {
    const { stakingPool, fundFlowController, withdrawalPool, accounts } = await loadFixture(
      deployFixture
    )

    // Initially no vaults are withdrawable
    let withdrawableVaults = await fundFlowController.getWithdrawableVaults()
    assert.equal(withdrawableVaults.length, 0)

    // Deposit, stake, and unbond
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(150))
    await fundFlowController.unbondVaults()

    // Not yet withdrawable (escrow period not elapsed)
    withdrawableVaults = await fundFlowController.getWithdrawableVaults()
    assert.equal(withdrawableVaults.length, 0)

    // Wait for escrow period
    await time.increase(exitEscrowPeriod)

    withdrawableVaults = await fundFlowController.getWithdrawableVaults()
    assert.equal(withdrawableVaults.length, 2)
    assert.equal(Number(withdrawableVaults[0]), 0)
    assert.equal(Number(withdrawableVaults[1]), 1)

    // Withdraw all unbonding vaults
    await fundFlowController.withdrawVaults([0, 1])

    withdrawableVaults = await fundFlowController.getWithdrawableVaults()
    assert.equal(withdrawableVaults.length, 0)
  })

  it('getInactiveVaults should work correctly', async () => {
    const { stakingPool, fundFlowController, espressoStaking, validators, accounts } =
      await loadFixture(deployFixture)

    // Initially all vaults are active
    let inactiveVaults = await fundFlowController.getInactiveVaults()
    assert.equal(inactiveVaults.length, 0)

    // Deposit tokens into vaults
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )

    // Exit first validator
    await espressoStaking.exitValidator(validators[0])

    inactiveVaults = await fundFlowController.getInactiveVaults()
    assert.equal(inactiveVaults.length, 1)
    assert.equal(Number(inactiveVaults[0]), 0)

    // Exit second validator
    await espressoStaking.exitValidator(validators[1])

    inactiveVaults = await fundFlowController.getInactiveVaults()
    assert.equal(inactiveVaults.length, 2)
    assert.equal(Number(inactiveVaults[0]), 0)
    assert.equal(Number(inactiveVaults[1]), 1)

    // Exit third validator
    await espressoStaking.exitValidator(validators[2])

    inactiveVaults = await fundFlowController.getInactiveVaults()
    assert.equal(inactiveVaults.length, 3)
    assert.equal(Number(inactiveVaults[0]), 0)
    assert.equal(Number(inactiveVaults[1]), 1)
    assert.equal(Number(inactiveVaults[2]), 2)
  })

  it('getInactiveWithdrawableVaults should work correctly', async () => {
    const { stakingPool, fundFlowController, espressoStaking, validators, accounts } =
      await loadFixture(deployFixture)

    // Initially no inactive withdrawable vaults
    let inactiveWithdrawableVaults = await fundFlowController.getInactiveWithdrawableVaults()
    assert.equal(inactiveWithdrawableVaults.length, 0)

    // Deposit tokens into vaults
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )

    // Exit first validator
    await espressoStaking.exitValidator(validators[0])

    // Not yet withdrawable (escrow period not elapsed)
    inactiveWithdrawableVaults = await fundFlowController.getInactiveWithdrawableVaults()
    assert.equal(inactiveWithdrawableVaults.length, 0)

    // Wait for escrow period
    await time.increase(exitEscrowPeriod)

    inactiveWithdrawableVaults = await fundFlowController.getInactiveWithdrawableVaults()
    assert.equal(inactiveWithdrawableVaults.length, 1)
    assert.equal(Number(inactiveWithdrawableVaults[0]), 0)

    // Exit second validator
    await espressoStaking.exitValidator(validators[1])

    // Second validator not yet withdrawable
    inactiveWithdrawableVaults = await fundFlowController.getInactiveWithdrawableVaults()
    assert.equal(inactiveWithdrawableVaults.length, 1)

    // Wait for escrow period for second validator
    await time.increase(exitEscrowPeriod)

    inactiveWithdrawableVaults = await fundFlowController.getInactiveWithdrawableVaults()
    assert.equal(inactiveWithdrawableVaults.length, 2)
    assert.equal(Number(inactiveWithdrawableVaults[0]), 0)
    assert.equal(Number(inactiveWithdrawableVaults[1]), 1)
  })

  it('setDepositController should work correctly', async () => {
    const { signers, fundFlowController, accounts } = await loadFixture(deployFixture)

    // Should revert if caller is not owner
    await expect(
      fundFlowController.connect(signers[1]).setDepositController(accounts[1])
    ).to.be.revertedWith('Ownable: caller is not the owner')

    // Should revert if address is zero
    await expect(
      fundFlowController.setDepositController(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(fundFlowController, 'InvalidAddress')

    // Update deposit controller
    await fundFlowController.setDepositController(accounts[1])

    assert.equal(await fundFlowController.depositController(), accounts[1])

    // Verify new controller can deposit
    await expect(
      fundFlowController.depositQueuedTokens([0], [toEther(100)])
    ).to.be.revertedWithCustomError(fundFlowController, 'SenderNotAuthorized')
  })

  it('setMinTimeBetweenUnbonding should work correctly', async () => {
    const { signers, stakingPool, fundFlowController, withdrawalPool, accounts } =
      await loadFixture(deployFixture)

    // Should revert if caller is not owner
    await expect(
      fundFlowController.connect(signers[1]).setMinTimeBetweenUnbonding(7200)
    ).to.be.revertedWith('Ownable: caller is not the owner')

    // Update minTimeBetweenUnbonding
    const newMinTime = 20 * 86400 // 20 days
    await fundFlowController.setMinTimeBetweenUnbonding(newMinTime)

    assert.equal(Number(await fundFlowController.minTimeBetweenUnbonding()), newMinTime)

    // Verify new value is enforced

    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(100), toEther(100), toEther(100)]
    )
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(100))
    await fundFlowController.unbondVaults()

    await time.increase(exitEscrowPeriod)
    await fundFlowController.withdrawVaults([0])
    await withdrawalPool.setTotalQueuedWithdrawals(toEther(150))

    // Should not allow unbonding before new min time (20 days)
    assert.equal(await fundFlowController.shouldUnbondVaults(), false)

    await time.increase(newMinTime - exitEscrowPeriod)
    assert.equal(await fundFlowController.shouldUnbondVaults(), true)
  })
})
