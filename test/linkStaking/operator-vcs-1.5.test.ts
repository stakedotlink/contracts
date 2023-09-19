import { ethers } from 'hardhat'
import { assert } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import { ERC677, StakingPool, StakingMockV1, OperatorVCSUpgrade } from '../../typechain-types'

describe('OperatorVCSUpgrade', () => {
  let token: ERC677
  let staking: StakingMockV1
  let strategy: OperatorVCSUpgrade
  let stakingPool: StakingPool
  let vaults: string[]
  let accounts: string[]

  const encode = (data: any) => ethers.utils.defaultAbiCoder.encode(['uint'], [data])

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

    staking = (await deploy('StakingMockV1', [token.address])) as StakingMockV1
    let vaultImplementation = await deployImplementation('OperatorVaultV1')

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'Staked LINK',
      'stLINK',
      [],
    ])) as StakingPool

    strategy = (await deployUpgradeable('OperatorVCSUpgrade', [
      token.address,
      stakingPool.address,
      staking.address,
      vaultImplementation,
      toEther(1000),
      [[accounts[4], 500]],
      [],
    ])) as OperatorVCSUpgrade

    await stakingPool.addStrategy(strategy.address)
    await stakingPool.setPriorityPool(accounts[0])

    for (let i = 0; i < 10; i++) {
      await strategy.addVault(accounts[0])
    }

    vaults = await strategy.getVaults()

    await token.approve(stakingPool.address, ethers.constants.MaxUint256)
  })

  it('should be able to add vault', async () => {
    await strategy.addVault(accounts[1])
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
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getMinDeposits()), 51200)

    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await strategy.getMinDeposits()), 51200)
    await stakingPool.updateStrategyRewards([0], '0x')
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
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500200)

    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500200)
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500250)
  })

  it('getStrategyRewards should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(55000))
    await strategy.depositBufferedTokens(0)

    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [0, 0]
    )

    await staking.setBaseReward(toEther(10))
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [100, 5]
    )

    await staking.setDelegationReward(toEther(5))
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [150, 7.5]
    )

    await token.transfer(strategy.address, toEther(50))
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [200, 10]
    )
  })

  it('getStrategyRewards should work correctly with slashing', async () => {
    await stakingPool.deposit(accounts[0], toEther(55000))
    await strategy.depositBufferedTokens(0)
    await staking.setBaseReward(toEther(10))
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [100, 5]
    )

    await staking.setBaseReward(toEther(5))
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [50, 2.5]
    )

    await stakingPool.updateStrategyRewards([0], '0x')
    await staking.setBaseReward(toEther(0))
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [-50, 0]
    )
  })

  it('updateStrategyRewards should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(400))
    await strategy.depositBufferedTokens(0)

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await stakingPool.totalStaked()), 400)
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [0, 0]
    )

    await staking.setBaseReward(toEther(10))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await stakingPool.totalStaked()), 500)
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [0, 0]
    )
    await staking.setDelegationReward(toEther(5))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await stakingPool.totalStaked()), 550)
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [0, 0]
    )
    await token.transfer(strategy.address, toEther(20))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 570)
    assert.equal(fromEther(await stakingPool.totalStaked()), 570)
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [0, 0]
    )
  })

  it('updateStrategyRewards should work correctly with slashing', async () => {
    await stakingPool.deposit(accounts[0], toEther(400))
    await strategy.depositBufferedTokens(0)
    await staking.setBaseReward(toEther(10))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await stakingPool.totalStaked()), 500)
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [0, 0]
    )
    await staking.setBaseReward(toEther(5))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 450)
    assert.equal(fromEther(await stakingPool.totalStaked()), 450)
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [0, 0]
    )
    await staking.setBaseReward(toEther(0))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await stakingPool.totalStaked()), 400)
    assert.deepEqual(
      (await stakingPool.getStrategyRewards([0])).map((v) => fromEther(v)),
      [0, 0]
    )
  })

  it('fees should be properly calculated in updateStrategyRewards', async () => {
    await stakingPool.deposit(accounts[0], toEther(400))
    await strategy.depositBufferedTokens(0)

    await staking.setBaseReward(toEther(10))
    await strategy.addFee(accounts[3], 1000)
    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 5)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[3])), 10)

    await staking.setBaseReward(toEther(0))
    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 4)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[3])), 8)
  })
})
