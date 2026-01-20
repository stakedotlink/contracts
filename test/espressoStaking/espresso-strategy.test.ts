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
  EspressoVault,
  EspressoStrategy,
  StakingPool,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

const exitEscrowPeriod = 86400 // 1 day

describe('EspressoStrategy', () => {
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
      0, // no daily limit
    ])) as EspressoRewardsMock

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

    await stakingPool.addStrategy(strategy.target)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])
    await strategy.setFundFlowController(accounts[0])
    await strategy.setRewardsOracle(accounts[0])

    // Register validators and add vaults
    const validators = [accounts[5], accounts[6], accounts[7]]
    for (const validator of validators) {
      await espressoStaking.registerValidator(validator)
      await strategy.addVault(validator)
    }

    // Fund the rewards contract
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
      stakingPool,
      strategy,
      vaultImplementation,
      vaults,
      validators,
    }
  }

  it('deposit should work correctly', async () => {
    const { signers, accounts, token, stakingPool, strategy, vaults } = await loadFixture(
      deployFixture
    )

    // Should revert if caller is not staking pool
    await expect(strategy.connect(signers[1]).deposit(toEther(100), '0x')).to.be.revertedWith(
      'StakingPool only'
    )

    // initial state should be empty
    assert.equal(fromEther(await strategy.getTotalDeposits()), 0)
    assert.equal(fromEther(await strategy.totalQueued()), 0)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 0)

    // first deposit goes to queue, not yet distributed to vaults
    await stakingPool.deposit(accounts[0], toEther(100), ['0x'])

    assert.equal(fromEther(await token.balanceOf(strategy.target)), 100)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 100)
    assert.equal(fromEther(await strategy.totalQueued()), 100)
    for (const vault of vaults) {
      assert.equal(fromEther(await vault.getTotalDeposits()), 0)
    }

    // additional deposits accumulate in queue
    await stakingPool.deposit(accounts[0], toEther(200), ['0x'])

    assert.equal(fromEther(await token.balanceOf(strategy.target)), 300)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)
    assert.equal(fromEther(await strategy.totalQueued()), 300)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0)
    assert.equal(await strategy.getMaxDeposits(), ethers.MaxUint256)

    // distribute queued tokens across vaults
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    assert.equal(fromEther(await strategy.totalQueued()), 0)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 0)
    assert.equal(fromEther(await strategy.getMinDeposits()), 300)

    // new deposits queue separately from already-staked funds
    await stakingPool.deposit(accounts[0], toEther(50), ['0x'])

    assert.equal(fromEther(await token.balanceOf(strategy.target)), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 350)
    assert.equal(fromEther(await strategy.totalQueued()), 50)
    assert.equal(fromEther(await strategy.getMinDeposits()), 300)
  })

  it('withdraw should work correctly', async () => {
    const { signers, accounts, token, stakingPool, strategy, vaults } = await loadFixture(
      deployFixture
    )

    // Should revert if caller is not staking pool
    await expect(strategy.connect(signers[1]).withdraw(toEther(100), '0x')).to.be.revertedWith(
      'StakingPool only'
    )

    // Deposit tokens first
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])

    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)
    assert.equal(fromEther(await strategy.totalQueued()), 300)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 300)

    const preBalance = await token.balanceOf(accounts[0])

    // Withdraw some tokens (only queued tokens can be withdrawn directly)
    await stakingPool.withdraw(accounts[0], accounts[0], toEther(100), ['0x'])

    assert.equal(fromEther((await token.balanceOf(accounts[0])) - preBalance), 100)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 200)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 200)
    assert.equal(fromEther(await strategy.totalQueued()), 200)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0)

    // Withdraw more tokens
    const preBalance2 = await token.balanceOf(accounts[0])
    await stakingPool.withdraw(accounts[0], accounts[0], toEther(150), ['0x'])

    assert.equal(fromEther((await token.balanceOf(accounts[0])) - preBalance2), 150)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 50)
    assert.equal(fromEther(await strategy.totalQueued()), 50)

    // Withdraw remaining tokens (leave 10 to avoid dead shares edge case)
    const preBalance3 = await token.balanceOf(accounts[0])
    await stakingPool.withdraw(accounts[0], accounts[0], toEther(40), ['0x'])

    assert.equal(fromEther((await token.balanceOf(accounts[0])) - preBalance3), 40)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 10)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 10)
    assert.equal(fromEther(await strategy.totalQueued()), 10)

    // Test withdraw after some tokens are staked in vaults
    // Deposit and stake some tokens
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1], [toEther(100), toEther(100)])

    assert.equal(fromEther(await strategy.getTotalDeposits()), 310)
    assert.equal(fromEther(await strategy.totalQueued()), 110)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 110)
    assert.equal(fromEther(await strategy.getMinDeposits()), 200)

    // Withdraw queued tokens (leave 10 remaining)
    const preBalance4 = await token.balanceOf(accounts[0])
    await stakingPool.withdraw(accounts[0], accounts[0], toEther(100), ['0x'])

    assert.equal(fromEther((await token.balanceOf(accounts[0])) - preBalance4), 100)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 10)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 210)
    assert.equal(fromEther(await strategy.totalQueued()), 10)
    assert.equal(fromEther(await strategy.getMinDeposits()), 200)

    // Verify vaults still have their deposits (withdraw doesn't touch vaults)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 100)
    assert.equal(fromEther(await vaults[1].getTotalDeposits()), 100)
    assert.equal(fromEther(await vaults[2].getTotalDeposits()), 0)
  })

  it('depositQueuedTokens should work correctly', async () => {
    const { signers, accounts, token, stakingPool, strategy, vaults, espressoStaking, validators } =
      await loadFixture(deployFixture)

    // Should revert if caller is not fund flow controller
    await expect(
      strategy.connect(signers[1]).depositQueuedTokens([0], [toEther(100)])
    ).to.be.revertedWithCustomError(strategy, 'SenderNotAuthorized')

    // Deposit tokens to have queued balance
    await stakingPool.deposit(accounts[0], toEther(500), ['0x'])

    assert.equal(fromEther(await strategy.totalQueued()), 500)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 500)

    // Should revert if array lengths don't match
    await expect(
      strategy.depositQueuedTokens([0, 1], [toEther(100)])
    ).to.be.revertedWithCustomError(strategy, 'InvalidParamLengths')

    await expect(
      strategy.depositQueuedTokens([0], [toEther(100), toEther(100)])
    ).to.be.revertedWithCustomError(strategy, 'InvalidParamLengths')

    // Should revert if amount is 0
    await expect(strategy.depositQueuedTokens([0], [0])).to.be.revertedWithCustomError(
      strategy,
      'InvalidAmount'
    )

    await expect(
      strategy.depositQueuedTokens([0, 1], [toEther(100), 0])
    ).to.be.revertedWithCustomError(strategy, 'InvalidAmount')

    // Deposit to single vault
    await strategy.depositQueuedTokens([0], [toEther(100)])

    assert.equal(fromEther(await strategy.totalQueued()), 400)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 400)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 100)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100)
    assert.equal(fromEther(await espressoStaking.delegations(validators[0], vaults[0].target)), 100)

    // Deposit to multiple vaults
    await strategy.depositQueuedTokens([1, 2], [toEther(150), toEther(200)])

    assert.equal(fromEther(await strategy.totalQueued()), 50)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 100)
    assert.equal(fromEther(await vaults[1].getTotalDeposits()), 150)
    assert.equal(fromEther(await vaults[2].getTotalDeposits()), 200)
    assert.equal(fromEther(await espressoStaking.delegations(validators[1], vaults[1].target)), 150)
    assert.equal(fromEther(await espressoStaking.delegations(validators[2], vaults[2].target)), 200)

    // Deposit remaining to existing vault (adds to existing deposits)
    await strategy.depositQueuedTokens([0], [toEther(50)])

    assert.equal(fromEther(await strategy.totalQueued()), 0)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 0)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 150)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 150)
    assert.equal(fromEther(await espressoStaking.delegations(validators[0], vaults[0].target)), 150)

    // Verify getMinDeposits reflects all deposits are now staked
    assert.equal(fromEther(await strategy.getMinDeposits()), 500)

    // Deposit more and test depositing to same vault multiple times in one call
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 0], [toEther(50), toEther(100), toEther(50)])

    assert.equal(fromEther(await strategy.totalQueued()), 100)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 250) // 150 + 50 + 50
    assert.equal(fromEther(await vaults[1].getTotalDeposits()), 250) // 150 + 100

    // Empty array should revert
    await expect(strategy.depositQueuedTokens([], [])).to.be.revertedWithCustomError(
      strategy,
      'InvalidParamLengths'
    )
  })

  it('unbond should work correctly', async () => {
    const { signers, accounts, stakingPool, strategy, vaults, espressoStaking, validators } =
      await loadFixture(deployFixture)

    // Should revert if caller is not fund flow controller
    await expect(strategy.connect(signers[1]).unbond(toEther(100))).to.be.revertedWithCustomError(
      strategy,
      'SenderNotAuthorized'
    )

    // Should revert if amount is 0
    await expect(strategy.unbond(0)).to.be.revertedWithCustomError(strategy, 'InvalidAmount')

    // Deposit and stake tokens in vaults
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    assert.equal(Number(await strategy.numVaultsUnbonding()), 0)
    assert.equal(Number(await strategy.vaultWithdrawalIndex()), 0)

    // Should revert if trying to unbond more than available
    await expect(strategy.unbond(toEther(400))).to.be.revertedWithCustomError(
      strategy,
      'InsufficientDeposits'
    )

    // Unbond from single vault (partial)
    await strategy.unbond(toEther(50))

    assert.equal(Number(await strategy.numVaultsUnbonding()), 1)
    assert.equal(Number(await strategy.vaultWithdrawalIndex()), 1) // moved to next vault
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 50)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 50)
    assert.equal(await vaults[0].isUnbonding(), true)

    // Should revert if unbonding already in progress
    await expect(strategy.unbond(toEther(50))).to.be.revertedWithCustomError(
      strategy,
      'UnbondingInProgress'
    )

    // Complete the unbond cycle
    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([0])

    assert.equal(Number(await strategy.numVaultsUnbonding()), 0)
    assert.equal(fromEther(await strategy.totalQueued()), 50)

    // Unbond spanning multiple vaults
    await strategy.unbond(toEther(150))

    // Should have unbonded from vault 1 (100) and vault 2 (50)
    assert.equal(Number(await strategy.numVaultsUnbonding()), 2)
    assert.equal(Number(await strategy.vaultWithdrawalIndex()), 0) // wrapped around
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 100)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 50)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 50)

    // Complete unbond
    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([1, 2])

    assert.equal(fromEther(await strategy.totalQueued()), 200) // 50 + 150

    // Unbond exact amount from one vault
    await strategy.unbond(toEther(50))

    assert.equal(Number(await strategy.numVaultsUnbonding()), 1)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 50)

    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([0])

    // Unbond remaining from vault 2
    await strategy.unbond(toEther(50))

    assert.equal(Number(await strategy.numVaultsUnbonding()), 1)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 50)

    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([2])

    // All tokens should now be queued
    assert.equal(fromEther(await strategy.totalQueued()), 300)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0)

    // Test unbond counts inactive vault deposits toward unbond amount
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    // Exit validator 1
    await espressoStaking.exitValidator(validators[1])
    assert.equal(await vaults[1].isActive(), false)

    // Unbond 150: vault 0 has 100, vault 1 is inactive with 100 (counted but not unbonded)
    // So we need 150, vault 0 gives 100 (unbonded), vault 1 gives 100 (counted), done at 200 >= 150
    await strategy.unbond(toEther(150))

    // Vault 0 fully unbonded, vault 1 skipped but its deposits counted toward the 150 target
    assert.equal(Number(await strategy.numVaultsUnbonding()), 1)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 100)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 0) // skipped, but counted
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 0) // not reached
  })

  it('forceUnbond should work correctly', async () => {
    const { signers, accounts, stakingPool, strategy, vaults } = await loadFixture(deployFixture)

    // Should revert if caller is not fund flow controller
    await expect(
      strategy.connect(signers[1]).forceUnbond([0], [toEther(100)])
    ).to.be.revertedWithCustomError(strategy, 'SenderNotAuthorized')

    // Deposit and stake tokens in vaults
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    // Should revert if array lengths don't match
    await expect(strategy.forceUnbond([0, 1], [toEther(50)])).to.be.revertedWithCustomError(
      strategy,
      'InvalidParamLengths'
    )

    await expect(
      strategy.forceUnbond([0], [toEther(50), toEther(50)])
    ).to.be.revertedWithCustomError(strategy, 'InvalidParamLengths')

    // Should revert if amount is 0
    await expect(strategy.forceUnbond([0], [0])).to.be.revertedWithCustomError(
      strategy,
      'InvalidAmount'
    )

    // Should revert if vault IDs not in ascending order
    await expect(
      strategy.forceUnbond([1, 0], [toEther(50), toEther(50)])
    ).to.be.revertedWithCustomError(strategy, 'InvalidVaultIds')

    await expect(
      strategy.forceUnbond([0, 0], [toEther(50), toEther(50)])
    ).to.be.revertedWithCustomError(strategy, 'InvalidVaultIds')

    // Force unbond from single vault
    await strategy.forceUnbond([0], [toEther(30)])

    assert.equal(Number(await strategy.numVaultsUnbonding()), 1)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 70)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 30)
    assert.equal(await vaults[0].isUnbonding(), true)

    // Should revert if unbonding already in progress
    await expect(strategy.forceUnbond([1], [toEther(50)])).to.be.revertedWithCustomError(
      strategy,
      'UnbondingInProgress'
    )

    // Complete unbond
    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([0])

    assert.equal(Number(await strategy.numVaultsUnbonding()), 0)
    assert.equal(fromEther(await strategy.totalQueued()), 30)

    // Force unbond from multiple vaults (must be in ascending order)
    await strategy.forceUnbond([0, 1, 2], [toEther(20), toEther(40), toEther(60)])

    assert.equal(Number(await strategy.numVaultsUnbonding()), 3)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 50)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 20)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 60)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 40)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 40)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 60)

    // Complete unbond
    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([0, 1, 2])

    assert.equal(fromEther(await strategy.totalQueued()), 150)

    // Force unbond non-contiguous vaults (still must be ascending)
    await strategy.forceUnbond([0, 2], [toEther(25), toEther(15)])

    assert.equal(Number(await strategy.numVaultsUnbonding()), 2)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 25)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 25)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 60)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 25)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 15)

    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([0, 2])

    assert.equal(fromEther(await strategy.totalQueued()), 190)

    // Verify vaultWithdrawalIndex is NOT affected by forceUnbond (unlike unbond)
    assert.equal(Number(await strategy.vaultWithdrawalIndex()), 0)
  })

  it('claimUnbond should work correctly', async () => {
    const { signers, accounts, token, stakingPool, strategy, vaults } = await loadFixture(
      deployFixture
    )

    // Should revert if caller is not fund flow controller
    await expect(strategy.connect(signers[1]).claimUnbond([0])).to.be.revertedWithCustomError(
      strategy,
      'SenderNotAuthorized'
    )

    // Should revert if no vaults are unbonding
    await expect(strategy.claimUnbond([0])).to.be.revertedWithCustomError(
      strategy,
      'NoVaultsUnbonding'
    )

    // Deposit and stake tokens in vaults
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    // Unbond from single vault
    await strategy.unbond(toEther(50))

    assert.equal(Number(await strategy.numVaultsUnbonding()), 1)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 50)

    // Should revert if escrow period hasn't passed
    await expect(strategy.claimUnbond([0])).to.be.reverted

    // Advance time past escrow period
    await time.increase(exitEscrowPeriod)

    // Should revert if wrong number of vaults provided
    await expect(strategy.claimUnbond([0, 1])).to.be.reverted

    await expect(strategy.claimUnbond([])).to.be.revertedWithCustomError(
      strategy,
      'MustWithdrawAllVaults'
    )

    const preBalance = await token.balanceOf(strategy.target)

    // Successfully claim unbond
    await strategy.claimUnbond([0])

    assert.equal(Number(await strategy.numVaultsUnbonding()), 0)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await strategy.totalQueued()), 50)
    assert.equal(fromEther((await token.balanceOf(strategy.target)) - preBalance), 50)

    // Test claiming multiple vaults at once
    await strategy.forceUnbond([0, 1, 2], [toEther(30), toEther(40), toEther(50)])

    assert.equal(Number(await strategy.numVaultsUnbonding()), 3)

    await time.increase(exitEscrowPeriod)

    // Should revert if not all vaults are claimed
    await expect(strategy.claimUnbond([0, 1])).to.be.revertedWithCustomError(
      strategy,
      'MustWithdrawAllVaults'
    )

    await expect(strategy.claimUnbond([0])).to.be.revertedWithCustomError(
      strategy,
      'MustWithdrawAllVaults'
    )

    const preBalance2 = await token.balanceOf(strategy.target)

    // Successfully claim all unbonding vaults
    await strategy.claimUnbond([0, 1, 2])

    assert.equal(Number(await strategy.numVaultsUnbonding()), 0)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await strategy.totalQueued()), 170)
    assert.equal(fromEther((await token.balanceOf(strategy.target)) - preBalance2), 120)

    // Verify totalDeposits unchanged (tokens just moved from vaults to strategy)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)

    // Verify vault principal deposits decreased
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 20)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 60)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 50)
  })

  it('updateDeposits should work correctly', async () => {
    const { signers, accounts, token, stakingPool, strategy, vaults, espressoStaking, validators } =
      await loadFixture(deployFixture)

    // Should revert if caller is not staking pool
    await expect(strategy.connect(signers[1]).updateDeposits('0x')).to.be.revertedWith(
      'StakingPool only'
    )

    // Initial state - no deposits, no change
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    // Add fees: 10% to accounts[1], 5% to accounts[2] (total 15%)
    await strategy.addFee(accounts[1], 1000) // 10% = 1000 bps
    await strategy.addFee(accounts[2], 500) // 5% = 500 bps

    // Deposit tokens
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)
    assert.equal(fromEther(await strategy.totalQueued()), 0)

    // No rewards yet, deposit change should be 0
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    // Call updateDeposits with no rewards - should be a no-op
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    // Record pre-balance of fee receivers
    const preBalanceFee1 = await stakingPool.balanceOf(accounts[1])
    const preBalanceFee2 = await stakingPool.balanceOf(accounts[2])

    // Simulate rewards by updating lifetime rewards on vaults
    await strategy.setRewardsOracle(accounts[0])
    await strategy.updateLifetimeRewards([0, 1, 2], [toEther(10), toEther(20), toEther(30)])

    // Deposit change should now be positive (60 in rewards)
    assert.equal(fromEther(await strategy.getDepositChange()), 60)

    // Call updateDeposits via updateStrategyRewards on staking pool
    await stakingPool.updateStrategyRewards([0], '0x')

    // totalDeposits should have increased by rewards
    assert.equal(fromEther(await strategy.getTotalDeposits()), 360)
    // Deposit change should now be 0
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    // Verify fee receivers got their fees (10% of 60 = 6, 5% of 60 = 3)
    const postBalanceFee1 = await stakingPool.balanceOf(accounts[1])
    const postBalanceFee2 = await stakingPool.balanceOf(accounts[2])
    assert.closeTo(fromEther(postBalanceFee1 - preBalanceFee1), 6, 0.01)
    assert.closeTo(fromEther(postBalanceFee2 - preBalanceFee2), 3, 0.01)

    // Add more rewards and verify accumulation
    await strategy.updateLifetimeRewards([0, 1, 2], [toEther(25), toEther(35), toEther(40)])

    // New rewards: (25-10) + (35-20) + (40-30) = 15 + 15 + 10 = 40
    assert.equal(fromEther(await strategy.getDepositChange()), 40)

    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    // Test with tokens directly transferred to strategy
    await token.transfer(strategy.target, toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 50)

    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(fromEther(await strategy.getTotalDeposits()), 450)
    assert.equal(fromEther(await strategy.totalQueued()), 50)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    // Test negative deposit change (slashing scenario) - no fees should be paid
    await stakingPool.deposit(accounts[0], toEther(100), ['0x'])
    await strategy.depositQueuedTokens([0], [toEther(100)])

    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await strategy.totalQueued()), 50)

    const preSharesFee1BeforeSlash = await stakingPool.sharesOf(accounts[1])
    const preSharesFee2BeforeSlash = await stakingPool.sharesOf(accounts[2])

    // Simulate slashing by reducing vault 0's principal
    await espressoStaking.slash(validators[0], vaults[0].target, toEther(30))

    // Deposit change should now be negative (-30)
    assert.equal(fromEther(await strategy.getDepositChange()), -30)

    // Call updateDeposits - should reduce totalDeposits
    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(fromEther(await strategy.getTotalDeposits()), 520)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    // Verify no fees paid on negative rewards (no new shares minted to fee receivers)
    const postSharesFee1AfterSlash = await stakingPool.sharesOf(accounts[1])
    const postSharesFee2AfterSlash = await stakingPool.sharesOf(accounts[2])
    assert.equal(postSharesFee1AfterSlash, preSharesFee1BeforeSlash)
    assert.equal(postSharesFee2AfterSlash, preSharesFee2BeforeSlash)
  })

  it('restakeRewards should work correctly', async () => {
    const { signers, accounts, stakingPool, strategy, vaults, espressoStaking, validators } =
      await loadFixture(deployFixture)

    // Should revert if caller is not fund flow controller
    await expect(
      strategy.connect(signers[1]).restakeRewards([0], [toEther(50)], ['0x'])
    ).to.be.revertedWithCustomError(strategy, 'SenderNotAuthorized')

    // Should revert if array lengths don't match
    await expect(
      strategy.restakeRewards([0, 1], [toEther(50)], ['0x'])
    ).to.be.revertedWithCustomError(strategy, 'InvalidParamLengths')

    await expect(
      strategy.restakeRewards([0], [toEther(50), toEther(50)], ['0x'])
    ).to.be.revertedWithCustomError(strategy, 'InvalidParamLengths')

    await expect(
      strategy.restakeRewards([0], [toEther(50)], ['0x', '0x'])
    ).to.be.revertedWithCustomError(strategy, 'InvalidParamLengths')

    // Deposit and stake tokens in vaults
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vaults[0].getRewards()), 0)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 100)

    // Simulate rewards by updating lifetime rewards on vault
    await strategy.updateLifetimeRewards([0], [toEther(50)])

    assert.equal(fromEther(await vaults[0].getRewards()), 50)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 150)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100)

    // Restake rewards for single vault
    await strategy.restakeRewards([0], [toEther(50)], ['0x'])

    // Rewards should be converted to principal
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 150)
    assert.equal(fromEther(await vaults[0].getRewards()), 0)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 150)
    assert.equal(fromEther(await espressoStaking.delegations(validators[0], vaults[0].target)), 150)

    // Update rewards on multiple vaults
    await strategy.updateLifetimeRewards([0, 1, 2], [toEther(70), toEther(30), toEther(40)])

    assert.equal(fromEther(await vaults[0].getRewards()), 20) // 70 - 50 already claimed
    assert.equal(fromEther(await vaults[1].getRewards()), 30)
    assert.equal(fromEther(await vaults[2].getRewards()), 40)

    // Restake rewards for multiple vaults at once
    await strategy.restakeRewards(
      [0, 1, 2],
      [toEther(70), toEther(30), toEther(40)],
      ['0x', '0x', '0x']
    )

    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 170) // 150 + 20
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 130) // 100 + 30
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 140) // 100 + 40
    assert.equal(fromEther(await vaults[0].getRewards()), 0)
    assert.equal(fromEther(await vaults[1].getRewards()), 0)
    assert.equal(fromEther(await vaults[2].getRewards()), 0)

    // Verify delegations increased in espresso staking
    assert.equal(fromEther(await espressoStaking.delegations(validators[0], vaults[0].target)), 170)
    assert.equal(fromEther(await espressoStaking.delegations(validators[1], vaults[1].target)), 130)
    assert.equal(fromEther(await espressoStaking.delegations(validators[2], vaults[2].target)), 140)

    // Calling restake with no new rewards should be a no-op
    await strategy.restakeRewards([0], [toEther(70)], ['0x'])

    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 170) // unchanged

    // Test restaking with outdated lifetime rewards (new rewards accrued since)
    await strategy.updateLifetimeRewards([0], [toEther(100)])

    assert.equal(fromEther(await vaults[0].getRewards()), 30) // 100 - 70

    // Restake with higher lifetime rewards than vault currently knows
    await strategy.restakeRewards([0], [toEther(110)], ['0x'])

    // Should restake the full 40 (110 - 70 already claimed)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 210) // 170 + 40
    assert.equal(fromEther(await vaults[0].getRewards()), 0)
  })

  it('withdrawRewards should work correctly', async () => {
    const { signers, accounts, token, stakingPool, strategy, vaults, espressoRewards } =
      await loadFixture(deployFixture)

    // Should revert if caller is not fund flow controller
    await expect(
      strategy.connect(signers[1]).withdrawRewards([0], [toEther(50)], ['0x'])
    ).to.be.revertedWithCustomError(strategy, 'SenderNotAuthorized')

    // Should revert if array lengths don't match
    await expect(
      strategy.withdrawRewards([0, 1], [toEther(50)], ['0x'])
    ).to.be.revertedWithCustomError(strategy, 'InvalidParamLengths')

    await expect(
      strategy.withdrawRewards([0], [toEther(50), toEther(50)], ['0x'])
    ).to.be.revertedWithCustomError(strategy, 'InvalidParamLengths')

    await expect(
      strategy.withdrawRewards([0], [toEther(50)], ['0x', '0x'])
    ).to.be.revertedWithCustomError(strategy, 'InvalidParamLengths')

    // Deposit and stake tokens in vaults
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    assert.equal(fromEther(await strategy.totalQueued()), 0)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 0)

    // Simulate rewards by updating lifetime rewards on vault
    await strategy.updateLifetimeRewards([0], [toEther(50)])

    assert.equal(fromEther(await vaults[0].getRewards()), 50)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 150)

    const preBalance = await token.balanceOf(strategy.target)

    // Withdraw rewards for single vault
    await strategy.withdrawRewards([0], [toEther(50)], ['0x'])

    // Rewards should be withdrawn to strategy and added to totalQueued
    assert.equal(fromEther(await vaults[0].getRewards()), 0)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 100) // back to principal only
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100) // unchanged
    assert.equal(fromEther(await strategy.totalQueued()), 50)
    assert.equal(fromEther((await token.balanceOf(strategy.target)) - preBalance), 50)

    // Verify rewards were claimed from espresso rewards contract
    assert.equal(fromEther(await espressoRewards.claimedRewards(vaults[0].target)), 50)

    // Update rewards on multiple vaults
    await strategy.updateLifetimeRewards([0, 1, 2], [toEther(70), toEther(30), toEther(40)])

    assert.equal(fromEther(await vaults[0].getRewards()), 20) // 70 - 50 already claimed
    assert.equal(fromEther(await vaults[1].getRewards()), 30)
    assert.equal(fromEther(await vaults[2].getRewards()), 40)

    const preBalance2 = await token.balanceOf(strategy.target)

    // Withdraw rewards for multiple vaults at once
    await strategy.withdrawRewards(
      [0, 1, 2],
      [toEther(70), toEther(30), toEther(40)],
      ['0x', '0x', '0x']
    )

    assert.equal(fromEther(await vaults[0].getRewards()), 0)
    assert.equal(fromEther(await vaults[1].getRewards()), 0)
    assert.equal(fromEther(await vaults[2].getRewards()), 0)
    assert.equal(fromEther(await strategy.totalQueued()), 140) // 50 + 20 + 30 + 40
    assert.equal(fromEther((await token.balanceOf(strategy.target)) - preBalance2), 90) // 20 + 30 + 40

    // Verify claimed rewards tracking
    assert.equal(fromEther(await espressoRewards.claimedRewards(vaults[0].target)), 70)
    assert.equal(fromEther(await espressoRewards.claimedRewards(vaults[1].target)), 30)
    assert.equal(fromEther(await espressoRewards.claimedRewards(vaults[2].target)), 40)

    // Calling withdraw with no new rewards should be a no-op
    const preBalance3 = await token.balanceOf(strategy.target)
    await strategy.withdrawRewards([0], [toEther(70)], ['0x'])

    assert.equal(fromEther((await token.balanceOf(strategy.target)) - preBalance3), 0)
    assert.equal(fromEther(await strategy.totalQueued()), 140) // unchanged

    // Test withdrawing with higher lifetime rewards than vault currently knows
    await strategy.updateLifetimeRewards([0], [toEther(100)])

    assert.equal(fromEther(await vaults[0].getRewards()), 30) // 100 - 70

    const preBalance4 = await token.balanceOf(strategy.target)

    // Withdraw with updated lifetime rewards
    await strategy.withdrawRewards([0], [toEther(110)], ['0x'])

    // Should withdraw 40 (110 - 70 already claimed)
    assert.equal(fromEther(await vaults[0].getRewards()), 0)
    assert.equal(fromEther((await token.balanceOf(strategy.target)) - preBalance4), 40)
    assert.equal(fromEther(await strategy.totalQueued()), 180) // 140 + 40

    // Verify principal deposits unchanged throughout
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 100)
  })

  it('claimValidatorExits should work correctly', async () => {
    const { signers, accounts, token, stakingPool, strategy, vaults, espressoStaking, validators } =
      await loadFixture(deployFixture)

    // Should revert if caller is not fund flow controller
    await expect(strategy.connect(signers[1]).claimValidatorExits([0])).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )

    // Deposit and stake tokens in vaults
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    assert.equal(fromEther(await strategy.totalQueued()), 0)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100)
    assert.equal(await vaults[0].isActive(), true)
    assert.equal(await vaults[0].exitIsWithdrawable(), false)

    // Exit validator 0
    await espressoStaking.exitValidator(validators[0])

    assert.equal(await vaults[0].isActive(), false)
    assert.equal(await vaults[0].exitIsWithdrawable(), false) // Not yet withdrawable (escrow period)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100) // still has deposits

    // Advance time past exit escrow period
    await time.increase(exitEscrowPeriod)

    assert.equal(await vaults[0].exitIsWithdrawable(), true) // Now withdrawable

    const preBalance = await token.balanceOf(strategy.target)

    // Claim validator exit for single vault
    await strategy.claimValidatorExits([0])

    // Principal should be withdrawn and added to totalQueued
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 0)
    assert.equal(fromEther(await strategy.totalQueued()), 100)
    assert.equal(fromEther((await token.balanceOf(strategy.target)) - preBalance), 100)

    // Exit multiple validators
    await espressoStaking.exitValidator(validators[1])
    await espressoStaking.exitValidator(validators[2])

    assert.equal(await vaults[1].isActive(), false)
    assert.equal(await vaults[2].isActive(), false)

    const preBalance2 = await token.balanceOf(strategy.target)

    // Claim validator exits for multiple vaults at once
    await strategy.claimValidatorExits([1, 2])

    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vaults[1].getTotalDeposits()), 0)
    assert.equal(fromEther(await vaults[2].getTotalDeposits()), 0)
    assert.equal(fromEther(await strategy.totalQueued()), 300) // 100 + 100 + 100
    assert.equal(fromEther((await token.balanceOf(strategy.target)) - preBalance2), 200)

    // Verify totalDeposits unchanged (tokens moved from vaults to strategy)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)
  })

  it('updateLifetimeRewards should work correctly', async () => {
    const { signers, accounts, stakingPool, strategy, vaults } = await loadFixture(deployFixture)

    await strategy.setMaxRewardChangeBPS(1000)

    // Should revert if caller is not rewards oracle
    await expect(
      strategy.connect(signers[1]).updateLifetimeRewards([0], [toEther(50)])
    ).to.be.revertedWithCustomError(strategy, 'SenderNotAuthorized')

    // Should revert if array lengths don't match
    await expect(
      strategy.updateLifetimeRewards([0, 1], [toEther(50)])
    ).to.be.revertedWithCustomError(strategy, 'InvalidParamLengths')

    await expect(
      strategy.updateLifetimeRewards([0], [toEther(50), toEther(50)])
    ).to.be.revertedWithCustomError(strategy, 'InvalidParamLengths')

    // Deposit and stake tokens in vaults
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    assert.equal(fromEther(await vaults[0].getRewards()), 0)
    assert.equal(fromEther(await vaults[1].getRewards()), 0)
    assert.equal(fromEther(await vaults[2].getRewards()), 0)

    // Update lifetime rewards for single vault
    await strategy.updateLifetimeRewards([0], [toEther(10)])

    assert.equal(fromEther(await vaults[0].getRewards()), 10)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 110)

    // Update lifetime rewards for multiple vaults
    await strategy.updateLifetimeRewards([0, 1, 2], [toEther(15), toEther(10), toEther(5)])

    assert.equal(fromEther(await vaults[0].getRewards()), 15)
    assert.equal(fromEther(await vaults[1].getRewards()), 10)
    assert.equal(fromEther(await vaults[2].getRewards()), 5)

    // Verify getDepositChange reflects the rewards
    assert.equal(fromEther(await strategy.getDepositChange()), 30) // 15 + 10 + 5

    // Should revert if rewards are too high (> 10% of totalDeposits)
    // totalDeposits = 300, so max rewards = 30
    // Current rewards = 30, so adding 1 more would exceed limit
    await expect(strategy.updateLifetimeRewards([0], [toEther(16)])).to.be.revertedWithCustomError(
      strategy,
      'RewardsTooHigh'
    )

    // Sync deposits to reset reward tracking
    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(fromEther(await strategy.getTotalDeposits()), 330)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    // Now max rewards = 33 (10% of 330)
    // Can add up to 33 in new rewards
    await strategy.updateLifetimeRewards([0, 1, 2], [toEther(30), toEther(20), toEther(13)])

    // New rewards: (30-15) + (20-10) + (13-5) = 15 + 10 + 8 = 33
    assert.equal(fromEther(await strategy.getDepositChange()), 33)

    // Adding 1 more would exceed 10%
    await expect(strategy.updateLifetimeRewards([0], [toEther(31)])).to.be.revertedWithCustomError(
      strategy,
      'RewardsTooHigh'
    )

    // Setting same value should work (no new rewards)
    await strategy.updateLifetimeRewards([0], [toEther(30)])
    assert.equal(fromEther(await vaults[0].getRewards()), 30)

    // Verify vault lifetime rewards cannot decrease (handled by vault)
    await expect(strategy.updateLifetimeRewards([0], [toEther(20)])).to.be.revertedWithCustomError(
      vaults[0],
      'InvalidLifetimeRewards'
    )
  })

  it('getTotalDeposits should work correctly', async () => {
    const { accounts, token, stakingPool, strategy } = await loadFixture(deployFixture)

    // Initially should be 0
    assert.equal(fromEther(await strategy.getTotalDeposits()), 0)

    // After deposit, should reflect deposited amount
    await stakingPool.deposit(accounts[0], toEther(100), ['0x'])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 100)

    // Multiple deposits should accumulate
    await stakingPool.deposit(accounts[0], toEther(200), ['0x'])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)

    // Depositing to vaults doesn't change totalDeposits
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)

    // Withdrawal decreases totalDeposits
    await stakingPool.deposit(accounts[0], toEther(50), ['0x']) // add some queued tokens first
    assert.equal(fromEther(await strategy.getTotalDeposits()), 350)

    await stakingPool.withdraw(accounts[0], accounts[0], toEther(50), ['0x'])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)

    // Unbonding and claiming doesn't change totalDeposits
    await strategy.unbond(toEther(100))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)

    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([0])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)

    // Rewards increase totalDeposits after updateDeposits is called
    await strategy.updateLifetimeRewards([1], [toEther(30)])

    assert.equal(fromEther(await strategy.getTotalDeposits()), 300)

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 330)

    // Tokens transferred directly to strategy increase totalDeposits after sync
    await token.transfer(strategy.target, toEther(20))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 330)

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 350)
  })

  it('getMaxDeposits should work correctly', async () => {
    const { strategy } = await loadFixture(deployFixture)

    // Should always return max uint256
    assert.equal(await strategy.getMaxDeposits(), ethers.MaxUint256)
  })

  it('getMinDeposits should work correctly', async () => {
    const { accounts, stakingPool, strategy } = await loadFixture(deployFixture)

    // Initially should be 0 (no deposits)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0)

    // After deposit, minDeposits = totalDeposits - totalQueued
    // Deposits go to queue first, so minDeposits stays 0
    await stakingPool.deposit(accounts[0], toEther(100), ['0x'])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 100)
    assert.equal(fromEther(await strategy.totalQueued()), 100)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0) // 100 - 100 = 0

    // After depositing queued tokens to vaults, minDeposits increases
    await strategy.depositQueuedTokens([0], [toEther(100)])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 100)
    assert.equal(fromEther(await strategy.totalQueued()), 0)
    assert.equal(fromEther(await strategy.getMinDeposits()), 100) // 100 - 0 = 100

    // More deposits with partial queue
    await stakingPool.deposit(accounts[0], toEther(50), ['0x'])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 150)
    assert.equal(fromEther(await strategy.totalQueued()), 50)
    assert.equal(fromEther(await strategy.getMinDeposits()), 100) // 150 - 50 = 100

    // Deposit more to vaults
    await strategy.depositQueuedTokens([1], [toEther(50)])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 150)
    assert.equal(fromEther(await strategy.totalQueued()), 0)
    assert.equal(fromEther(await strategy.getMinDeposits()), 150) // 150 - 0 = 150
  })

  it('getVaults should work correctly', async () => {
    const {
      accounts,
      strategy,
      vaults,
      validators,
      vaultImplementation,
      espressoStaking,
      espressoRewards,
      token,
    } = await loadFixture(deployFixture)

    // Initially should return 3 vaults from fixture setup
    const initialVaults = await strategy.getVaults()
    assert.equal(initialVaults.length, 3)
    assert.equal(initialVaults[0], vaults[0].target)
    assert.equal(initialVaults[1], vaults[1].target)
    assert.equal(initialVaults[2], vaults[2].target)

    // Deploy a new strategy with no vaults to test empty state
    const newStrategy = (await deployUpgradeable('EspressoStrategy', [
      token.target,
      accounts[0],
      espressoStaking.target,
      espressoRewards.target,
      vaultImplementation,
      1000,
      [],
    ])) as EspressoStrategy

    // New strategy should have empty vaults array
    const emptyVaults = await newStrategy.getVaults()
    assert.equal(emptyVaults.length, 0)

    // Add a vault and verify it appears
    await newStrategy.addVault(validators[0])

    const vaultsAfterAdd = await newStrategy.getVaults()
    assert.equal(vaultsAfterAdd.length, 1)

    // Add more vaults and verify they appear in order
    await newStrategy.addVault(validators[1])
    await newStrategy.addVault(validators[2])

    const vaultsAfterMultiple = await newStrategy.getVaults()
    assert.equal(vaultsAfterMultiple.length, 3)

    // Verify vault addresses are different (unique proxies)
    assert.notEqual(vaultsAfterMultiple[0], vaultsAfterMultiple[1])
    assert.notEqual(vaultsAfterMultiple[1], vaultsAfterMultiple[2])
    assert.notEqual(vaultsAfterMultiple[0], vaultsAfterMultiple[2])

    // Remove a vault and verify it's removed
    await newStrategy.removeVaults([1])

    const vaultsAfterRemove = await newStrategy.getVaults()
    assert.equal(vaultsAfterRemove.length, 2)
    // Last vault should have moved to index 1
    assert.equal(vaultsAfterRemove[0], vaultsAfterMultiple[0])
    assert.equal(vaultsAfterRemove[1], vaultsAfterMultiple[2])

    // Remove remaining vaults
    await newStrategy.removeVaults([0, 1])

    const vaultsAfterRemoveAll = await newStrategy.getVaults()
    assert.equal(vaultsAfterRemoveAll.length, 0)
  })

  it('addVault should work correctly', async () => {
    const { signers, accounts, token, strategy, espressoStaking } = await loadFixture(deployFixture)

    // Should revert if caller is not owner
    await expect(strategy.connect(signers[1]).addVault(accounts[8])).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )

    // Initially should have 3 vaults from fixture
    assert.equal((await strategy.getVaults()).length, 3)

    // Register a new validator
    const newValidator = accounts[8]
    await espressoStaking.registerValidator(newValidator)

    // Add a new vault
    await strategy.addVault(newValidator)

    const vaultsAfterAdd = await strategy.getVaults()
    assert.equal(vaultsAfterAdd.length, 4)

    // Verify the new vault was created correctly
    const newVaultAddress = vaultsAfterAdd[3]
    const newVault = await ethers.getContractAt('EspressoVault', newVaultAddress)

    // Verify vault is initialized with correct values
    assert.equal(await newVault.token(), token.target)
    assert.equal(await newVault.vaultController(), strategy.target)
    assert.equal(await newVault.validator(), newValidator)

    // Verify token approval was set for the new vault
    assert.equal(await token.allowance(strategy.target, newVaultAddress), ethers.MaxUint256)

    // Verify new vault can receive deposits
    const stakingPool = await ethers.getContractAt('StakingPool', await strategy.stakingPool())
    await stakingPool.deposit(accounts[0], toEther(100), ['0x'])
    await strategy.depositQueuedTokens([3], [toEther(100)])

    assert.equal(fromEther(await newVault.getPrincipalDeposits()), 100)
    assert.equal(fromEther(await espressoStaking.delegations(newValidator, newVaultAddress)), 100)

    // Add multiple vaults sequentially
    const validator9 = accounts[9]
    await espressoStaking.registerValidator(validator9)
    await strategy.addVault(validator9)

    assert.equal((await strategy.getVaults()).length, 5)

    // Verify each vault has unique address
    const allVaults = await strategy.getVaults()
    const uniqueAddresses = new Set(allVaults.map((v: any) => v.toString()))
    assert.equal(uniqueAddresses.size, 5)
  })

  it('removeVaults should work correctly', async () => {
    const { signers, accounts, token, stakingPool, strategy, vaults, espressoStaking } =
      await loadFixture(deployFixture)

    // Should revert if caller is not owner
    await expect(strategy.connect(signers[1]).removeVaults([0])).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )

    // Should revert if empty array provided
    await expect(strategy.removeVaults([])).to.be.revertedWithCustomError(
      strategy,
      'InvalidParamLengths'
    )

    // Should revert if vault has deposits (not empty)
    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    await expect(strategy.removeVaults([0])).to.be.revertedWithCustomError(
      strategy,
      'VaultNotEmpty'
    )

    // Unbond and claim to empty vault 0
    await strategy.unbond(toEther(100))
    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([0])

    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 0)

    // Now can remove vault 0
    await strategy.removeVaults([0])

    const vaultsAfterRemove = await strategy.getVaults()
    assert.equal(vaultsAfterRemove.length, 2)
    // Vault at index 1 should now be at index 0, vault at index 2 should be at index 1
    assert.equal(vaultsAfterRemove[0], vaults[1].target)
    assert.equal(vaultsAfterRemove[1], vaults[2].target)

    // Verify token approval was removed
    assert.equal(await token.allowance(strategy.target, vaults[0].target), 0n)

    // Should revert if indices not in ascending order when removing multiple
    await strategy.forceUnbond([0, 1], [toEther(100), toEther(100)])
    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([0, 1])

    await expect(strategy.removeVaults([1, 0])).to.be.revertedWithCustomError(
      strategy,
      'InvalidVaultIds'
    )

    // Remove multiple vaults in ascending order
    await strategy.removeVaults([0, 1])

    const vaultsAfterRemoveMultiple = await strategy.getVaults()
    assert.equal(vaultsAfterRemoveMultiple.length, 0)

    // Test removing vault with queued withdrawals (should withdraw automatically)
    // Add new vaults first
    await espressoStaking.registerValidator(accounts[8])
    await espressoStaking.registerValidator(accounts[9])
    await strategy.addVault(accounts[8])
    await strategy.addVault(accounts[9])

    const newVaults = await strategy.getVaults()
    assert.equal(newVaults.length, 2)

    // Deposit to new vaults
    await stakingPool.deposit(accounts[0], toEther(200), ['0x'])
    await strategy.depositQueuedTokens([0, 1], [toEther(100), toEther(100)])

    // Start unbonding on vault 0
    await strategy.forceUnbond([0], [toEther(100)])
    await time.increase(exitEscrowPeriod)

    // Removing vault with queued withdrawals should auto-withdraw
    const preBalance = await token.balanceOf(strategy.target)
    await strategy.removeVaults([0])

    // Tokens should have been withdrawn
    assert.equal(fromEther((await token.balanceOf(strategy.target)) - preBalance), 100)
    assert.equal((await strategy.getVaults()).length, 1)

    // Test removing vault after validator exit
    await espressoStaking.exitValidator(accounts[9])

    const vault1 = await ethers.getContractAt('EspressoVault', (await strategy.getVaults())[0])
    assert.equal(await vault1.isActive(), false)

    // Should auto-claim validator exit when removing
    const preBalance2 = await token.balanceOf(strategy.target)
    await strategy.removeVaults([0])

    assert.equal(fromEther((await token.balanceOf(strategy.target)) - preBalance2), 100)
    assert.equal((await strategy.getVaults()).length, 0)

    // Verify vaultWithdrawalIndex is adjusted correctly
    await espressoStaking.registerValidator(accounts[10])
    await espressoStaking.registerValidator(accounts[11])
    await espressoStaking.registerValidator(accounts[12])
    await strategy.addVault(accounts[10])
    await strategy.addVault(accounts[11])
    await strategy.addVault(accounts[12])

    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(100), toEther(100), toEther(100)])

    // Unbond to move vaultWithdrawalIndex
    await strategy.unbond(toEther(100))
    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([0])

    assert.equal(Number(await strategy.vaultWithdrawalIndex()), 1)

    // Remove vault 0 (before withdrawal index)
    await strategy.removeVaults([0])

    // vaultWithdrawalIndex should be decremented
    assert.equal(Number(await strategy.vaultWithdrawalIndex()), 0)
  })

  it('upgradeVaults should work correctly', async () => {
    const { signers, accounts, strategy, vaults } = await loadFixture(deployFixture)

    // Should revert if caller is not owner
    await expect(
      strategy.connect(signers[1]).upgradeVaults([vaults[0].target], [])
    ).to.be.revertedWith('Ownable: caller is not the owner')

    // Deploy a new vault implementation
    const newVaultImplementation = (await deployImplementation('EspressoVault')) as string

    // Set new vault implementation
    await strategy.setVaultImplementation(newVaultImplementation)

    // Upgrade single vault without data
    await strategy.upgradeVaults([vaults[0].target], [])

    // Verify vault still works after upgrade
    const stakingPool = await ethers.getContractAt('StakingPool', await strategy.stakingPool())
    await stakingPool.deposit(accounts[0], toEther(100), ['0x'])
    await strategy.depositQueuedTokens([0], [toEther(100)])

    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100)

    // Upgrade multiple vaults at once without data
    await strategy.upgradeVaults([vaults[1].target, vaults[2].target], [])

    // Verify all vaults still work
    await stakingPool.deposit(accounts[0], toEther(200), ['0x'])
    await strategy.depositQueuedTokens([1, 2], [toEther(100), toEther(100)])

    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 100)

    // Deploy another new implementation for upgrade with data test
    const anotherImplementation = (await deployImplementation('EspressoVault')) as string
    await strategy.setVaultImplementation(anotherImplementation)

    // Upgrade with empty data array elements (should use upgradeTo)
    await strategy.upgradeVaults([vaults[0].target], ['0x'])

    // Verify vault still works
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100)

    // Upgrade all vaults at once
    const allVaultAddresses = (await strategy.getVaults()).map((v: any) => v.toString())

    await strategy.upgradeVaults(allVaultAddresses, [])

    // Verify all vaults still function correctly after upgrade
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 100)

    // Test that deposits, unbonding, etc. still work after upgrade
    await strategy.unbond(toEther(50))
    await time.increase(exitEscrowPeriod)
    await strategy.claimUnbond([0])

    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 50)
    assert.equal(fromEther(await strategy.totalQueued()), 50)
  })

  it('getFees should work correctly', async () => {
    const { accounts, strategy, vaultImplementation } = await loadFixture(deployFixture)

    // Initially should return empty array (no fees in fixture)
    const initialFees = await strategy.getFees()
    assert.equal(initialFees.length, 0)

    // Add a fee and verify it appears
    await strategy.addFee(accounts[1], 500) // 5%

    const feesAfterAdd = await strategy.getFees()
    assert.equal(feesAfterAdd.length, 1)
    assert.equal(feesAfterAdd[0].receiver, accounts[1])
    assert.equal(Number(feesAfterAdd[0].basisPoints), 500)

    // Add multiple fees and verify they all appear
    await strategy.addFee(accounts[2], 300) // 3%
    await strategy.addFee(accounts[3], 200) // 2%

    const feesAfterMultiple = await strategy.getFees()
    assert.equal(feesAfterMultiple.length, 3)
    assert.equal(feesAfterMultiple[0].receiver, accounts[1])
    assert.equal(Number(feesAfterMultiple[0].basisPoints), 500)
    assert.equal(feesAfterMultiple[1].receiver, accounts[2])
    assert.equal(Number(feesAfterMultiple[1].basisPoints), 300)
    assert.equal(feesAfterMultiple[2].receiver, accounts[3])
    assert.equal(Number(feesAfterMultiple[2].basisPoints), 200)

    // Update a fee and verify getFees reflects change
    await strategy.updateFee(1, accounts[4], 400)

    const feesAfterUpdate = await strategy.getFees()
    assert.equal(feesAfterUpdate.length, 3)
    assert.equal(feesAfterUpdate[1].receiver, accounts[4])
    assert.equal(Number(feesAfterUpdate[1].basisPoints), 400)

    // Remove a fee (via updateFee with 0 basisPoints) and verify
    await strategy.updateFee(0, accounts[1], 0)

    const feesAfterRemove = await strategy.getFees()
    assert.equal(feesAfterRemove.length, 2)
    // Last fee moved to index 0
    assert.equal(feesAfterRemove[0].receiver, accounts[3])
    assert.equal(Number(feesAfterRemove[0].basisPoints), 200)
    assert.equal(feesAfterRemove[1].receiver, accounts[4])
    assert.equal(Number(feesAfterRemove[1].basisPoints), 400)

    // Deploy a new strategy with initial fees to test initialization
    const newStrategy = (await deployUpgradeable('EspressoStrategy', [
      accounts[0],
      accounts[0],
      accounts[0],
      accounts[0],
      vaultImplementation,
      1000,
      [
        { receiver: accounts[5], basisPoints: 1000 },
        { receiver: accounts[6], basisPoints: 500 },
      ],
    ])) as EspressoStrategy

    const initializedFees = await newStrategy.getFees()
    assert.equal(initializedFees.length, 2)
    assert.equal(initializedFees[0].receiver, accounts[5])
    assert.equal(Number(initializedFees[0].basisPoints), 1000)
    assert.equal(initializedFees[1].receiver, accounts[6])
    assert.equal(Number(initializedFees[1].basisPoints), 500)
  })

  it('addFee should work correctly', async () => {
    const { signers, accounts, strategy } = await loadFixture(deployFixture)

    // Should revert if caller is not owner
    await expect(strategy.connect(signers[1]).addFee(accounts[1], 500)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )

    // Initially should have no fees
    assert.equal((await strategy.getFees()).length, 0)

    // Add a single fee
    await strategy.addFee(accounts[1], 500)

    const feesAfterAdd = await strategy.getFees()
    assert.equal(feesAfterAdd.length, 1)
    assert.equal(feesAfterAdd[0].receiver, accounts[1])
    assert.equal(Number(feesAfterAdd[0].basisPoints), 500)

    // Add multiple fees
    await strategy.addFee(accounts[2], 1000)
    await strategy.addFee(accounts[3], 500)

    const feesAfterMultiple = await strategy.getFees()
    assert.equal(feesAfterMultiple.length, 3)
    assert.equal(feesAfterMultiple[1].receiver, accounts[2])
    assert.equal(Number(feesAfterMultiple[1].basisPoints), 1000)
    assert.equal(feesAfterMultiple[2].receiver, accounts[3])
    assert.equal(Number(feesAfterMultiple[2].basisPoints), 500)

    // Total fees = 500 + 1000 + 500 = 2000 (20%)
    // Can add up to 1000 more (30% max)
    await strategy.addFee(accounts[4], 1000)

    assert.equal((await strategy.getFees()).length, 4)

    // Total fees now = 3000 (30% - max)
    // Should revert if adding more would exceed 30%
    await expect(strategy.addFee(accounts[5], 1)).to.be.revertedWithCustomError(
      strategy,
      'FeesTooLarge'
    )

    // Adding 0 basisPoints should work (edge case)
    await strategy.addFee(accounts[5], 0)

    assert.equal((await strategy.getFees()).length, 5)
    assert.equal(Number((await strategy.getFees())[4].basisPoints), 0)

    // Verify fee receivers can be the same address (multiple fees to same receiver)
    await strategy.updateFee(4, accounts[5], 0) // remove the 0 fee first
    await strategy.updateFee(3, accounts[4], 0) // remove to make room

    // Now total = 2000, can add 1000 more
    await strategy.addFee(accounts[1], 500) // same receiver as fee[0]

    const feesWithDuplicate = await strategy.getFees()
    assert.equal(feesWithDuplicate[0].receiver, accounts[1])
    assert.equal(feesWithDuplicate[feesWithDuplicate.length - 1].receiver, accounts[1])
  })

  it('updateFee should work correctly', async () => {
    const { signers, accounts, strategy } = await loadFixture(deployFixture)

    // Add some fees first
    await strategy.addFee(accounts[1], 500)
    await strategy.addFee(accounts[2], 1000)
    await strategy.addFee(accounts[3], 500)

    // Should revert if caller is not owner
    await expect(strategy.connect(signers[1]).updateFee(0, accounts[4], 600)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )

    // Update fee receiver and basisPoints
    await strategy.updateFee(0, accounts[4], 600)

    const feesAfterUpdate = await strategy.getFees()
    assert.equal(feesAfterUpdate[0].receiver, accounts[4])
    assert.equal(Number(feesAfterUpdate[0].basisPoints), 600)

    // Update only receiver (keep same basisPoints)
    await strategy.updateFee(1, accounts[5], 1000)

    const feesAfterReceiverUpdate = await strategy.getFees()
    assert.equal(feesAfterReceiverUpdate[1].receiver, accounts[5])
    assert.equal(Number(feesAfterReceiverUpdate[1].basisPoints), 1000)

    // Update only basisPoints (keep same receiver)
    await strategy.updateFee(2, accounts[3], 800)

    const feesAfterBpUpdate = await strategy.getFees()
    assert.equal(feesAfterBpUpdate[2].receiver, accounts[3])
    assert.equal(Number(feesAfterBpUpdate[2].basisPoints), 800)

    // Should revert if update would exceed 30% (3000 bps)
    await expect(strategy.updateFee(0, accounts[4], 1201)).to.be.revertedWithCustomError(
      strategy,
      'FeesTooLarge'
    )

    // Update to 0 basisPoints should remove the fee
    await strategy.updateFee(0, accounts[4], 0)

    const feesAfterRemove = await strategy.getFees()
    assert.equal(feesAfterRemove.length, 2)
    // Last fee (index 2) should have moved to index 0
    assert.equal(feesAfterRemove[0].receiver, accounts[3])
    assert.equal(Number(feesAfterRemove[0].basisPoints), 800)
    assert.equal(feesAfterRemove[1].receiver, accounts[5])
    assert.equal(Number(feesAfterRemove[1].basisPoints), 1000)

    // Total fees now = 800 + 1000 = 1800
    // Can update to higher value within limit
    await strategy.updateFee(0, accounts[3], 1200)

    assert.equal(Number((await strategy.getFees())[0].basisPoints), 1200)

    // Remove last fee by updating to 0
    await strategy.updateFee(1, accounts[5], 0)

    const feesAfterRemoveLast = await strategy.getFees()
    assert.equal(feesAfterRemoveLast.length, 1)
    assert.equal(feesAfterRemoveLast[0].receiver, accounts[3])

    // Remove the only remaining fee
    await strategy.updateFee(0, accounts[3], 0)

    assert.equal((await strategy.getFees()).length, 0)
  })

  it('removeFee should work correctly', async () => {
    const { signers, accounts, strategy } = await loadFixture(deployFixture)

    // Add some fees first
    await strategy.addFee(accounts[1], 500)
    await strategy.addFee(accounts[2], 1000)
    await strategy.addFee(accounts[3], 750)

    // Verify initial state
    let fees = await strategy.getFees()
    assert.equal(fees.length, 3)

    // Should revert if caller is not owner
    await expect(strategy.connect(signers[1]).updateFee(0, accounts[1], 0)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )

    // Remove fee at index 0 by setting basisPoints to 0
    await strategy.updateFee(0, accounts[1], 0)

    // Last fee should have moved to index 0
    fees = await strategy.getFees()
    assert.equal(fees.length, 2)
    assert.equal(fees[0].receiver, accounts[3])
    assert.equal(Number(fees[0].basisPoints), 750)
    assert.equal(fees[1].receiver, accounts[2])
    assert.equal(Number(fees[1].basisPoints), 1000)

    // Remove fee at index 1 (last element)
    await strategy.updateFee(1, accounts[2], 0)

    fees = await strategy.getFees()
    assert.equal(fees.length, 1)
    assert.equal(fees[0].receiver, accounts[3])
    assert.equal(Number(fees[0].basisPoints), 750)

    // Remove the last remaining fee
    await strategy.updateFee(0, accounts[3], 0)

    fees = await strategy.getFees()
    assert.equal(fees.length, 0)

    // Can add fees again after removing all
    await strategy.addFee(accounts[4], 2000)

    fees = await strategy.getFees()
    assert.equal(fees.length, 1)
    assert.equal(fees[0].receiver, accounts[4])
    assert.equal(Number(fees[0].basisPoints), 2000)
  })

  it('setVaultImplementation should work correctly', async () => {
    const { signers, accounts, strategy } = await loadFixture(deployFixture)

    // Get initial vault implementation
    const initialImpl = await strategy.vaultImplementation()

    // Should revert if caller is not owner
    await expect(
      strategy.connect(signers[1]).setVaultImplementation(accounts[5])
    ).to.be.revertedWith('Ownable: caller is not the owner')

    // Should revert if address is zero
    await expect(strategy.setVaultImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      strategy,
      'InvalidAddress'
    )

    // Set new vault implementation
    await strategy.setVaultImplementation(accounts[4])

    // Verify the implementation was updated
    assert.equal(await strategy.vaultImplementation(), accounts[4])
    assert.notEqual(await strategy.vaultImplementation(), initialImpl)

    // Can set to another address
    await strategy.setVaultImplementation(accounts[5])

    assert.equal(await strategy.vaultImplementation(), accounts[5])
  })

  it('setFundFlowController should work correctly', async () => {
    const { signers, accounts, strategy } = await loadFixture(deployFixture)

    // Initially fundFlowController should be account 0
    assert.equal(await strategy.fundFlowController(), '0x11187eff852069a33d102476b2E8A9cc9167dAde')

    // Should revert if caller is not owner
    await expect(
      strategy.connect(signers[1]).setFundFlowController(accounts[5])
    ).to.be.revertedWith('Ownable: caller is not the owner')

    // Should revert if address is zero
    await expect(strategy.setFundFlowController(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      strategy,
      'InvalidAddress'
    )

    // Set fund flow controller
    await strategy.setFundFlowController(accounts[5])
    assert.equal(await strategy.fundFlowController(), accounts[5])

    // Can update to a different address
    await strategy.setFundFlowController(accounts[6])
    assert.equal(await strategy.fundFlowController(), accounts[6])
  })

  it('setRewardsOracle should work correctly', async () => {
    const { signers, accounts, strategy } = await loadFixture(deployFixture)

    // Initially rewardsOracle should be zero address
    assert.equal(await strategy.rewardsOracle(), '0x11187eff852069a33d102476b2E8A9cc9167dAde')

    // Should revert if caller is not owner
    await expect(strategy.connect(signers[1]).setRewardsOracle(accounts[5])).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )

    // Should revert if address is zero
    await expect(strategy.setRewardsOracle(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      strategy,
      'InvalidAddress'
    )

    // Set rewards oracle
    await strategy.setRewardsOracle(accounts[5])
    assert.equal(await strategy.rewardsOracle(), accounts[5])

    // Can update to a different address
    await strategy.setRewardsOracle(accounts[6])
    assert.equal(await strategy.rewardsOracle(), accounts[6])
  })

  it('setMaxRewardChangeBPS should work correctly', async () => {
    const { signers, strategy } = await loadFixture(deployFixture)

    // Initially should be 10000 (100%) from fixture
    assert.equal(Number(await strategy.maxRewardChangeBPS()), 10000)

    // Should revert if caller is not owner
    await expect(strategy.connect(signers[1]).setMaxRewardChangeBPS(500)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )

    // Set to 10% (1000 basis points)
    await strategy.setMaxRewardChangeBPS(1000)
    assert.equal(Number(await strategy.maxRewardChangeBPS()), 1000)

    // Can update to a different value
    await strategy.setMaxRewardChangeBPS(500)
    assert.equal(Number(await strategy.maxRewardChangeBPS()), 500)
  })
})
