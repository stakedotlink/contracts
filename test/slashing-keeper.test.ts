import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
} from './utils/helpers'
import {
  ERC677,
  StrategyMock,
  StakingPool,
  WrappedSDToken,
  SlashingKeeper,
  BorrowingPool,
} from '../typechain-types'

describe('SlashingKeeper', () => {
  let token: ERC677
  let wsdToken: WrappedSDToken
  let slashingKeeper: SlashingKeeper
  let stakingPool: StakingPool
  let strategy1: StrategyMock
  let strategy2: StrategyMock
  let strategy3: StrategyMock
  let ownersRewards: string
  let accounts: string[]

  const decode = (data: any) => ethers.utils.defaultAbiCoder.decode(['uint[]'], data)
  const encode = (data: any) => ethers.utils.defaultAbiCoder.encode(['uint[]'], [data])

  before(async () => {
    ;({ accounts } = await getAccounts())
    ownersRewards = accounts[4]
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    stakingPool = (await deploy('StakingPool', [
      token.address,
      'LinkPool LINK',
      'lpLINK',
      [[ownersRewards, 1000]],
      accounts[0],
    ])) as StakingPool

    let borrowingPool = (await deploy('BorrowingPool', [
      token.address,
      0,
      accounts[4],
      stakingPool.address,
      'test',
      'test',
    ])) as BorrowingPool

    slashingKeeper = (await deploy('SlashingKeeper', [
      stakingPool.address,
      borrowingPool.address,
    ])) as SlashingKeeper

    wsdToken = (await deploy('WrappedSDToken', [
      stakingPool.address,
      'Wrapped LinkPool LINK',
      'wlplLINK',
    ])) as WrappedSDToken
    await stakingPool.setWSDToken(wsdToken.address)

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

    await token.approve(stakingPool.address, ethers.constants.MaxUint256)
    await stakingPool.stake(accounts[0], toEther(1000))
  })

  it('checkUpkeep should work correctly', async () => {
    await token.transfer(strategy2.address, toEther(100))

    let data = await slashingKeeper.checkUpkeep('0x00')
    assert.equal(data[0], false, 'upkeepNeeded incorrect')

    await strategy3.simulateSlash(toEther(20))

    data = await slashingKeeper.checkUpkeep('0x00')
    assert.equal(data[0], true, 'upkeepNeeded incorrect')
    assert.deepEqual(decode(data[1]), [[ethers.BigNumber.from(2)]], 'performData incorrect')

    await strategy1.simulateSlash(toEther(30))

    data = await slashingKeeper.checkUpkeep('0x00')
    assert.equal(data[0], true, 'upkeepNeeded incorrect')
    assert.deepEqual(
      decode(data[1]),
      [[ethers.BigNumber.from(0), ethers.BigNumber.from(2)]],
      'performData incorrect'
    )
  })

  it('performUpkeep should work correctly', async () => {
    await token.transfer(strategy2.address, toEther(100))
    await strategy1.simulateSlash(toEther(10))
    await strategy3.simulateSlash(toEther(10))

    await slashingKeeper.performUpkeep(encode([0, 2]))

    let data = await slashingKeeper.checkUpkeep('0x00')
    assert.equal(data[0], false, 'upkeepNeeded incorrect')
    assert.equal(fromEther(await strategy1.depositChange()), 0, 'strategy1 depositChange incorrect')
    assert.equal(
      fromEther(await strategy2.depositChange()),
      100,
      'strategy2 depositChange incorrect'
    )
    assert.equal(fromEther(await strategy3.depositChange()), 0, 'strategy3 depositChange incorrect')

    await strategy3.simulateSlash(toEther(10))

    await expect(slashingKeeper.performUpkeep(encode([0, 2]))).to.be.revertedWith(
      'Deposit change is >= 0'
    )
    await expect(slashingKeeper.performUpkeep(encode([]))).to.be.revertedWith(
      'No strategies to update'
    )
  })
})
