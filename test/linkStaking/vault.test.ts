import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  getConnection,
} from '../utils/helpers'
import { ERC677, CommunityVault, StakingMock, StakingRewardsMock } from '../../types/ethers-contracts'

const { ethers, loadFixture, networkHelpers } = getConnection()
const time = networkHelpers.time

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

describe('Vault', () => {
  async function deployFixture() {
    const { accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    const rewardsController = (await deploy('StakingRewardsMock', [
      token.target,
    ])) as StakingRewardsMock

    const stakingController = (await deploy('StakingMock', [
      token.target,
      rewardsController.target,
      toEther(10),
      toEther(100),
      toEther(10000),
      unbondingPeriod,
      claimPeriod,
    ])) as StakingMock

    const vault = (await deployUpgradeable('CommunityVault', [
      token.target,
      accounts[0],
      stakingController.target,
      rewardsController.target,
      accounts[0],
    ])) as CommunityVault

    await token.approve(vault.target, ethers.MaxUint256)

    return { accounts, token, rewardsController, stakingController, vault }
  }

  it('should be able to deposit', async () => {
    const { vault, token, stakingController } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(stakingController.target)), 100)
    assert.equal(
      fromEther(await stakingController.getStakerPrincipal(vault.target)),
      100,
      'balance does not match'
    )

    await vault.deposit(toEther(200))
    assert.equal(fromEther(await token.balanceOf(stakingController.target)), 300)
    assert.equal(
      fromEther(await stakingController.getStakerPrincipal(vault.target)),
      300,
      'balance does not match'
    )
  })

  it('should be able to unbond', async () => {
    const { vault, stakingController } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    await vault.unbond()
    let ts: any = (await ethers.provider.getBlock('latest'))?.timestamp
    assert.equal(
      Number(await stakingController.getClaimPeriodEndsAt(vault.target)),
      ts + unbondingPeriod + claimPeriod
    )
  })

  it('should be able to withdraw', async () => {
    const { vault, token, stakingController } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    await vault.unbond()

    await expect(vault.withdraw(toEther(30))).to.be.revertedWithCustomError(
      stakingController,
      'NotInClaimPeriod()'
    )

    await time.increase(unbondingPeriod + 1)

    await vault.withdraw(toEther(30))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 70)
    assert.equal(fromEther(await token.balanceOf(stakingController.target)), 70)
  })

  it('getPrincipalDeposits should work correctly', async () => {
    const { vault } = await loadFixture(deployFixture)

    await vault.deposit(toEther(10))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 10)

    await vault.deposit(toEther(30))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 40)
  })

  it('getRewards should work correctly', async () => {
    const { vault, rewardsController } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    await rewardsController.setReward(vault.target, toEther(10))
    assert.equal(fromEther(await vault.getRewards()), 10)

    await rewardsController.setReward(vault.target, toEther(40))
    assert.equal(fromEther(await vault.getRewards()), 40)
  })

  it('getTotalDeposits should work correctly', async () => {
    const { vault, rewardsController } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))
    await rewardsController.setReward(vault.target, toEther(10))
    assert.equal(fromEther(await vault.getTotalDeposits()), 110)

    await vault.deposit(toEther(150))
    await rewardsController.setReward(vault.target, toEther(40))
    assert.equal(fromEther(await vault.getTotalDeposits()), 290)
  })

  it('claimPeriodActive should work correctly', async () => {
    const { vault } = await loadFixture(deployFixture)

    assert.equal(await vault.claimPeriodActive(), false)

    await vault.deposit(toEther(100))
    assert.equal(await vault.claimPeriodActive(), false)

    await vault.unbond()
    assert.equal(await vault.claimPeriodActive(), false)

    await time.increase(unbondingPeriod + 1)
    assert.equal(await vault.claimPeriodActive(), true)

    await time.increase(claimPeriod)
    assert.equal(await vault.claimPeriodActive(), false)
  })

  it('delegation should work correctly', async () => {
    const { accounts, token, stakingController, rewardsController } = await loadFixture(
      deployFixture
    )

    const delegateRegistry = await deploy('DelegateRegistryMock')
    const strategy = await deployUpgradeable(
      'VCSMock',
      [token.target, accounts[0], stakingController.target, accounts[0], [], 0, accounts[0]],
      { unsafeAllow: ['delegatecall'] }
    )
    await strategy.setFundFlowController(accounts[0])
    const vault = (await deployUpgradeable('CommunityVault', [
      token.target,
      strategy.target,
      stakingController.target,
      rewardsController.target,
      delegateRegistry.target,
    ])) as CommunityVault
    await strategy.addVaults([vault.target])

    await vault.delegate(accounts[1], ethers.encodeBytes32String('1'), true)
    await vault.delegate(accounts[2], ethers.encodeBytes32String('2'), true)

    assert.deepEqual(await vault.getDelegations(), [
      [1n, accounts[1], vault.target, ethers.encodeBytes32String('1'), vault.target, 9n, 100n],
      [1n, accounts[2], vault.target, ethers.encodeBytes32String('2'), vault.target, 9n, 100n],
    ])
  })

  it('withdrawTokenRewards should work correctly', async () => {
    const { accounts, token, stakingController, rewardsController } = await loadFixture(
      deployFixture
    )

    const delegateRegistry = await deploy('DelegateRegistryMock')
    const strategy = await deployUpgradeable(
      'VCSMock',
      [token.target, accounts[0], stakingController.target, accounts[0], [], 0, accounts[0]],
      { unsafeAllow: ['delegatecall'] }
    )
    await strategy.setFundFlowController(accounts[0])
    const vault = (await deployUpgradeable('CommunityVault', [
      token.target,
      strategy.target,
      stakingController.target,
      rewardsController.target,
      delegateRegistry.target,
    ])) as CommunityVault
    await strategy.addVaults([vault.target])

    const token2 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      '',
      '',
      1000000000,
    ])) as ERC677
    const token3 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      '',
      '',
      1000000000,
    ])) as ERC677

    const startingBalance = await token.balanceOf(accounts[0])
    const startingBalance2 = await token2.balanceOf(accounts[0])
    const startingBalance3 = await token3.balanceOf(accounts[0])

    await token.transfer(vault.target, toEther(500))
    await token2.transfer(vault.target, toEther(1000))
    await token3.transfer(vault.target, toEther(2000))

    await vault.withdrawTokenRewards([token.target])

    assert.equal(await token.balanceOf(accounts[0]), startingBalance)
    assert.equal(await token2.balanceOf(accounts[0]), startingBalance2 - toEther(1000))
    assert.equal(await token3.balanceOf(accounts[0]), startingBalance3 - toEther(2000))

    await vault.withdrawTokenRewards([token.target, token2.target, token3.target])

    assert.equal(await token.balanceOf(accounts[0]), startingBalance)
    assert.equal(await token2.balanceOf(accounts[0]), startingBalance2)
    assert.equal(await token3.balanceOf(accounts[0]), startingBalance3)
  })
})
