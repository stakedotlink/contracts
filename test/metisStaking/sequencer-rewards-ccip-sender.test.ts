import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, getAccounts, fromEther, deployUpgradeable } from '../utils/helpers'
import {
  ERC677,
  CCIPOnRampMock,
  CCIPTokenPoolMock,
  SequencerRewardsCCIPSender,
} from '../../typechain-types'

describe('SequencerRewardsCCIPSender', () => {
  let linkToken: ERC677
  let token: ERC677
  let ccipSender: SequencerRewardsCCIPSender
  let onRamp: CCIPOnRampMock
  let tokenPool: CCIPTokenPoolMock
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    linkToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      '1',
      '1',
      1000000000,
    ])) as ERC677

    const wrappedNative = await deploy('WrappedNative')
    const armProxy = await deploy('CCIPArmProxyMock')
    const router = await deploy('Router', [wrappedNative.address, armProxy.address])

    tokenPool = (await deploy('CCIPTokenPoolMock', [token.address])) as CCIPTokenPoolMock
    onRamp = (await deploy('CCIPOnRampMock', [
      [token.address],
      [tokenPool.address],
      linkToken.address,
    ])) as CCIPOnRampMock

    await router.applyRampUpdates([[77, onRamp.address]], [], [])

    ccipSender = (await deployUpgradeable('SequencerRewardsCCIPSender', [
      router.address,
      linkToken.address,
      token.address,
      accounts[0],
      77,
      '0x1111',
    ])) as SequencerRewardsCCIPSender

    await ccipSender.setDestinationReceiver(accounts[5])
  })

  it('transferRewards should work correctly', async () => {
    await linkToken.transfer(ccipSender.address, toEther(10))
    await token.transfer(ccipSender.address, toEther(100))

    await ccipSender.transferRewards(toEther(10))
    let lastRequestData = await onRamp.getLastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(await token.balanceOf(tokenPool.address)), 100)
    assert.equal(fromEther(await linkToken.balanceOf(ccipSender.address)), 8)

    assert.equal(fromEther(lastRequestData[0]), 2)
    assert.equal(lastRequestData[1], ccipSender.address)

    assert.equal(
      ethers.utils.defaultAbiCoder.decode(['address'], lastRequestMsg[0])[0],
      accounts[5]
    )
    assert.equal(lastRequestMsg[1], '0x')
    assert.deepEqual(
      lastRequestMsg[2].map((d) => [d.token, fromEther(d.amount)]),
      [[token.address, 100]]
    )
    assert.equal(lastRequestMsg[3], linkToken.address)
    assert.equal(lastRequestMsg[4], '0x1111')

    await expect(ccipSender.transferRewards(toEther(10))).to.be.revertedWith('NoRewards()')

    await token.transfer(ccipSender.address, toEther(100))
    await expect(ccipSender.transferRewards(toEther(1))).to.be.revertedWith('FeeExceedsLimit()')
  })
})
