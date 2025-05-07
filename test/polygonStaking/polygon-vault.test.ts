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
  PolygonStakeManagerMock,
  PolygonValidatorShareMock,
  PolygonVault,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

const withdrawalDelay = 86400

describe('PolygonVault', () => {
  async function deployFixture() {
    const { accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Polygon',
      'POL',
      1000000000,
    ])) as ERC20
    await setupToken(token, accounts)

    const stakeManager = (await deploy('PolygonStakeManagerMock', [
      token.target,
      withdrawalDelay,
    ])) as PolygonStakeManagerMock

    const validatorShare = (await deploy('PolygonValidatorShareMock', [
      stakeManager.target,
    ])) as PolygonValidatorShareMock

    const vault = (await deployUpgradeable('PolygonVault', [
      token.target,
      accounts[0],
      stakeManager.target,
      validatorShare.target,
    ])) as PolygonVault

    await token.approve(vault.target, ethers.MaxUint256)
    await token.approve(stakeManager.target, ethers.MaxUint256)

    return { accounts, token, stakeManager, validatorShare, vault }
  }

  it('deposit should work correctly', async () => {
    const { vault, token, stakeManager, validatorShare } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 100)
    assert.equal(fromEther(await validatorShare.balanceOf(vault.target)), 100)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)

    await vault.deposit(toEther(200))
    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 300)
    assert.equal(fromEther(await validatorShare.balanceOf(vault.target)), 300)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 300)
    assert.equal(fromEther(await vault.getTotalDeposits()), 300)
  })

  it('restakeRewards should work correctly', async () => {
    const { vault, validatorShare } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    await validatorShare.addReward(vault.target, toEther(50))

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vault.getRewards()), 50)
    assert.equal(fromEther(await vault.getTotalDeposits()), 150)

    await vault.restakeRewards()

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 150)
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 150)

    await vault.restakeRewards()
    await vault.restakeRewards()
  })

  it('withdrawRewards should work correctly', async () => {
    const { vault, validatorShare, token, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    await validatorShare.addReward(vault.target, toEther(50))

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vault.getRewards()), 50)
    assert.equal(fromEther(await vault.getTotalDeposits()), 150)

    const preBalance = await token.balanceOf(accounts[0])

    await vault.withdrawRewards()

    assert.equal(fromEther((await token.balanceOf(accounts[0])) - preBalance), 50)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)
  })

  it('unbond should work correctly', async () => {
    const { vault, validatorShare, token, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    await validatorShare.addReward(vault.target, toEther(50))

    assert.equal(await vault.isUnbonding(), false)
    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 0)

    let preBalance = await token.balanceOf(accounts[0])

    await vault.unbond(toEther(30))

    assert.equal(await vault.isUnbonding(), true)
    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 30)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 70)
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)
    assert.equal(fromEther((await token.balanceOf(accounts[0])) - preBalance), 50)

    await time.increase(withdrawalDelay)
    await vault.withdraw()

    await expect(vault.unbond(toEther(71))).to.be.revertedWithCustomError(
      validatorShare,
      'InsufficientBalance()'
    )

    await vault.unbond(toEther(70))

    assert.equal(await vault.isUnbonding(), true)
    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 70)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 70)
    assert.equal(fromEther(await token.balanceOf(vault.target)), 0)
  })

  it('withdraw should work correctly', async () => {
    const { vault, validatorShare, token, accounts } = await loadFixture(deployFixture)

    const preBalance = await token.balanceOf(accounts[0])

    await vault.deposit(toEther(100))
    await validatorShare.addReward(vault.target, toEther(50))
    await vault.unbond(toEther(30))

    assert.equal(await vault.isWithdrawable(), false)
    await expect(vault.withdraw()).to.be.revertedWithCustomError(
      validatorShare,
      'IncompleteWithdrawalPeriod()'
    )

    await time.increase(withdrawalDelay)

    assert.equal(await vault.isUnbonding(), false)
    assert.equal(await vault.isWithdrawable(), true)

    await vault.withdraw()

    assert.equal(await vault.isUnbonding(), false)
    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 70)
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 70)
    assert.equal(fromEther(await token.balanceOf(vault.target)), 0)
    assert.equal(await token.balanceOf(accounts[0]), preBalance - toEther(70))

    await vault.unbond(toEther(70))

    assert.equal(await vault.isWithdrawable(), false)
    await expect(vault.withdraw()).to.be.revertedWithCustomError(
      validatorShare,
      'IncompleteWithdrawalPeriod()'
    )

    await time.increase(withdrawalDelay)

    assert.equal(await vault.isUnbonding(), false)
    assert.equal(await vault.isWithdrawable(), true)

    await vault.withdraw()

    assert.equal(await vault.isUnbonding(), false)
    assert.equal(await vault.isWithdrawable(), false)
    assert.equal(fromEther(await vault.getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await vault.getTotalDeposits()), 0)
    assert.equal(fromEther(await token.balanceOf(vault.target)), 0)
    assert.equal(await token.balanceOf(accounts[0]), preBalance)
  })
})
