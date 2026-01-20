import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import {
  ERC20,
  EspressoStakingMock,
  EspressoRewardsMock,
  EspressoVault,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

const exitEscrowPeriod = 86400 // 1 day

describe('EspressoVault', () => {
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

    const validator = accounts[5]

    // Register the validator
    await espressoStaking.registerValidator(validator)

    const vault = (await deployUpgradeable('EspressoVault', [
      token.target,
      accounts[0], // vaultController
      espressoStaking.target,
      espressoRewards.target,
      validator,
    ])) as EspressoVault

    // Fund the rewards contract
    await token.transfer(espressoRewards.target, toEther(10000))

    await token.approve(vault.target, ethers.MaxUint256)

    return { signers, accounts, token, espressoStaking, espressoRewards, validator, vault }
  }

  it('deposit should work correctly', async () => {
    const { signers, vault, token, espressoStaking, validator } = await loadFixture(deployFixture)

    // Should revert if caller is not vault controller
    await expect(vault.connect(signers[1]).deposit(toEther(100))).to.be.revertedWithCustomError(
      vault,
      'OnlyVaultController'
    )

    await vault.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(espressoStaking.target)), 100)
    assert.equal(fromEther(await espressoStaking.delegations(validator, vault.target)), 100)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)

    await vault.deposit(toEther(200))
    assert.equal(fromEther(await token.balanceOf(espressoStaking.target)), 300)
    assert.equal(fromEther(await espressoStaking.delegations(validator, vault.target)), 300)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 300)
    assert.equal(fromEther(await vault.getTotalDeposits()), 300)
  })

  it('unbond should work correctly', async () => {
    const { signers, vault, espressoStaking, validator } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))

    // Should revert if caller is not vault controller
    await expect(vault.connect(signers[1]).unbond(toEther(30))).to.be.revertedWithCustomError(
      vault,
      'OnlyVaultController'
    )

    assert.equal(await vault.isUnbonding(), false)
    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 0)

    await vault.unbond(toEther(30))

    assert.equal(await vault.isUnbonding(), true)
    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 30)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 70)
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)
    assert.equal(fromEther(await espressoStaking.delegations(validator, vault.target)), 70)
    assert.equal(fromEther((await espressoStaking.undelegations(validator, vault.target))[0]), 30)

    await time.increase(exitEscrowPeriod)
    await vault.withdraw()

    await vault.unbond(toEther(70))

    assert.equal(await vault.isUnbonding(), true)
    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 70)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 70)
    assert.equal(fromEther(await espressoStaking.delegations(validator, vault.target)), 0)
    assert.equal(fromEther((await espressoStaking.undelegations(validator, vault.target))[0]), 70)
  })

  it('withdraw should work correctly', async () => {
    const { signers, vault, token, espressoStaking, validator, accounts } = await loadFixture(
      deployFixture
    )

    const preBalance = await token.balanceOf(accounts[0])

    await vault.deposit(toEther(100))
    await vault.unbond(toEther(30))

    // Should revert if caller is not vault controller
    await expect(vault.connect(signers[1]).withdraw()).to.be.revertedWithCustomError(
      vault,
      'OnlyVaultController'
    )

    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(await vault.isUnbonding(), true)

    await time.increase(exitEscrowPeriod)

    assert.equal(await vault.isUnbonding(), false)
    assert.equal(await vault.isWithdrawable(), true)

    await vault.withdraw()

    assert.equal(await vault.isUnbonding(), false)
    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 70)
    assert.equal(fromEther(await vault.getTotalDeposits()), 70)
    assert.equal(fromEther(await token.balanceOf(accounts[0])), fromEther(preBalance) - 70)
    assert.equal(fromEther(await espressoStaking.delegations(validator, vault.target)), 70)
    assert.equal(fromEther((await espressoStaking.undelegations(validator, vault.target))[0]), 0)

    // Unbond and withdraw remaining
    await vault.unbond(toEther(70))

    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(await vault.isUnbonding(), true)

    await time.increase(exitEscrowPeriod)

    assert.equal(await vault.isUnbonding(), false)
    assert.equal(await vault.isWithdrawable(), true)

    await vault.withdraw()

    assert.equal(await vault.isUnbonding(), false)
    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 0)
    assert.equal(await token.balanceOf(accounts[0]), preBalance)
    assert.equal(fromEther(await espressoStaking.delegations(validator, vault.target)), 0)
    assert.equal(fromEther((await espressoStaking.undelegations(validator, vault.target))[0]), 0)
  })

  it('restakeRewards should work correctly', async () => {
    const { signers, vault, espressoStaking, validator } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)

    // Set up lifetime rewards
    await vault.updateLifetimeRewards(toEther(50))

    // Should revert if caller is not vault controller
    await expect(
      vault.connect(signers[1]).restakeRewards(toEther(50), '0x')
    ).to.be.revertedWithCustomError(vault, 'OnlyVaultController')

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vault.getRewards()), 50)
    assert.equal(fromEther(await vault.getTotalDeposits()), 150)

    // Restake rewards
    await vault.restakeRewards(toEther(50), '0x')

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 150)
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 150)
    assert.equal(fromEther(await espressoStaking.delegations(validator, vault.target)), 150)

    // Calling restakeRewards with no rewards should do nothing
    await vault.restakeRewards(toEther(50), '0x')
    await vault.restakeRewards(toEther(50), '0x')

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 150)

    // Restake with outdated lifetime rewards in vault (new rewards accrued)
    await vault.restakeRewards(toEther(80), '0x')

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 180)
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await espressoStaking.delegations(validator, vault.target)), 180)
  })

  it('withdrawRewards should work correctly', async () => {
    const { signers, vault, token, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))

    // Set up lifetime rewards
    await vault.updateLifetimeRewards(toEther(50))

    // Should revert if caller is not vault controller
    await expect(
      vault.connect(signers[1]).withdrawRewards(toEther(50), '0x')
    ).to.be.revertedWithCustomError(vault, 'OnlyVaultController')

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vault.getRewards()), 50)
    assert.equal(fromEther(await vault.getTotalDeposits()), 150)

    const preBalance = await token.balanceOf(accounts[0])

    await vault.withdrawRewards(toEther(50), '0x')

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)
    assert.equal(fromEther((await token.balanceOf(accounts[0])) - preBalance), 50)

    // Add more rewards and withdraw again
    await vault.updateLifetimeRewards(toEther(80))

    assert.equal(fromEther(await vault.getRewards()), 30)

    const preBalance2 = await token.balanceOf(accounts[0])

    await vault.withdrawRewards(toEther(80), '0x')

    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther((await token.balanceOf(accounts[0])) - preBalance2), 30)

    // Withdraw with outdated lifetime rewards in vault (new rewards accrued)
    const preBalance3 = await token.balanceOf(accounts[0])

    await vault.withdrawRewards(toEther(100), '0x')

    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther((await token.balanceOf(accounts[0])) - preBalance3), 20)
  })

  it('updateLifetimeRewards should work correctly', async () => {
    const { signers, vault } = await loadFixture(deployFixture)

    // Should revert if caller is not vault controller
    await expect(
      vault.connect(signers[1]).updateLifetimeRewards(toEther(100))
    ).to.be.revertedWithCustomError(vault, 'OnlyVaultController')

    assert.equal(fromEther(await vault.getRewards()), 0)

    await vault.updateLifetimeRewards(toEther(100))

    assert.equal(fromEther(await vault.getRewards()), 100)

    await vault.updateLifetimeRewards(toEther(150))

    assert.equal(fromEther(await vault.getRewards()), 150)

    // Setting same value should work
    await vault.updateLifetimeRewards(toEther(150))

    assert.equal(fromEther(await vault.getRewards()), 150)

    // Setting lower value should revert
    await expect(vault.updateLifetimeRewards(toEther(100))).to.be.revertedWithCustomError(
      vault,
      'InvalidLifetimeRewards'
    )
  })

  it('claimValidatorExit should work correctly', async () => {
    const { signers, vault, token, espressoStaking, validator, accounts } = await loadFixture(
      deployFixture
    )

    await vault.deposit(toEther(100))

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    assert.equal(await vault.isActive(), true)

    const preBalance = await token.balanceOf(accounts[0])

    // Exit the validator in the mock
    await espressoStaking.exitValidator(validator)

    // Should revert if caller is not vault controller
    await expect(vault.connect(signers[1]).claimValidatorExit()).to.be.revertedWithCustomError(
      vault,
      'OnlyVaultController'
    )

    assert.equal(await vault.isActive(), false)

    // Claim validator exit
    await vault.claimValidatorExit()

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 0)
    assert.equal(fromEther((await token.balanceOf(accounts[0])) - preBalance), 100)
  })

  it('getTotalDeposits should work correctly', async () => {
    const { vault, token } = await loadFixture(deployFixture)

    // Initially should be 0
    assert.equal(fromEther(await vault.getTotalDeposits()), 0)

    // Deposit tokens
    await vault.deposit(toEther(100))
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)

    // Unbond some tokens (moves from principal to queued)
    await vault.unbond(toEther(30))
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 70)
    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 30)

    // Set up rewards
    await vault.updateLifetimeRewards(toEther(50))
    assert.equal(fromEther(await vault.getTotalDeposits()), 150)
    assert.equal(fromEther(await vault.getRewards()), 50)

    // Transfer tokens directly to vault
    await token.transfer(vault.target, toEther(20))
    assert.equal(fromEther(await vault.getTotalDeposits()), 170)

    // Verify total equals sum of all components
    const principal = fromEther(await vault.getPrincipalDeposits())
    const rewards = fromEther(await vault.getRewards())
    const queued = fromEther(await vault.getQueuedWithdrawals())
    const balance = fromEther(await token.balanceOf(vault.target))

    assert.equal(principal, 70)
    assert.equal(rewards, 50)
    assert.equal(queued, 30)
    assert.equal(balance, 20)
    assert.equal(fromEther(await vault.getTotalDeposits()), principal + rewards + queued + balance)
  })

  it('getPrincipalDeposits should work correctly', async () => {
    const { vault, espressoStaking, validator } = await loadFixture(deployFixture)

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 0)

    await vault.deposit(toEther(100))

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    assert.equal(fromEther(await espressoStaking.delegations(validator, vault.target)), 100)

    await vault.deposit(toEther(50))

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 150)

    await vault.unbond(toEther(30))

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 120)
  })

  it('getRewards should work correctly', async () => {
    const { vault, espressoRewards } = await loadFixture(deployFixture)

    assert.equal(fromEther(await vault.getRewards()), 0)

    await vault.updateLifetimeRewards(toEther(100))

    assert.equal(fromEther(await vault.getRewards()), 100)

    await vault.updateLifetimeRewards(toEther(150))

    assert.equal(fromEther(await vault.getRewards()), 150)

    // Withdraw some rewards
    await vault.withdrawRewards(toEther(150), '0x')

    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await espressoRewards.claimedRewards(vault.target)), 150)

    // Add more rewards
    await vault.updateLifetimeRewards(toEther(200))

    assert.equal(fromEther(await vault.getRewards()), 50)
  })

  it('getQueuedWithdrawals should work correctly', async () => {
    const { vault, espressoStaking, validator } = await loadFixture(deployFixture)

    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 0)

    await vault.deposit(toEther(100))

    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 0)

    await vault.unbond(toEther(30))

    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 30)
    assert.equal(fromEther((await espressoStaking.undelegations(validator, vault.target))[0]), 30)

    await time.increase(exitEscrowPeriod)
    await vault.withdraw()

    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 0)

    await vault.unbond(toEther(70))

    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 70)
  })

  it('isWithdrawable should work correctly', async () => {
    const { vault } = await loadFixture(deployFixture)

    // Initially should be false (no deposits)
    assert.equal(await vault.isWithdrawable(), false)

    // Deposit and unbond
    await vault.deposit(toEther(100))
    assert.equal(await vault.isWithdrawable(), false)

    await vault.unbond(toEther(50))

    // Should be false before escrow period
    assert.equal(await vault.isWithdrawable(), false)

    // Advance time but not past escrow period
    await time.increase(exitEscrowPeriod - 100)
    assert.equal(await vault.isWithdrawable(), false)

    // Advance time past escrow period
    await time.increase(100)
    assert.equal(await vault.isWithdrawable(), true)

    // After withdrawal, should be false again
    await vault.withdraw()
    assert.equal(await vault.isWithdrawable(), false)
  })

  it('isUnbonding should work correctly', async () => {
    const { vault } = await loadFixture(deployFixture)

    // Initially should be false (no deposits)
    assert.equal(await vault.isUnbonding(), false)

    // Deposit tokens
    await vault.deposit(toEther(100))
    assert.equal(await vault.isUnbonding(), false)

    // Unbond tokens
    await vault.unbond(toEther(50))

    // Should be true during escrow period
    assert.equal(await vault.isUnbonding(), true)

    // Advance time but not past escrow period
    await time.increase(exitEscrowPeriod - 100)
    assert.equal(await vault.isUnbonding(), true)

    // Advance time past escrow period
    await time.increase(100)
    assert.equal(await vault.isUnbonding(), false)

    // After withdrawal, should still be false
    await vault.withdraw()
    assert.equal(await vault.isUnbonding(), false)

    // Unbond again to verify cycle
    await vault.unbond(toEther(50))
    assert.equal(await vault.isUnbonding(), true)
  })

  it('isActive should work correctly', async () => {
    const { vault, espressoStaking, validator } = await loadFixture(deployFixture)

    // Should be true for registered validator
    assert.equal(await vault.isActive(), true)

    // Deposit some tokens to have state in the vault
    await vault.deposit(toEther(100))
    assert.equal(await vault.isActive(), true)

    // Exit the validator in mock
    await espressoStaking.exitValidator(validator)

    // Should be false after validator exits
    assert.equal(await vault.isActive(), false)
  })

  it('exitIsWithdrawable should work correctly', async () => {
    const { vault, espressoStaking, validator } = await loadFixture(deployFixture)

    // Should be false when validator is active (no exit scheduled)
    assert.equal(await vault.exitIsWithdrawable(), false)

    // Deposit some tokens
    await vault.deposit(toEther(100))
    assert.equal(await vault.exitIsWithdrawable(), false)

    // Exit the validator
    await espressoStaking.exitValidator(validator)

    // Should be false immediately after exit (escrow period not passed)
    assert.equal(await vault.isActive(), false)
    assert.equal(await vault.exitIsWithdrawable(), false)

    // Advance time but not past escrow period
    await time.increase(exitEscrowPeriod - 100)
    assert.equal(await vault.exitIsWithdrawable(), false)

    // Advance time past escrow period
    await time.increase(100)
    assert.equal(await vault.exitIsWithdrawable(), true)

    // Claim validator exit
    await vault.claimValidatorExit()

    // exitIsWithdrawable should still be true (exit timestamp is still set)
    // but there are no more deposits to claim
    assert.equal(await vault.exitIsWithdrawable(), true)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 0)
  })
})
