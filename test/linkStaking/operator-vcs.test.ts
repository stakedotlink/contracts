import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import { ERC677, OperatorVCS, OperatorVault, StakingMock, StakingPool } from '../../typechain-types'
import { Signer } from 'ethers'

const encode = (data: any) => ethers.utils.defaultAbiCoder.encode(['uint'], [data])

describe('OperatorVCS', () => {
  let token: ERC677
  let staking: StakingMock
  let strategy: OperatorVCS
  let stakingPool: StakingPool
  let vaults: string[]
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

    staking = (await deploy('StakingMock', [token.address])) as StakingMock
    let vaultImplementation = await deployImplementation('OperatorVault')

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'Staked LINK',
      'stLINK',
      [],
    ])) as StakingPool

    strategy = (await deployUpgradeable('OperatorVCS', [
      token.address,
      stakingPool.address,
      staking.address,
      vaultImplementation,
      toEther(1000),
      [[accounts[4], 500]],
      1000,
    ])) as OperatorVCS

    await stakingPool.addStrategy(strategy.address)
    await stakingPool.setStakingQueue(accounts[0])

    for (let i = 0; i < 10; i++) {
      await strategy.addVault(accounts[0], accounts[1])
    }

    vaults = await strategy.getVaults()

    await token.approve(stakingPool.address, ethers.constants.MaxUint256)
  })

  it('should be able to add vault', async () => {
    await strategy.addVault(accounts[1], accounts[2])
    let vault = await ethers.getContractAt('OperatorVault', (await strategy.getVaults())[10])
    assert.equal(await vault.token(), token.address)
    assert.equal(await vault.stakeController(), staking.address)
    assert.equal(await vault.vaultController(), strategy.address)
    assert.equal(await vault.operator(), accounts[1])
  })

  it('should be able to get vault deposit limits', async () => {
    assert.deepEqual(
      (await strategy.getVaultDepositLimits()).map((v) => fromEther(v)),
      [10, 50000]
    )
  })

  it('depositBufferedTokens should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(1000))
    await strategy.performUpkeep(encode(0))
    assert.equal(fromEther(await staking.getStake(vaults[0])), 1000)

    await stakingPool.deposit(accounts[0], toEther(50000))
    await strategy.performUpkeep(encode(0))
    assert.equal(fromEther(await staking.getStake(vaults[0])), 50000)
    assert.equal(fromEther(await staking.getStake(vaults[1])), 1000)

    await stakingPool.deposit(accounts[0], toEther(99009))
    await strategy.performUpkeep(encode(1))
    assert.equal(fromEther(await staking.getStake(vaults[1])), 50000)
    assert.equal(fromEther(await staking.getStake(vaults[2])), 50000)
    assert.equal(fromEther(await staking.getStake(vaults[3])), 0)

    assert.equal(fromEther(await strategy.getTotalDeposits()), 150009)
  })

  it('getMinDeposits should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(1000))
    token.transfer(strategy.address, toEther(100))
    assert.equal(fromEther(await strategy.getMinDeposits()), 1000)

    await strategy.performUpkeep(encode(0))
    assert.equal(fromEther(await strategy.getMinDeposits()), 1000)

    await stakingPool.deposit(accounts[0], toEther(50000))
    assert.equal(fromEther(await strategy.getMinDeposits()), 51000)

    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await strategy.getMinDeposits()), 51000)

    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getMinDeposits()), 51200)

    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await strategy.getMinDeposits()), 51200)
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getMinDeposits()), 51250)
  })

  it('getMaxDeposits should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(1000))
    token.transfer(strategy.address, toEther(100))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500000)

    await strategy.performUpkeep(encode(0))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500000)

    await stakingPool.deposit(accounts[0], toEther(50000))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500000)

    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500000)
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500200)

    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500200)
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500250)
  })

  it('getPendingFees should work correctly', async () => {
    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await strategy.getPendingFees()), 15)

    await staking.setVaultBaseReward(vaults[1], toEther(20))
    assert.equal(fromEther(await strategy.getPendingFees()), 16.5)

    await token.transfer(strategy.address, toEther(50))
    assert.equal(fromEther(await strategy.getPendingFees()), 19)

    await staking.setBaseReward(toEther(0))
    assert.equal(fromEther(await strategy.getPendingFees()), 5.5)

    await staking.setBaseReward(toEther(5))
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getPendingFees()), 0)

    await staking.setVaultBaseReward(vaults[3], toEther(15))
    await staking.setBaseReward(toEther(0))
    assert.equal(fromEther(await strategy.getPendingFees()), 1)

    await stakingPool.updateStrategyRewards([0])
    await staking.setBaseReward(toEther(5))
    assert.equal(fromEther(await strategy.getPendingFees()), 2)
  })

  it('updateDeposits should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(300))
    await strategy.depositBufferedTokens(0)
    await stakingPool.deposit(accounts[0], toEther(100))

    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)

    await staking.setBaseReward(toEther(10))
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 5)

    await staking.setDelegationReward(toEther(5))
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 15.85)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 7.925)

    let vault = (await ethers.getContractAt('OperatorVault', vaults[0])) as OperatorVault
    await vault.raiseAlert()
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 640)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(strategy.address)).toFixed(2)), 18.31)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 13.66)
  })

  it('updateDeposits should work correctly with slashing', async () => {
    await stakingPool.deposit(accounts[0], toEther(300))
    await strategy.depositBufferedTokens(0)
    await stakingPool.deposit(accounts[0], toEther(100))
    await staking.setBaseReward(toEther(10))
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 5)

    await staking.setBaseReward(toEther(5))
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 450)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 9)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 4.5)

    await staking.setBaseReward(toEther(0))
    await staking.setVaultBaseReward(vaults[1], toEther(15))
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 415)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(strategy.address)).toFixed(2)), 8.79)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 4.14)

    await staking.setBaseReward(toEther(10))
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 505)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(strategy.address)).toFixed(2)), 10.6)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 9.5)
  })

  it('withdrawVaultRewards should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(10))
    await strategy.depositBufferedTokens(0)

    let vault = (await ethers.getContractAt('OperatorVault', vaults[0])) as OperatorVault

    expect(vault.withdrawRewards()).to.be.revertedWith('OnlyRewardsReceiver')

    await staking.setBaseReward(toEther(10))
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    await vault.connect(signers[1]).withdrawRewards()
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0)
    assert.deepEqual(
      (await strategy.getOperatorRewards()).map((v) => fromEther(v)),
      [9, 9]
    )
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 9)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 1)

    vault = (await ethers.getContractAt('OperatorVault', vaults[1])) as OperatorVault

    await staking.setBaseReward(toEther(0))
    await stakingPool.updateStrategyRewards([0])
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    await vault.connect(signers[1]).withdrawRewards()
    assert.equal(Number(fromEther(await vault.getUnclaimedRewards()).toFixed(2)), 0.18)
    assert.deepEqual(
      (await strategy.getOperatorRewards()).map((v) => Number(fromEther(v).toFixed(2))),
      [8.18, 0]
    )
    assert.equal(Number(fromEther(await stakingPool.balanceOf(strategy.address)).toFixed(2)), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[1])).toFixed(2)), 0.91)
  })

  it('setOperatorRewardPercentage should work correctly', async () => {
    await expect(strategy.setOperatorRewardPercentage(10001)).to.be.revertedWith(
      'InvalidPercentage()'
    )
    await stakingPool.deposit(accounts[0], toEther(300))
    await strategy.depositBufferedTokens(0)
    await staking.setBaseReward(toEther(10))
    await strategy.setOperatorRewardPercentage(5000)
    assert.equal((await strategy.operatorRewardPercentage()).toNumber(), 5000)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
  })

  it('setRewardsReceiver should work correctly', async () => {
    await expect(strategy.setRewardsReceiver(1, accounts[4])).to.be.revertedWith(
      'OnlyRewardsReceiver()'
    )

    await strategy.addVault(accounts[0], ethers.constants.AddressZero)
    await strategy.setRewardsReceiver(10, accounts[4])
    let vault = await ethers.getContractAt('OperatorVault', (await strategy.getVaults())[10])
    assert.equal(await vault.rewardsReceiver(), accounts[4])
  })
})
