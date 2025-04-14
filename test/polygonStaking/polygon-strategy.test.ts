import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import {
  ERC20,
  PolygonStakeManagerMock,
  PolygonStrategy,
  PolygonValidatorShareMock,
  StakingPool,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
import { Interface } from 'ethers'

const withdrawalDelay = 86400

describe('PolygonStrategy', () => {
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

    const validatorShare2 = (await deploy('PolygonValidatorShareMock', [
      stakeManager.target,
    ])) as PolygonValidatorShareMock

    const validatorShare3 = (await deploy('PolygonValidatorShareMock', [
      stakeManager.target,
    ])) as PolygonValidatorShareMock

    const stakingPool = (await deployUpgradeable('StakingPool', [
      token.target,
      'Staking Polygon',
      'stPOL',
      [],
      0,
    ])) as StakingPool

    const vaultImp = await deployImplementation('PolygonVault')

    const strategy = (await deployUpgradeable('PolygonStrategy', [
      token.target,
      stakingPool.target,
      stakeManager.target,
      vaultImp,
      2500,
      [],
    ])) as PolygonStrategy

    const wsdToken = await deploy('WrappedSDToken', [stakingPool.target, 'Wrapped stPOL', 'wstPOL'])

    const mevRewardsPool = await deploy('RewardsPoolWSD', [
      strategy.target,
      stakingPool.target,
      wsdToken.target,
    ])

    await stakingPool.addStrategy(strategy.target)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])
    await strategy.setValidatorMEVRewardsPool(mevRewardsPool.target)
    await strategy.setFundFlowController(accounts[0])

    await strategy.addValidator(validatorShare.target, accounts[1])
    await strategy.addValidator(validatorShare2.target, accounts[2])
    await strategy.addValidator(validatorShare3.target, accounts[3])

    await token.approve(stakingPool.target, ethers.MaxUint256)
    await token.approve(stakeManager.target, ethers.MaxUint256)

    let vaultAddresses: any = await strategy.getVaults()
    let vaults = []
    for (let i = 0; i < vaultAddresses.length; i++) {
      vaults.push(await ethers.getContractAt('PolygonVault', vaultAddresses[i]))
    }

    return {
      accounts,
      token,
      stakeManager,
      validatorShare,
      strategy,
      validatorShare2,
      validatorShare3,
      stakingPool,
      vaults,
      mevRewardsPool,
    }
  }

  it('addValidator should work correctly', async () => {
    const { strategy, stakeManager, validatorShare, accounts, validatorShare2, validatorShare3 } =
      await loadFixture(deployFixture)

    assert.equal(await strategy.totalStaked(), 3n)
    assert.equal(await strategy.staked(accounts[1]), 1n)
    assert.equal(await strategy.staked(accounts[2]), 1n)
    assert.equal(await strategy.staked(accounts[3]), 1n)

    await expect(strategy.addValidator(validatorShare, accounts[5])).to.be.revertedWithCustomError(
      strategy,
      'ValidatorAlreadyAdded()'
    )

    const validatorShare4 = (await deploy('PolygonValidatorShareMock', [
      stakeManager.target,
    ])) as PolygonValidatorShareMock
    await strategy.addValidator(validatorShare4.target, accounts[4])

    assert.equal(await strategy.totalStaked(), 4n)
    assert.equal(await strategy.staked(accounts[1]), 1n)
    assert.equal(await strategy.staked(accounts[2]), 1n)
    assert.equal(await strategy.staked(accounts[3]), 1n)
    assert.equal(await strategy.staked(accounts[4]), 1n)

    assert.deepEqual(await strategy.getValidators(), [
      [validatorShare.target, accounts[1]],
      [validatorShare2.target, accounts[2]],
      [validatorShare3.target, accounts[3]],
      [validatorShare4.target, accounts[4]],
    ])

    let vaults = await strategy.getVaults()
    assert.equal(vaults.length, 4)

    let map: any = {}
    for (let i = 0; i < 4; i++) {
      let vault = vaults[i]
      assert.isTrue(!map[vault])
      assert.equal(await (await ethers.getContractAt('PolygonVault', vault)).getTotalDeposits(), 0n)
      map[vault] = true
    }
  })

  it('deposit should work correctly', async () => {
    const { stakingPool, token, accounts, strategy } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[1], toEther(100), ['0x'])
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 100)
    assert.equal(fromEther(await strategy.totalQueued()), 100)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 100)

    await stakingPool.deposit(accounts[1], toEther(50), ['0x'])
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 150)
    assert.equal(fromEther(await strategy.totalQueued()), 150)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 150)
  })

  it('withdraw should work correctly', async () => {
    const { stakingPool, token, accounts, strategy } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[1], toEther(100), ['0x'])
    await stakingPool.withdraw(accounts[1], accounts[1], toEther(30), ['0x'])
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 10030)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 70)
    assert.equal(fromEther(await strategy.totalQueued()), 70)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 70)
  })

  it('depositQueuedTokens should work correctly', async () => {
    const { stakingPool, token, accounts, strategy, vaults, stakeManager, validatorShare } =
      await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])

    await expect(
      strategy.depositQueuedTokens([0, 2], [toEther(0), toEther(30)])
    ).to.be.revertedWithCustomError(strategy, 'InvalidAmount()')

    await strategy.depositQueuedTokens([0, 2], [toEther(10), toEther(30)])

    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 40)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 960)
    assert.equal(fromEther(await strategy.totalQueued()), 960)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 10)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 0)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 30)

    await strategy.depositQueuedTokens([0, 1, 2], [toEther(10), toEther(20), toEther(30)])

    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 100)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 900)
    assert.equal(fromEther(await strategy.totalQueued()), 900)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 20)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 20)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 60)

    await strategy.queueValidatorRemoval(2)
    await expect(
      strategy.depositQueuedTokens([1, 2], [toEther(10), toEther(10)])
    ).to.be.revertedWithCustomError(strategy, 'InvalidVaultIds()')

    await strategy.unbond(toEther(10))

    await expect(strategy.depositQueuedTokens([1], [toEther(10)])).to.be.revertedWithCustomError(
      strategy,
      'UnbondingInProgress()'
    )

    await time.increase(withdrawalDelay)
    await strategy.unstakeClaim([0])

    await validatorShare.addReward(vaults[0].target, toEther(35))
    await strategy.depositQueuedTokens([0], [toEther(5)])

    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 95)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 940)
    assert.equal(fromEther(await strategy.totalQueued()), 940)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 15)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 20)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 0)
  })

  it('unbond should work correctly', async () => {
    const {
      stakingPool,
      token,
      accounts,
      strategy,
      vaults,
      stakeManager,
      validatorShare2,
      validatorShare3,
    } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(10), toEther(20), toEther(30)])

    await expect(strategy.unbond(toEther(0))).to.be.revertedWithCustomError(
      strategy,
      'InvalidAmount()'
    )

    await strategy.unbond(toEther(5))

    await expect(strategy.unbond(toEther(5))).to.be.revertedWithCustomError(
      strategy,
      'UnbondingInProgress()'
    )

    assert.equal(await strategy.validatorWithdrawalIndex(), 1n)
    assert.equal(await strategy.numVaultsUnbonding(), 1n)
    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 60)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 940)
    assert.equal(fromEther(await strategy.totalQueued()), 940)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 5)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 0)

    assert.equal(await vaults[0].isUnbonding(), true)
    assert.equal(await vaults[1].isUnbonding(), false)
    assert.equal(await vaults[2].isUnbonding(), false)

    await time.increase(withdrawalDelay)
    await strategy.unstakeClaim([0])
    await validatorShare2.addReward(vaults[1].target, toEther(20))
    await validatorShare3.addReward(vaults[2].target, toEther(30))
    await strategy.unbond(toEther(50))

    assert.equal(await strategy.validatorWithdrawalIndex(), 0n)
    assert.equal(await strategy.numVaultsUnbonding(), 1n)
    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 55)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 995)
    assert.equal(fromEther(await strategy.totalQueued()), 995)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 20)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 0)

    assert.equal(await vaults[0].isUnbonding(), false)
    assert.equal(await vaults[1].isUnbonding(), true)
    assert.equal(await vaults[2].isUnbonding(), false)

    await time.increase(withdrawalDelay)
    await strategy.unstakeClaim([1])
    await strategy.queueValidatorRemoval(0)
    await strategy.unbond(toEther(10))

    assert.equal(await strategy.validatorWithdrawalIndex(), 0n)
    assert.equal(await strategy.numVaultsUnbonding(), 1n)
    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 35)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 1015)
    assert.equal(fromEther(await strategy.totalQueued()), 1015)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 5)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 10)

    assert.equal(await vaults[0].isUnbonding(), true)
    assert.equal(await vaults[1].isUnbonding(), false)
    assert.equal(await vaults[2].isUnbonding(), true)
  })

  it('unstakeClaim should work correctly', async () => {
    const { stakingPool, token, accounts, strategy, vaults, stakeManager } = await loadFixture(
      deployFixture
    )

    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(10), toEther(20), toEther(30)])

    await expect(strategy.unstakeClaim([1])).to.be.revertedWithCustomError(
      strategy,
      'NoVaultsUnbonding()'
    )

    await strategy.unbond(toEther(15))
    await time.increase(withdrawalDelay)

    await expect(strategy.unstakeClaim([1])).to.be.revertedWithCustomError(
      strategy,
      'MustWithdrawAllVaults()'
    )

    await strategy.unstakeClaim([0, 1])

    assert.equal(await strategy.validatorWithdrawalIndex(), 2n)
    assert.equal(await strategy.numVaultsUnbonding(), 0n)
    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 45)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 955)
    assert.equal(fromEther(await strategy.totalQueued()), 955)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 0)
    assert.equal(fromEther(await vaults[1].getTotalDeposits()), 15)
    assert.equal(fromEther(await vaults[2].getTotalDeposits()), 30)
    assert.equal(await vaults[0].isWithdrawable(), false)
    assert.equal(await vaults[1].isWithdrawable(), false)
    assert.equal(await vaults[2].isWithdrawable(), false)

    await strategy.unbond(toEther(20))
    await strategy.queueValidatorRemoval(1)
    await time.increase(withdrawalDelay)

    await expect(strategy.unstakeClaim([1, 2])).to.be.revertedWithCustomError(
      strategy,
      'InvalidVaultIds()'
    )

    await strategy.unstakeClaim([2])

    assert.equal(await strategy.validatorWithdrawalIndex(), 0n)
    assert.equal(await strategy.numVaultsUnbonding(), 0n)
    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 25)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 975)
    assert.equal(fromEther(await strategy.totalQueued()), 975)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await vaults[0].getTotalDeposits()), 0)
    assert.equal(fromEther(await vaults[1].getTotalDeposits()), 15)
    assert.equal(fromEther(await vaults[2].getTotalDeposits()), 10)
    assert.equal(await vaults[0].isWithdrawable(), false)
    assert.equal(await vaults[1].isWithdrawable(), true)
    assert.equal(await vaults[2].isWithdrawable(), false)
  })

  it('depositChange should work correctly', async () => {
    const {
      strategy,
      token,
      vaults,
      accounts,
      stakingPool,
      validatorShare,
      validatorShare2,
      validatorShare3,
    } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(10), toEther(20), toEther(30)])
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await validatorShare.addReward(vaults[0].target, toEther(100))
    assert.equal(fromEther(await strategy.getDepositChange()), 100)

    await validatorShare2.addReward(vaults[1].target, toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 150)

    await validatorShare3.addReward(vaults[2].target, toEther(20))
    assert.equal(fromEther(await strategy.getDepositChange()), 170)

    await token.transfer(strategy.target, toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 220)

    await stakingPool.updateStrategyRewards([0], '0x')
    await validatorShare.removeReward(vaults[0], toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), -50)
  })

  it('updateDeposits should work correctly', async () => {
    const { strategy, token, vaults, accounts, stakingPool, validatorShare, validatorShare2 } =
      await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(10), toEther(20), toEther(30)])

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await strategy.totalQueued()), 940)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await validatorShare.addReward(vaults[0].target, toEther(10))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1010)
    assert.equal(fromEther(await strategy.totalQueued()), 940)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await validatorShare2.addReward(vaults[1].target, toEther(5))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1015)
    assert.equal(fromEther(await strategy.totalQueued()), 940)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await token.transfer(strategy.target, toEther(20))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1035)
    assert.equal(fromEther(await strategy.totalQueued()), 960)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await validatorShare2.removeReward(vaults[1].target, toEther(3))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1032)
    assert.equal(fromEther(await strategy.totalQueued()), 960)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
  })

  it('fees should be properly calculated in updateDeposits', async () => {
    const { strategy, token, vaults, accounts, stakingPool, validatorShare, mevRewardsPool } =
      await loadFixture(deployFixture)
    const impStakingPool = await ethers.getImpersonatedSigner(stakingPool.target.toString())

    await strategy.addFee(accounts[5], 100)
    await strategy.addFee(accounts[6], 400)

    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(10), toEther(20), toEther(30)])

    await validatorShare.addReward(vaults[0].target, toEther(100))
    let data = await strategy.connect(impStakingPool).updateDeposits.staticCall('0x')

    assert.equal(fromEther(data.depositChange), 100)
    assert.deepEqual(data.receivers, [accounts[5], accounts[6]])
    assert.deepEqual(
      data.amounts.map((v) => fromEther(v)),
      [1, 4]
    )

    await token.transfer(strategy.target, toEther(100))
    data = await strategy.connect(impStakingPool).updateDeposits.staticCall('0x')

    assert.equal(fromEther(data.depositChange), 200)
    assert.deepEqual(data.receivers, [accounts[5], accounts[6], mevRewardsPool.target])
    assert.deepEqual(
      data.amounts.map((v) => fromEther(v)),
      [2, 8, 25]
    )

    await stakingPool.updateStrategyRewards([0], '0x')
    await validatorShare.removeReward(vaults[0].target, toEther(50))
    data = await strategy.connect(impStakingPool).updateDeposits.staticCall('0x')

    assert.equal(fromEther(data.depositChange), -50)
    assert.deepEqual(data.receivers, [])
    assert.deepEqual(data.amounts, [])
  })

  it('restakeRewards should work correctly', async () => {
    const {
      strategy,
      vaults,
      accounts,
      stakingPool,
      validatorShare,
      validatorShare2,
      validatorShare3,
    } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(10), toEther(20), toEther(30)])

    await validatorShare.addReward(vaults[0].target, toEther(20))
    await validatorShare2.addReward(vaults[1].target, toEther(30))
    await validatorShare3.addReward(vaults[2].target, toEther(40))

    await strategy.restakeRewards([0, 2])

    assert.equal(fromEther(await vaults[0].getPrincipalDeposits()), 30)
    assert.equal(fromEther(await vaults[1].getPrincipalDeposits()), 20)
    assert.equal(fromEther(await vaults[2].getPrincipalDeposits()), 70)
  })

  it('getMinDeposits should work correctly', async () => {
    const { strategy, vaults, accounts, stakingPool, validatorShare } = await loadFixture(
      deployFixture
    )

    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])

    assert.equal(fromEther(await strategy.getMinDeposits()), 0)

    await strategy.depositQueuedTokens([0, 1, 2], [toEther(10), toEther(20), toEther(30)])

    assert.equal(fromEther(await strategy.getMinDeposits()), 60)

    await validatorShare.addReward(vaults[0].target, toEther(50))

    assert.equal(fromEther(await strategy.getMinDeposits()), 60)

    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(fromEther(await strategy.getMinDeposits()), 110)
  })

  it('getMaxDeposits should work correctly', async () => {
    const { strategy } = await loadFixture(deployFixture)

    assert.equal(await strategy.getMaxDeposits(), ethers.MaxUint256)
  })

  it('queueValidatorRemoval should work correctly', async () => {
    const { strategy, vaults, accounts, stakingPool, validatorShare, token } = await loadFixture(
      deployFixture
    )

    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(10), toEther(20), toEther(30)])

    await validatorShare.addReward(vaults[0].target, toEther(15))

    await strategy.unbond(toEther(20))
    await strategy.queueValidatorRemoval(0)

    await expect(strategy.queueValidatorRemoval(1)).to.be.revertedWithCustomError(
      strategy,
      'RemovalAlreadyQueued()'
    )
    assert.deepEqual(await strategy.validatorRemoval(), [true, 0n, toEther(10)])
    assert.equal(await strategy.totalStaked(), 2n)
    assert.equal(await strategy.staked(accounts[1]), 0n)
    assert.equal(await strategy.staked(accounts[2]), 1n)
    assert.equal(await strategy.staked(accounts[3]), 1n)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await strategy.totalQueued()), 955)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 10)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 0)
    assert.equal(await vaults[0].isUnbonding(), true)
    assert.equal(await vaults[1].isUnbonding(), false)
    assert.equal(await vaults[2].isUnbonding(), false)

    await time.increase(withdrawalDelay)
    await strategy.finalizeValidatorRemoval()

    await strategy.unbond(toEther(20))
    await time.increase(withdrawalDelay)
    await strategy.unstakeClaim([0])
    await token.transfer(vaults[1].target, toEther(100))
    await strategy.queueValidatorRemoval(0)

    assert.deepEqual(await strategy.validatorRemoval(), [true, 0n, toEther(0)])
    assert.equal(await strategy.totalStaked(), 1n)
    assert.equal(await strategy.staked(accounts[1]), 0n)
    assert.equal(await strategy.staked(accounts[2]), 0n)
    assert.equal(await strategy.staked(accounts[3]), 1n)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await strategy.totalQueued()), 985)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 0)
    assert.equal(await vaults[0].isUnbonding(), false)
    assert.equal(await vaults[1].isUnbonding(), false)
    assert.equal(await vaults[2].isUnbonding(), false)
  })

  it('finalizeValidatorRemoval should work correctly', async () => {
    const {
      strategy,
      vaults,
      accounts,
      stakingPool,
      validatorShare,
      validatorShare2,
      validatorShare3,
      token,
      stakeManager,
    } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[1], toEther(1000), ['0x'])
    await strategy.depositQueuedTokens([0, 1, 2], [toEther(10), toEther(20), toEther(30)])

    await validatorShare.addReward(vaults[0].target, toEther(15))

    await expect(strategy.finalizeValidatorRemoval()).to.be.revertedWithCustomError(
      strategy,
      'NoRemovalQueued()'
    )

    await strategy.unbond(toEther(20))
    await strategy.queueValidatorRemoval(0)
    await time.increase(withdrawalDelay)
    await strategy.finalizeValidatorRemoval()

    assert.deepEqual(await strategy.validatorRemoval(), [false, 0n, 0n])
    assert.deepEqual(await strategy.getValidators(), [
      [validatorShare2.target.toString(), accounts[2]],
      [validatorShare3.target.toString(), accounts[3]],
    ])
    assert.equal(await strategy.validatorWithdrawalIndex(), 0n)
    assert.deepEqual(await strategy.getVaults(), [vaults[1].target, vaults[2].target])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await strategy.totalQueued()), 965)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 965)
    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 50)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 0)
    assert.equal(await vaults[0].isUnbonding(), false)
    assert.equal(await vaults[1].isUnbonding(), false)
    assert.equal(await vaults[2].isUnbonding(), false)
    assert.equal(await vaults[0].isWithdrawable(), false)
    assert.equal(await vaults[1].isWithdrawable(), false)
    assert.equal(await vaults[2].isWithdrawable(), false)

    await strategy.unbond(toEther(25))
    await time.increase(withdrawalDelay)
    await strategy.unstakeClaim([0, 1])
    await strategy.queueValidatorRemoval(0)
    await token.transfer(vaults[1].target, toEther(100))
    await time.increase(withdrawalDelay)
    await strategy.finalizeValidatorRemoval()

    assert.deepEqual(await strategy.validatorRemoval(), [false, 0n, 0n])
    assert.deepEqual(await strategy.getValidators(), [
      [validatorShare3.target.toString(), accounts[3]],
    ])
    assert.equal(await strategy.validatorWithdrawalIndex(), 0n)
    assert.deepEqual(await strategy.getVaults(), [vaults[2].target])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await strategy.totalQueued()), 990)
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 990)
    assert.equal(fromEther(await token.balanceOf(stakeManager.target)), 25)
    assert.equal(fromEther(await vaults[0].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[1].getQueuedWithdrawals()), 0)
    assert.equal(fromEther(await vaults[2].getQueuedWithdrawals()), 0)
    assert.equal(await vaults[0].isUnbonding(), false)
    assert.equal(await vaults[1].isUnbonding(), false)
    assert.equal(await vaults[2].isUnbonding(), false)
    assert.equal(await vaults[0].isWithdrawable(), false)
    assert.equal(await vaults[1].isWithdrawable(), false)
    assert.equal(await vaults[2].isWithdrawable(), false)
  })

  it('upgradeVaults should work correctly', async () => {
    const { strategy, vaults } = await loadFixture(deployFixture)

    let vaultInterface = (await ethers.getContractFactory('PolygonVaultV2Mock'))
      .interface as Interface

    let newVaultImplementation = (await deployImplementation('PolygonVaultV2Mock')) as string
    await strategy.setVaultImplementation(newVaultImplementation)

    await strategy.upgradeVaults([
      '0x',
      '0x',
      vaultInterface.encodeFunctionData('initializeV2', [1]),
    ])
    for (let i = 0; i < 1; i++) {
      let vault = await ethers.getContractAt('PolygonVaultV2Mock', vaults[i].target)
      assert.equal(await vault.version(), 0n)
    }

    assert.equal(
      await (await ethers.getContractAt('PolygonVaultV2Mock', vaults[2].target)).version(),
      1n
    )
  })
})
