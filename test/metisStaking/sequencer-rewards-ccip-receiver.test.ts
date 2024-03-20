import { ethers } from 'hardhat'
import { assert } from 'chai'
import { toEther, deploy, getAccounts, fromEther } from '../utils/helpers'
import {
  ERC677,
  CCIPOffRampMock,
  CCIPTokenPoolMock,
  SequencerRewardsCCIPReceiver,
  SequencerVCSMock,
} from '../../typechain-types'
import { Signer } from 'ethers'

describe('SequencerRewardsCCIPReceiver', () => {
  let linkToken: ERC677
  let token: ERC677
  let token2: ERC677
  let ccipReceiver: SequencerRewardsCCIPReceiver
  let strategy: SequencerVCSMock
  let offRamp: CCIPOffRampMock
  let tokenPool: CCIPTokenPoolMock
  let tokenPool2: CCIPTokenPoolMock
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
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
    token2 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      '2',
      '2',
      1000000000,
    ])) as ERC677

    const wrappedNative = await deploy('WrappedNative')
    const armProxy = await deploy('CCIPArmProxyMock')
    const router = await deploy('Router', [wrappedNative.address, armProxy.address])

    tokenPool = (await deploy('CCIPTokenPoolMock', [token.address])) as CCIPTokenPoolMock
    tokenPool2 = (await deploy('CCIPTokenPoolMock', [token2.address])) as CCIPTokenPoolMock

    offRamp = (await deploy('CCIPOffRampMock', [
      router.address,
      [token.address, token2.address],
      [tokenPool.address, tokenPool2.address],
    ])) as CCIPOffRampMock

    await router.applyRampUpdates([], [], [[77, offRamp.address]])

    strategy = (await deploy('SequencerVCSMock', [token.address, 1000, 5000])) as SequencerVCSMock

    ccipReceiver = (await deploy('SequencerRewardsCCIPReceiver', [
      router.address,
      token.address,
      strategy.address,
      accounts[1],
      accounts[0],
    ])) as SequencerRewardsCCIPReceiver
  })

  it('ccipReceive should work correctly', async () => {
    await token.transfer(tokenPool.address, toEther(100))
    await offRamp.executeSingleMessage(
      ethers.utils.formatBytes32String('messageId'),
      77,
      '0x',
      ccipReceiver.address,
      [{ token: token.address, amount: toEther(25) }]
    )

    assert.equal(fromEther(await strategy.lastL2RewardsAmount()), 25)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 25)

    await token2.transfer(tokenPool2.address, toEther(100))

    let success: any = await offRamp.callStatic.executeSingleMessage(
      ethers.utils.formatBytes32String('messageId'),
      77,
      '0x',
      ccipReceiver.address,
      [
        { token: token.address, amount: toEther(25) },
        { token: token2.address, amount: toEther(25) },
      ]
    )
    assert.equal(success, false)

    success = await offRamp.callStatic.executeSingleMessage(
      ethers.utils.formatBytes32String('messageId'),
      77,
      '0x',
      ccipReceiver.address,
      [{ token: token2.address, amount: toEther(25) }]
    )
    assert.equal(success, false)

    success = await offRamp
      .connect(signers[5])
      .callStatic.executeSingleMessage(
        ethers.utils.formatBytes32String('messageId'),
        77,
        '0x',
        ccipReceiver.address,
        [{ token: token.address, amount: toEther(25) }]
      )
    assert.equal(success, false)
  })
})
