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
import type {
  ERC677,
  StrategyMock,
  StakingPool,
  RebaseController,
  PriorityPool,
  SecurityPool,
} from '../../types/ethers-contracts'

const { ethers, loadFixture } = getConnection()

describe('RebaseController', () => {
  const decode = (data: any) => ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], data)
  const encode = (data: any) => ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], data)

  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677

    await setupToken(token, accounts)

    const stakingPool = (await deployUpgradeable('StakingPool', [
      token.target,
      'LinkPool LINK',
      'lpLINK',
      [[accounts[4], 1000]],
      toEther(10000),
    ])) as StakingPool

    const priorityPool = (await deployUpgradeable('PriorityPool', [
      token.target,
      stakingPool.target,
      accounts[0],
      toEther(100),
      toEther(1000),
      false,
    ])) as PriorityPool

    const securityPool = (await deployUpgradeable('SecurityPool', [
      token.target,
      'name',
      'symbol',
      accounts[0],
      3000,
      10,
      100,
    ])) as SecurityPool

    const rebaseController = (await deploy('RebaseController', [
      stakingPool.target,
      priorityPool.target,
      securityPool.target,
      accounts[0],
      accounts[0],
    ])) as RebaseController

    const strategy1 = (await deployUpgradeable('StrategyMock', [
      token.target,
      stakingPool.target,
      toEther(200),
      toEther(10),
    ])) as StrategyMock

    const strategy2 = (await deployUpgradeable('StrategyMock', [
      token.target,
      stakingPool.target,
      toEther(200),
      toEther(20),
    ])) as StrategyMock

    const strategy3 = (await deployUpgradeable('StrategyMock', [
      token.target,
      stakingPool.target,
      toEther(10000),
      toEther(10),
    ])) as StrategyMock

    await stakingPool.addStrategy(strategy1.target)
    await stakingPool.addStrategy(strategy2.target)
    await stakingPool.addStrategy(strategy3.target)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(rebaseController.target)
    await priorityPool.setRebaseController(rebaseController.target)
    await securityPool.setRebaseController(rebaseController.target)

    await token.approve(stakingPool.target, ethers.MaxUint256)
    await stakingPool.deposit(accounts[0], toEther(1000), ['0x', '0x', '0x'])

    return {
      signers,
      accounts,
      token,
      stakingPool,
      priorityPool,
      securityPool,
      rebaseController,
      strategy1,
      strategy2,
      strategy3,
    }
  }

  it('updateRewards should work correctly', async () => {
    const { token, rebaseController, strategy1, strategy2, strategy3 } = await loadFixture(
      deployFixture
    )

    await token.transfer(strategy2.target, toEther(100))
    await strategy1.simulateSlash(toEther(10))
    await strategy3.simulateSlash(toEther(10))

    await rebaseController.updateRewards('0x')

    assert.equal(fromEther(await strategy1.getDepositChange()), 0)
    assert.equal(fromEther(await strategy2.getDepositChange()), 0)
    assert.equal(fromEther(await strategy3.getDepositChange()), 0)

    await token.transfer(strategy2.target, toEther(10))
    await token.transfer(strategy3.target, toEther(20))

    await rebaseController.updateRewards('0x')

    assert.equal(fromEther(await strategy1.getDepositChange()), 0)
    assert.equal(fromEther(await strategy2.getDepositChange()), 0)
    assert.equal(fromEther(await strategy3.getDepositChange()), 0)
  })

  it('checkUpkeep should work correctly', async () => {
    const { token, rebaseController, strategy1, strategy2, strategy3 } = await loadFixture(
      deployFixture
    )

    await token.transfer(strategy2.target, toEther(100))

    let data = await rebaseController.checkUpkeep('0x')
    assert.equal(data[0], false, 'upkeepNeeded incorrect')

    await strategy3.simulateSlash(toEther(20))

    data = await rebaseController.checkUpkeep('0x')
    assert.equal(data[0], true, 'upkeepNeeded incorrect')
    assert.equal(Number(decode(data[1])), 2)

    await strategy1.simulateSlash(toEther(30))

    data = await rebaseController.checkUpkeep('0x')
    assert.equal(data[0], true, 'upkeepNeeded incorrect')
    assert.equal(Number(decode(data[1])), 0)

    await rebaseController.pausePool()

    data = await rebaseController.checkUpkeep('0x')
    assert.equal(data[0], false, 'upkeepNeeded incorrect')
  })

  it('performUpkeep should work correctly', async () => {
    const { token, rebaseController, strategy1, strategy2, strategy3, priorityPool, securityPool } =
      await loadFixture(deployFixture)

    await token.transfer(strategy2.target, toEther(100))
    await strategy1.simulateSlash(toEther(10))
    await strategy3.simulateSlash(toEther(10))

    await expect(rebaseController.performUpkeep(encode([1]))).to.be.revertedWithCustomError(
      rebaseController,
      'NoLossDetected()'
    )

    await rebaseController.performUpkeep(encode([0]))
    assert.equal(Number(await priorityPool.poolStatus()), 2)
    assert.equal(await securityPool.claimInProgress(), true)

    await expect(rebaseController.performUpkeep(encode([0]))).to.be.revertedWithCustomError(
      rebaseController,
      'PoolClosed()'
    )
  })

  it('pausePool should work correctly', async () => {
    const { rebaseController, strategy3, priorityPool, securityPool } = await loadFixture(
      deployFixture
    )

    await strategy3.simulateSlash(toEther(300))
    await rebaseController.pausePool()

    assert.equal(Number(await priorityPool.poolStatus()), 2)
    assert.equal(await securityPool.claimInProgress(), true)

    await expect(rebaseController.pausePool()).to.be.revertedWithCustomError(
      rebaseController,
      'PoolClosed()'
    )
  })

  it('reopenPool should work correctly', async () => {
    const {
      rebaseController,
      strategy3,
      priorityPool,
      stakingPool,
      securityPool,
      token,
      strategy1,
    } = await loadFixture(deployFixture)

    await strategy3.simulateSlash(toEther(300))
    await token.transfer(strategy1.target, toEther(50))
    await rebaseController.pausePool()
    await rebaseController.reopenPool('0x')

    assert.equal(Number(await priorityPool.poolStatus()), 0)
    assert.equal(await securityPool.claimInProgress(), false)
    assert.equal(fromEther(await stakingPool.totalStaked()), 750)
    assert.equal(fromEther(await stakingPool.getStrategyRewards([0, 1, 2])), 0)
  })
})
