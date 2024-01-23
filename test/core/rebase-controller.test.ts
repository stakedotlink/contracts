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
  ERC677,
  StrategyMock,
  StakingPool,
  RebaseController,
  SDLPoolCCIPControllerMock,
  PriorityPool,
  InsurancePool,
} from '../../typechain-types'

describe('RebaseController', () => {
  let token: ERC677
  let rebaseController: RebaseController
  let stakingPool: StakingPool
  let priorityPool: PriorityPool
  let sdlPoolCCIPController: SDLPoolCCIPControllerMock
  let insurancePool: InsurancePool
  let strategy1: StrategyMock
  let strategy2: StrategyMock
  let strategy3: StrategyMock
  let ownersRewards: string
  let accounts: string[]

  const decode = (data: any) => ethers.utils.defaultAbiCoder.decode(['uint256[]', 'uint256'], data)
  const encode = (data: any) => ethers.utils.defaultAbiCoder.encode(['uint256[]', 'uint256'], data)

  before(async () => {
    ;({ accounts } = await getAccounts())
    ownersRewards = accounts[4]
  })

  beforeEach(async () => {
    token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'LinkPool LINK',
      'lpLINK',
      [[ownersRewards, 1000]],
    ])) as StakingPool

    priorityPool = (await deployUpgradeable('PriorityPool', [
      token.address,
      stakingPool.address,
      accounts[0],
      toEther(100),
      toEther(1000),
    ])) as PriorityPool

    sdlPoolCCIPController = (await deploy('SDLPoolCCIPControllerMock', [
      accounts[0],
      accounts[0],
    ])) as SDLPoolCCIPControllerMock

    insurancePool = (await deployUpgradeable('InsurancePool', [
      token.address,
      'name',
      'symbol',
      accounts[0],
      3000,
    ])) as InsurancePool

    rebaseController = (await deploy('RebaseController', [
      stakingPool.address,
      priorityPool.address,
      sdlPoolCCIPController.address,
      insurancePool.address,
      accounts[0],
      3000,
    ])) as RebaseController

    strategy1 = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(200),
      toEther(10),
    ])) as StrategyMock
    strategy2 = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(200),
      toEther(20),
    ])) as StrategyMock
    strategy3 = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(10000),
      toEther(10),
    ])) as StrategyMock

    await stakingPool.addStrategy(strategy1.address)
    await stakingPool.addStrategy(strategy2.address)
    await stakingPool.addStrategy(strategy3.address)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(rebaseController.address)
    await priorityPool.setRebaseController(rebaseController.address)
    await insurancePool.setRebaseController(rebaseController.address)

    await token.approve(stakingPool.address, ethers.constants.MaxUint256)
    await stakingPool.deposit(accounts[0], toEther(1000))
  })

  it('checkUpkeep should work correctly', async () => {
    await token.transfer(strategy2.address, toEther(100))

    let data = await rebaseController.checkUpkeep('0x00')
    assert.equal(data[0], false, 'upkeepNeeded incorrect')

    await strategy3.simulateSlash(toEther(20))

    data = await rebaseController.checkUpkeep('0x00')
    assert.equal(data[0], true, 'upkeepNeeded incorrect')
    assert.deepEqual(
      decode(data[1])[0].map((v: any) => v.toNumber()),
      [2]
    )
    assert.equal(fromEther(decode(data[1])[1]), 20)

    await strategy1.simulateSlash(toEther(30))

    data = await rebaseController.checkUpkeep('0x00')
    assert.equal(data[0], true, 'upkeepNeeded incorrect')
    assert.deepEqual(
      decode(data[1])[0].map((v: any) => v.toNumber()),
      [0, 2]
    )
    assert.equal(fromEther(decode(data[1])[1]), 50)
  })

  it('performUpkeep should work correctly', async () => {
    await token.transfer(strategy2.address, toEther(100))
    await strategy1.simulateSlash(toEther(10))
    await strategy3.simulateSlash(toEther(10))

    await rebaseController.performUpkeep(encode([[0, 2], toEther(20)]))

    let data = await rebaseController.checkUpkeep('0x00')
    assert.equal(data[0], false, 'upkeepNeeded incorrect')
    assert.equal(
      fromEther(await strategy1.getDepositChange()),
      0,
      'strategy1 depositChange incorrect'
    )
    assert.equal(
      fromEther(await strategy2.getDepositChange()),
      100,
      'strategy2 depositChange incorrect'
    )
    assert.equal(
      fromEther(await strategy3.getDepositChange()),
      0,
      'strategy3 depositChange incorrect'
    )

    await expect(rebaseController.performUpkeep(encode([[], 10]))).to.be.revertedWith(
      'NoStrategiesToUpdate()'
    )
    await expect(rebaseController.performUpkeep(encode([[1], 0]))).to.be.revertedWith(
      'NoStrategiesToUpdate()'
    )

    await strategy3.simulateSlash(toEther(301))
    await rebaseController.performUpkeep(encode([[2], toEther(301)]))

    assert.equal(fromEther(await stakingPool.totalStaked()), 980)
    assert.equal(await priorityPool.poolStatus(), 2)
    assert.equal(await insurancePool.claimInProgress(), true)
  })

  it('pausing process should work correctly when max loss is exceeded', async () => {
    await strategy3.simulateSlash(toEther(300))
    await rebaseController.performUpkeep(encode([[2], toEther(300)]))

    assert.equal(fromEther(await stakingPool.totalStaked()), 700)
    assert.equal(await priorityPool.poolStatus(), 0)
    assert.equal(await insurancePool.claimInProgress(), false)

    await token.transfer(strategy3.address, toEther(300))
    await rebaseController.updateRewards([2], '0x')
    await strategy3.simulateSlash(toEther(301))
    await rebaseController.performUpkeep(encode([[2], toEther(301)]))

    assert.equal(fromEther(await stakingPool.totalStaked()), 1000)
    assert.equal(await priorityPool.poolStatus(), 2)
    assert.equal(await insurancePool.claimInProgress(), true)
    await expect(rebaseController.performUpkeep(encode([[2], 1]))).to.be.revertedWith(
      'PoolClosed()'
    )
    await expect(rebaseController.updateRewards([2], '0x')).to.be.revertedWith('PoolClosed()')
    assert.equal((await rebaseController.checkUpkeep('0x00'))[0], false)

    await stakingPool.donateTokens(toEther(101))
    await rebaseController.reopenPool([2])
    assert.equal(fromEther(await stakingPool.totalStaked()), 800)
    assert.equal(await priorityPool.poolStatus(), 0)
    assert.equal(await insurancePool.claimInProgress(), false)
  })

  it('updateRewards should work correctly', async () => {
    await token.transfer(strategy2.address, toEther(100))
    await strategy1.simulateSlash(toEther(10))
    await strategy3.simulateSlash(toEther(10))

    await rebaseController.updateRewards([0, 2], '0x', [])

    assert.equal(fromEther(await strategy1.getDepositChange()), 0)
    assert.equal(fromEther(await strategy2.getDepositChange()), 100)
    assert.equal(fromEther(await strategy3.getDepositChange()), 0)
    assert.equal((await sdlPoolCCIPController.rewardsDistributed()).toNumber(), 1)

    await token.transfer(strategy2.address, toEther(10))
    await token.transfer(strategy3.address, toEther(20))

    await rebaseController.updateRewards([0, 1, 2], '0x', [])

    assert.equal(fromEther(await strategy1.getDepositChange()), 0)
    assert.equal(fromEther(await strategy2.getDepositChange()), 0)
    assert.equal(fromEther(await strategy3.getDepositChange()), 0)
    assert.equal((await sdlPoolCCIPController.rewardsDistributed()).toNumber(), 2)
  })
})
