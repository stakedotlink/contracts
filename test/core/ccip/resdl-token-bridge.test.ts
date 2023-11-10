import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../../utils/helpers'
import {
  ERC677,
  CCIPOnRampMock,
  CCIPOffRampMock,
  CCIPTokenPoolMock,
  WrappedNative,
  RESDLTokenBridge,
  SDLPoolCCIPControllerMock,
  SDLPoolPrimary,
} from '../../../typechain-types'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { Signer } from 'ethers'

describe('RESDLTokenBridge', () => {
  let linkToken: ERC677
  let sdlToken: ERC677
  let token2: ERC677
  let bridge: RESDLTokenBridge
  let sdlPool: SDLPoolPrimary
  let onRamp: CCIPOnRampMock
  let offRamp: CCIPOffRampMock
  let tokenPool: CCIPTokenPoolMock
  let tokenPool2: CCIPTokenPoolMock
  let wrappedNative: WrappedNative
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    linkToken = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    sdlToken = (await deploy('ERC677', ['SDL', 'SDL', 1000000000])) as ERC677
    token2 = (await deploy('ERC677', ['2', '2', 1000000000])) as ERC677

    wrappedNative = (await deploy('WrappedNative')) as WrappedNative
    const armProxy = await deploy('CCIPArmProxyMock')
    const router = await deploy('Router', [wrappedNative.address, armProxy.address])
    tokenPool = (await deploy('CCIPTokenPoolMock', [sdlToken.address])) as CCIPTokenPoolMock
    tokenPool2 = (await deploy('CCIPTokenPoolMock', [token2.address])) as CCIPTokenPoolMock
    onRamp = (await deploy('CCIPOnRampMock', [
      [sdlToken.address, token2.address],
      [tokenPool.address, tokenPool2.address],
      linkToken.address,
    ])) as CCIPOnRampMock
    offRamp = (await deploy('CCIPOffRampMock', [
      router.address,
      [sdlToken.address, token2.address],
      [tokenPool.address, tokenPool2.address],
    ])) as CCIPOffRampMock

    await router.applyRampUpdates([[77, onRamp.address]], [], [[77, offRamp.address]])

    let boostController = await deploy('LinearBoostController', [4 * 365 * 86400, 4])
    sdlPool = (await deployUpgradeable('SDLPoolPrimary', [
      'reSDL',
      'reSDL',
      sdlToken.address,
      boostController.address,
    ])) as SDLPoolPrimary
    let sdlPoolCCIPController = (await deploy('SDLPoolCCIPControllerMock', [
      sdlToken.address,
      sdlPool.address,
    ])) as SDLPoolCCIPControllerMock

    bridge = (await deploy('RESDLTokenBridge', [
      router.address,
      linkToken.address,
      sdlToken.address,
      sdlPool.address,
      sdlPoolCCIPController.address,
    ])) as RESDLTokenBridge

    await sdlPoolCCIPController.setRESDLTokenBridge(bridge.address)
    await sdlPool.setCCIPController(sdlPoolCCIPController.address)
    await linkToken.approve(bridge.address, ethers.constants.MaxUint256)
    await bridge.addWhitelistedDestination(77, accounts[0])
    await sdlToken.transfer(accounts[1], toEther(200))

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(200),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(1000),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * 86400])
    )
  })

  it('getFee should work correctly', async () => {
    assert.equal(fromEther(await bridge.getFee(77, false, '0x')), 2)
    assert.equal(fromEther(await bridge.getFee(77, true, '0x')), 3)
    await expect(bridge.getFee(78, false, '0x')).to.be.reverted
    await expect(bridge.getFee(78, true, '0x')).to.be.reverted
  })

  it('transferRESDL should work correctly with LINK fee', async () => {
    let ts1 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await time.setNextBlockTimestamp(ts1 + 365 * 86400)
    await sdlPool.initiateUnlock(2)
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    let preFeeBalance = await linkToken.balanceOf(accounts[0])

    await bridge.transferRESDL(77, accounts[4], 2, false, toEther(10), '0x')
    let lastRequestData = await onRamp.lastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await sdlToken.balanceOf(tokenPool.address)), 1000)
    assert.equal(fromEther(preFeeBalance.sub(await linkToken.balanceOf(accounts[0]))), 2)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], bridge.address)

    assert.equal(
      ethers.utils.defaultAbiCoder.decode(['address'], lastRequestMsg[0])[0],
      accounts[0]
    )
    assert.deepEqual(
      ethers.utils.defaultAbiCoder
        .decode(
          ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
          lastRequestMsg[1]
        )
        .map((d, i) => {
          if (i == 0) return d
          if (i > 1 && i < 4) return fromEther(d)
          return d.toNumber()
        }),
      [accounts[4], 2, 1000, 0, ts1, 365 * 86400, ts2 + (365 * 86400) / 2]
    )
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[sdlToken.address, 1000]]
    )
    assert.equal(lastRequestMsg[3], linkToken.address)
    await expect(sdlPool.ownerOf(3)).to.be.revertedWith('InvalidLockId()')

    await expect(
      bridge.transferRESDL(77, accounts[4], 1, false, toEther(1), '0x')
    ).to.be.revertedWith('FeeExceedsLimit()')

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(500),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 2 * 365 * 86400])
    )
    let ts3 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    preFeeBalance = await linkToken.balanceOf(accounts[0])

    await bridge.transferRESDL(77, accounts[5], 3, false, toEther(10), '0x')
    lastRequestData = await onRamp.lastRequestData()
    lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await sdlToken.balanceOf(tokenPool.address)), 1500)
    assert.equal(fromEther(preFeeBalance.sub(await linkToken.balanceOf(accounts[0]))), 2)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], bridge.address)

    assert.equal(
      ethers.utils.defaultAbiCoder.decode(['address'], lastRequestMsg[0])[0],
      accounts[0]
    )
    assert.deepEqual(
      ethers.utils.defaultAbiCoder
        .decode(
          ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
          lastRequestMsg[1]
        )
        .map((d, i) => {
          if (i == 0) return d
          if (i > 1 && i < 4) return fromEther(d)
          return d.toNumber()
        }),
      [accounts[5], 3, 500, 1000, ts3, 2 * 365 * 86400, 0]
    )
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[sdlToken.address, 500]]
    )
    assert.equal(lastRequestMsg[3], linkToken.address)
    await expect(sdlPool.ownerOf(3)).to.be.revertedWith('InvalidLockId()')
  })

  it('transferTokens should work correctly with native fee', async () => {
    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    let preFeeBalance = await ethers.provider.getBalance(accounts[0])

    await bridge.transferRESDL(77, accounts[4], 2, true, toEther(10), '0x', { value: toEther(10) })
    let lastRequestData = await onRamp.lastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await sdlToken.balanceOf(tokenPool.address)), 1000)
    assert.equal(
      Math.trunc(fromEther(preFeeBalance.sub(await ethers.provider.getBalance(accounts[0])))),
      3
    )
    assert.equal(fromEther(lastRequestData[0]), 3)
    assert.equal(lastRequestData[1], bridge.address)

    assert.equal(
      ethers.utils.defaultAbiCoder.decode(['address'], lastRequestMsg[0])[0],
      accounts[0]
    )
    assert.deepEqual(
      ethers.utils.defaultAbiCoder
        .decode(
          ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
          lastRequestMsg[1]
        )
        .map((d, i) => {
          if (i == 0) return d
          if (i > 1 && i < 4) return fromEther(d)
          return d.toNumber()
        }),
      [accounts[4], 2, 1000, 1000, ts, 365 * 86400, 0]
    )
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[sdlToken.address, 1000]]
    )
    assert.equal(lastRequestMsg[3], wrappedNative.address)
    await expect(sdlPool.ownerOf(3)).to.be.revertedWith('InvalidLockId()')
  })

  it('transferRESDL validation should work correctly', async () => {
    await expect(
      bridge.connect(signers[1]).transferRESDL(77, accounts[4], 1, false, toEther(10), '0x')
    ).to.be.revertedWith('SenderNotAuthorized()')
    await expect(
      bridge.transferRESDL(77, ethers.constants.AddressZero, 1, false, toEther(10), '0x')
    ).to.be.revertedWith('InvalidReceiver()')
    await expect(
      bridge.transferRESDL(78, accounts[4], 1, false, toEther(10), '0x')
    ).to.be.revertedWith('InvalidDestination()')

    bridge.transferRESDL(77, accounts[4], 1, false, toEther(10), '0x')
  })

  it('ccipReceive should work correctly', async () => {
    await bridge.transferRESDL(77, accounts[4], 2, true, toEther(10), '0x', { value: toEther(10) })

    await offRamp
      .connect(signers[1])
      .executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
          [accounts[5], 2, toEther(25), toEther(25), 1000, 3000, 8000]
        ),
        bridge.address,
        [{ token: sdlToken.address, amount: toEther(25) }]
      )

    let events: any = await bridge.queryFilter(bridge.filters['MessageFailed(bytes32,bytes)']())
    assert.equal(events[0].args.messageId, ethers.utils.formatBytes32String('messageId'))
    assert.equal(fromEther(await sdlToken.balanceOf(bridge.address)), 25)

    await offRamp.executeSingleMessage(
      ethers.utils.formatBytes32String('messageId'),
      77,
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint64', 'uint64'],
        [accounts[5], 2, toEther(25), toEther(25), 1000, 3000, 8000]
      ),
      bridge.address,
      [{ token: sdlToken.address, amount: toEther(25) }]
    )

    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 225)
    assert.equal(await sdlPool.ownerOf(2), accounts[5])
    assert.deepEqual(
      (await sdlPool.getLocks([2])).map((l: any) => ({
        amount: fromEther(l.amount),
        boostAmount: Number(fromEther(l.boostAmount).toFixed(4)),
        startTime: l.startTime.toNumber(),
        duration: l.duration.toNumber(),
        expiry: l.expiry.toNumber(),
      })),
      [
        {
          amount: 25,
          boostAmount: 25,
          startTime: 1000,
          duration: 3000,
          expiry: 8000,
        },
      ]
    )
  })

  it('should be able to add/remove whitelisted destinations', async () => {
    await expect(
      bridge.addWhitelistedDestination(10, ethers.constants.AddressZero)
    ).to.be.revertedWith('InvalidDestination()')
    await expect(bridge.removeWhitelistedDestination(10)).to.be.revertedWith('AlreadyRemoved()')

    await bridge.addWhitelistedDestination(10, accounts[0])

    assert.equal(await bridge.whitelistedDestinations(10), accounts[0])
    await expect(bridge.addWhitelistedDestination(10, accounts[1])).to.be.revertedWith(
      'AlreadyAdded()'
    )

    await bridge.removeWhitelistedDestination(10)
    assert.equal(await bridge.whitelistedDestinations(10), ethers.constants.AddressZero)
  })

  it('recoverTokens should work correctly', async () => {
    await linkToken.transfer(bridge.address, toEther(1000))
    await sdlToken.transfer(bridge.address, toEther(2000))
    await bridge.recoverTokens([linkToken.address, sdlToken.address], accounts[3])

    assert.equal(fromEther(await linkToken.balanceOf(accounts[3])), 1000)
    assert.equal(fromEther(await sdlToken.balanceOf(accounts[3])), 2000)
  })
})