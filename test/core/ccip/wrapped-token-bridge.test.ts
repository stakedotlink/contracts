import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../../utils/helpers'
import {
  ERC677,
  StrategyMock,
  StakingPool,
  WrappedSDToken,
  WrappedTokenBridge,
  CCIPOnRampMock,
  CCIPOffRampMock,
  CCIPTokenPoolMock,
  WrappedNative,
} from '../../../typechain-types'

describe('WrappedTokenBridge', () => {
  let linkToken: ERC677
  let token2: ERC677
  let wrappedToken: WrappedSDToken
  let stakingPool: StakingPool
  let bridge: WrappedTokenBridge
  let onRamp: CCIPOnRampMock
  let offRamp: CCIPOffRampMock
  let tokenPool: CCIPTokenPoolMock
  let tokenPool2: CCIPTokenPoolMock
  let wrappedNative: WrappedNative
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    linkToken = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    token2 = (await deploy('ERC677', ['2', '2', 1000000000])) as ERC677

    stakingPool = (await deployUpgradeable('StakingPool', [
      linkToken.address,
      'Staked LINK',
      'stLINK',
      [],
    ])) as StakingPool

    wrappedToken = (await deploy('WrappedSDToken', [
      stakingPool.address,
      'Wrapped  stLINK',
      'wstLINK',
    ])) as WrappedSDToken

    const strategy = (await deployUpgradeable('StrategyMock', [
      linkToken.address,
      stakingPool.address,
      toEther(100000),
      toEther(0),
    ])) as StrategyMock

    await stakingPool.addStrategy(strategy.address)
    await stakingPool.setPriorityPool(accounts[0])

    await linkToken.approve(stakingPool.address, ethers.constants.MaxUint256)
    await stakingPool.deposit(accounts[0], toEther(10000))
    await stakingPool.deposit(accounts[1], toEther(2000))
    await linkToken.transfer(strategy.address, toEther(12000))
    await stakingPool.updateStrategyRewards([0], '0x')

    wrappedNative = (await deploy('WrappedNative')) as WrappedNative
    const armProxy = await deploy('CCIPArmProxyMock')
    const router = await deploy('Router', [wrappedNative.address, armProxy.address])
    tokenPool = (await deploy('CCIPTokenPoolMock', [wrappedToken.address])) as CCIPTokenPoolMock
    tokenPool2 = (await deploy('CCIPTokenPoolMock', [token2.address])) as CCIPTokenPoolMock
    onRamp = (await deploy('CCIPOnRampMock', [
      [wrappedToken.address, token2.address],
      [tokenPool.address, tokenPool2.address],
      linkToken.address,
    ])) as CCIPOnRampMock
    offRamp = (await deploy('CCIPOffRampMock', [
      router.address,
      [wrappedToken.address, token2.address],
      [tokenPool.address, tokenPool2.address],
    ])) as CCIPOffRampMock

    await router.applyRampUpdates([[77, onRamp.address]], [], [[77, offRamp.address]])

    bridge = (await deploy('WrappedTokenBridge', [
      router.address,
      linkToken.address,
      stakingPool.address,
      wrappedToken.address,
    ])) as WrappedTokenBridge

    await linkToken.approve(bridge.address, ethers.constants.MaxUint256)
    await stakingPool.approve(bridge.address, ethers.constants.MaxUint256)
  })

  it('getFee should work correctly', async () => {
    assert.equal(fromEther(await bridge.getFee(77, false, '0x')), 2)
    assert.equal(fromEther(await bridge.getFee(77, true, '0x')), 3)
    await expect(bridge.getFee(78, false, '0x')).to.be.reverted
    await expect(bridge.getFee(78, true, '0x')).to.be.reverted
  })

  it('transferTokens should work correctly with LINK fee', async () => {
    let preFeeBalance = await linkToken.balanceOf(accounts[0])

    await bridge.transferTokens(77, accounts[4], toEther(100), false, toEther(10), '0x')
    let lastRequestData = await onRamp.lastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await wrappedToken.balanceOf(tokenPool.address)), 50)
    assert.equal(fromEther(preFeeBalance.sub(await linkToken.balanceOf(accounts[0]))), 2)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], bridge.address)

    assert.equal(
      ethers.utils.defaultAbiCoder.decode(['address'], lastRequestMsg[0])[0],
      accounts[4]
    )
    assert.equal(lastRequestMsg[1], '0x')
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[wrappedToken.address, 50]]
    )
    assert.equal(lastRequestMsg[3], linkToken.address)

    await expect(
      bridge.transferTokens(77, accounts[4], toEther(100), false, toEther(1), '0x')
    ).to.be.revertedWith('FeeExceedsLimit()')
  })

  it('transferTokens should work correctly with native fee', async () => {
    let preFeeBalance = await ethers.provider.getBalance(accounts[0])

    await bridge.transferTokens(77, accounts[4], toEther(100), true, 0, '0x', {
      value: toEther(10),
    })
    let lastRequestData = await onRamp.lastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await wrappedToken.balanceOf(tokenPool.address)), 50)
    assert.equal(
      Math.trunc(fromEther(preFeeBalance.sub(await ethers.provider.getBalance(accounts[0])))),
      3
    )

    assert.equal(fromEther(lastRequestData[0]), 3)
    assert.equal(lastRequestData[1], bridge.address)

    assert.equal(
      ethers.utils.defaultAbiCoder.decode(['address'], lastRequestMsg[0])[0],
      accounts[4]
    )
    assert.equal(lastRequestMsg[1], '0x')
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[wrappedToken.address, 50]]
    )
    assert.equal(lastRequestMsg[3], wrappedNative.address)
  })

  it('onTokenTransfer should work correctly', async () => {
    let preFeeBalance = await linkToken.balanceOf(accounts[0])

    await stakingPool.transferAndCall(
      bridge.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(
        ['uint64', 'address', 'uint256', 'bytes'],
        [77, accounts[4], toEther(10), '0x']
      )
    )

    let lastRequestData = await onRamp.lastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await wrappedToken.balanceOf(tokenPool.address)), 50)
    assert.equal(fromEther(preFeeBalance.sub(await linkToken.balanceOf(accounts[0]))), 2)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], bridge.address)

    assert.equal(
      ethers.utils.defaultAbiCoder.decode(['address'], lastRequestMsg[0])[0],
      accounts[4]
    )
    assert.equal(lastRequestMsg[1], '0x')
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[wrappedToken.address, 50]]
    )
    assert.equal(lastRequestMsg[3], linkToken.address)

    await expect(bridge.onTokenTransfer(accounts[0], toEther(1000), '0x')).to.be.revertedWith(
      'InvalidSender()'
    )
    await expect(stakingPool.transferAndCall(bridge.address, 0, '0x')).to.be.revertedWith(
      'InvalidValue()'
    )
    await expect(
      stakingPool.transferAndCall(
        bridge.address,
        toEther(100),
        ethers.utils.defaultAbiCoder.encode(
          ['uint64', 'address', 'uint256', 'bytes'],
          [77, accounts[4], toEther(1), '0x']
        )
      )
    ).to.be.revertedWith('FeeExceedsLimit()')
  })

  it('ccipReceive should work correctly', async () => {
    await stakingPool.transferAndCall(
      bridge.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(
        ['uint64', 'address', 'uint256', 'bytes'],
        [77, accounts[4], toEther(10), '0x']
      )
    )
    await offRamp.executeSingleMessage(
      ethers.utils.formatBytes32String('messageId'),
      77,
      ethers.utils.defaultAbiCoder.encode(['address'], [accounts[5]]),
      bridge.address,
      [{ token: wrappedToken.address, amount: toEther(25) }]
    )

    assert.equal(fromEther(await stakingPool.balanceOf(accounts[5])), 50)
  })

  it('failed messages should be properly handled', async () => {
    await stakingPool.transferAndCall(
      bridge.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(
        ['uint64', 'address', 'uint256', 'bytes'],
        [77, accounts[4], toEther(10), '0x']
      )
    )
    await token2.transfer(tokenPool2.address, toEther(100))
    await offRamp.executeSingleMessage(
      ethers.utils.formatBytes32String('messageId1'),
      77,
      ethers.utils.defaultAbiCoder.encode(['address'], [accounts[5]]),
      bridge.address,
      [
        { token: wrappedToken.address, amount: toEther(25) },
        { token: token2.address, amount: toEther(10) },
      ]
    )
    await offRamp.executeSingleMessage(
      ethers.utils.formatBytes32String('messageId2'),
      77,
      ethers.utils.defaultAbiCoder.encode(['address'], [accounts[5]]),
      bridge.address,
      [{ token: token2.address, amount: toEther(10) }]
    )
    await offRamp.executeSingleMessage(
      ethers.utils.formatBytes32String('messageId3'),
      77,
      '0x',
      bridge.address,
      [{ token: wrappedToken.address, amount: toEther(25) }]
    )

    let events: any = await bridge.queryFilter(bridge.filters['MessageFailed(bytes32,bytes)']())

    await bridge.retryFailedMessage(events[1].args.messageId, accounts[4])
    assert.equal(await bridge.messageErrorsStatus(events[1].args.messageId), 0)
    assert.equal(fromEther(await token2.balanceOf(accounts[4])), 10)

    await bridge.retryFailedMessage(events[2].args.messageId, accounts[5])
    assert.equal(await bridge.messageErrorsStatus(events[2].args.messageId), 0)
    assert.equal(fromEther(await wrappedToken.balanceOf(accounts[5])), 25)

    await bridge.retryFailedMessage(events[0].args.messageId, accounts[6])
    assert.equal(await bridge.messageErrorsStatus(events[1].args.messageId), 0)
    assert.equal(fromEther(await token2.balanceOf(accounts[6])), 10)
    assert.equal(fromEther(await wrappedToken.balanceOf(accounts[6])), 25)
  })

  it('recoverTokens should work correctly', async () => {
    await linkToken.transfer(bridge.address, toEther(1000))
    await stakingPool.transfer(bridge.address, toEther(2000))
    await bridge.recoverTokens([linkToken.address, stakingPool.address], accounts[3])

    assert.equal(fromEther(await linkToken.balanceOf(accounts[3])), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[3])), 2000)
  })
})