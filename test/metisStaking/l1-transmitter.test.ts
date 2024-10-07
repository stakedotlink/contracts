import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  getAccounts,
  fromEther,
  deployUpgradeable,
  deployImplementation,
} from '../utils/helpers'
import {
  CCIPOffRampMock,
  MetisLockingInfoMock,
  L1Transmitter,
  L1Strategy,
  MetisLockingPoolMock,
  CCIPOnRampMock,
  L1StandardBridgeMock,
} from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { ERC20 } from '../../typechain-types/@openzeppelin/contracts/token/ERC20'
import { ERC677 } from '../../typechain-types/contracts/core/tokens/base'

describe('L1Transmitter', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

    const l2Transmitter = accounts[5]
    const l2MetisToken = accounts[6]

    const linkToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Metis',
      'METIS',
      1000000000,
    ])) as ERC20

    const wrappedNative = await deploy('WrappedNative')
    const armProxy = await deploy('CCIPArmProxyMock')
    const router = await deploy('Router', [
      await wrappedNative.getAddress(),
      await armProxy.getAddress(),
    ])

    const offRamp = (await deploy('CCIPOffRampMock', [
      await router.getAddress(),
      [],
      [],
    ])) as CCIPOffRampMock

    const onRamp = (await deploy('CCIPOnRampMock', [[], [], linkToken.target])) as CCIPOnRampMock

    await router.applyRampUpdates([[777, onRamp.target]], [], [[777, offRamp.target]])

    const metisLockingInfo = (await deploy('MetisLockingInfoMock', [
      token.target,
      toEther(100),
      toEther(1000),
    ])) as MetisLockingInfoMock

    const metisLockingPool = (await deploy('MetisLockingPoolMock', [
      token.target,
      metisLockingInfo.target,
      86400,
    ])) as MetisLockingPoolMock

    let vaultImplementation = await deployImplementation('SequencerVault')

    const strategy = (await deployUpgradeable('L1Strategy', [
      token.target,
      metisLockingInfo.target,
      vaultImplementation,
      accounts[1],
      toEther(500),
      1000,
    ])) as L1Strategy

    await metisLockingInfo.setManager(metisLockingPool.target)
    await strategy.setL1Transmitter(accounts[0])

    for (let i = 0; i < 5; i++) {
      await strategy.addVault('0x5555', accounts[1], accounts[i])
    }
    const vaults = await strategy.getVaults()

    const bridge = (await deploy('L1StandardBridgeMock', [token.target])) as L1StandardBridgeMock
    const oracle = await deploy('MVM_DiscountOracleMock')

    const transmitter = (await deployUpgradeable('L1Transmitter', [
      token.target,
      accounts[0],
      strategy.target,
      bridge.target,
      oracle.target,
      l2Transmitter,
      77,
      l2MetisToken,
      await router.getAddress(),
      777,
      '0x1111',
    ])) as L1Transmitter

    await strategy.setL1Transmitter(transmitter.target)

    return {
      signers,
      accounts,
      onRamp,
      offRamp,
      strategy,
      transmitter,
      vaults,
      token,
      l2Transmitter,
      metisLockingPool,
      metisLockingInfo,
      wrappedNative,
      bridge,
    }
  }

  it('depositTokensFromL2 should work correctly', async () => {
    const { strategy, transmitter, token } = await loadFixture(deployFixture)

    await expect(transmitter.depositTokensFromL2()).to.be.revertedWithCustomError(
      transmitter,
      'NoTokensAvailable()'
    )

    await token.transfer(transmitter.target, toEther(500))

    assert.equal(fromEther(await transmitter.getAvailableTokens()), 500)

    await transmitter.depositTokensFromL2()

    assert.equal(fromEther(await token.balanceOf(strategy.target)), 500)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 500)
    assert.equal(fromEther(await transmitter.depositsSinceLastUpdate()), 500)
    assert.equal(fromEther(await transmitter.getAvailableTokens()), 0)
  })

  it('depositQueuedTokens should work correctly', async () => {
    const { strategy, transmitter, token, vaults } = await loadFixture(deployFixture)

    await token.transfer(transmitter.target, toEther(500))
    await transmitter.depositQueuedTokens([0, 3], [toEther(100), toEther(200)])

    assert.equal(fromEther(await token.balanceOf(strategy.target)), 200)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 200)
    assert.equal(
      fromEther(
        await (await ethers.getContractAt('SequencerVault', vaults[0])).getPrincipalDeposits()
      ),
      100
    )
    assert.equal(
      fromEther(
        await (await ethers.getContractAt('SequencerVault', vaults[3])).getPrincipalDeposits()
      ),
      200
    )
  })

  it('ccipReceive should work correctly', async () => {
    const { signers, offRamp, transmitter } = await loadFixture(deployFixture)

    await offRamp.executeSingleMessage(
      ethers.encodeBytes32String('messageId'),
      777,
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [toEther(100)]),
      transmitter.target,
      []
    )

    assert.equal(fromEther(await transmitter.queuedWithdrawals()), 0)

    await offRamp
      .connect(signers[5])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        777,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [toEther(100)]),
        transmitter.target,
        []
      )

    assert.equal(fromEther(await transmitter.queuedWithdrawals()), 100)
  })

  it('executeUpdate should work correctly', async () => {
    const {
      signers,
      offRamp,
      transmitter,
      token,
      metisLockingPool,
      metisLockingInfo,
      strategy,
      onRamp,
      accounts,
      wrappedNative,
      bridge,
    } = await loadFixture(deployFixture)

    await signers[0].sendTransaction({ to: transmitter.target, value: toEther(100) })
    await token.transfer(transmitter.target, toEther(1000))
    await transmitter.depositQueuedTokens(
      [0, 1, 2, 3, 4],
      [toEther(100), toEther(100), toEther(100), toEther(100), toEther(100)]
    )

    await metisLockingPool.addReward(1, toEther(20))
    await metisLockingPool.addReward(3, toEther(50))
    await strategy.setMinRewardsToClaim(toEther(50))
    await metisLockingInfo.setMaxLock(toEther(100))

    await offRamp
      .connect(signers[5])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        777,
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [toEther(10)]),
        transmitter.target,
        []
      )

    let lastRequestData = await onRamp.getLastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(lastRequestData[0]), 3)
    assert.equal(lastRequestData[1], transmitter.target)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[5]
    )
    assert.deepEqual(
      ethers.AbiCoder.defaultAbiCoder()
        .decode(['uint256', 'uint256', 'uint256', 'address[]', 'uint256[]'], lastRequestMsg[1])
        .map((d, i) => {
          if (i == 3) return d
          if (i == 4) return d.map((v: any) => fromEther(v))
          return fromEther(d)
        }),
      [1010, 60, 1000, accounts.slice(0, 5), [2, 0, 5, 0, 0]]
    )
    assert.equal(lastRequestMsg[3], wrappedNative.target)
    assert.equal(lastRequestMsg[4], '0x1111')

    assert.deepEqual(
      (await bridge.lastTransfer()).map((d: any, i) => {
        if (i == 0 || i == 5) return Number(d)
        if (i == 4) return fromEther(d)
        return d
      }),
      [77, token.target, accounts[6], accounts[5], 10, 200000, '0x']
    )
  })
})
