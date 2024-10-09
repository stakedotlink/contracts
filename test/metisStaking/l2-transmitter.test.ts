import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, getAccounts, fromEther, deployUpgradeable } from '../utils/helpers'
import {
  CCIPOffRampMock,
  CCIPOnRampMock,
  L2Transmitter,
  L2StandardBridgeMock,
  L2Strategy,
  StakingPool,
  SDLPoolMock,
  PriorityPool,
  WithdrawalPool,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
import { ERC20 } from '../../typechain-types/@openzeppelin/contracts/token/ERC20'
import { ERC677 } from '../../typechain-types/contracts/core/tokens/base'

describe('L2Transmitter', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

    const linkToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677

    const token = (await deploy('ERC677Burnable', ['Metis', 'METIS', 1000000000])) as ERC20

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

    const stakingPool = (await deployUpgradeable('StakingPool', [
      token.target,
      'Staked METIS',
      'stMETIS',
      [],
      toEther(10000),
    ])) as StakingPool

    const sdlPool = (await deploy('SDLPoolMock')) as SDLPoolMock

    const priorityPool = (await deployUpgradeable('PriorityPool', [
      token.target,
      stakingPool.target,
      sdlPool.target,
      toEther(100),
      toEther(1000),
      true,
    ])) as PriorityPool

    const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
      token.target,
      stakingPool.target,
      priorityPool.target,
      toEther(10),
      0,
    ])) as WithdrawalPool

    const strategy = (await deployUpgradeable('L2Strategy', [
      token.target,
      stakingPool.target,
      [],
      toEther(5000),
    ])) as L2Strategy

    const bridge = (await deploy('L2StandardBridgeMock', [token.target])) as L2StandardBridgeMock
    const oracle = await deploy('OVM_GasPriceOracleMock')

    const transmitter = (await deployUpgradeable('L2Transmitter', [
      token.target,
      strategy.target,
      bridge.target,
      oracle.target,
      accounts[5],
      withdrawalPool.target,
      0,
      86400,
      await router.getAddress(),
      777,
      '0x1111',
    ])) as L2Transmitter

    await strategy.setL2Transmitter(transmitter.target)
    await stakingPool.addStrategy(strategy.target)
    await stakingPool.setPriorityPool(priorityPool.target)
    await stakingPool.setRebaseController(accounts[0])
    await priorityPool.setWithdrawalPool(withdrawalPool.target)
    await token.approve(priorityPool.target, ethers.MaxUint256)

    return {
      signers,
      accounts,
      onRamp,
      offRamp,
      strategy,
      transmitter,
      token,
      wrappedNative,
      bridge,
      priorityPool,
      withdrawalPool,
      stakingPool,
    }
  }

  it('ccipReceive should work correctly', async () => {
    const { signers, offRamp, transmitter, priorityPool, accounts, strategy } = await loadFixture(
      deployFixture
    )

    await priorityPool.deposit(toEther(1000), false, ['0x'])
    await transmitter.executeUpdate({ value: toEther(10) })
    await priorityPool.deposit(toEther(1000), false, ['0x'])

    await offRamp.executeSingleMessage(
      ethers.encodeBytes32String('messageId'),
      777,
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256', 'uint256', 'address[]', 'uint256[]'],
        [
          toEther(1100),
          toEther(50),
          toEther(1000),
          [accounts[0], accounts[1]],
          [toEther(1), toEther(2)],
        ]
      ),
      transmitter.target,
      []
    )

    assert.equal(fromEther(await strategy.getTotalDeposits()), 2000)

    await offRamp
      .connect(signers[5])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        777,
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'uint256', 'uint256', 'address[]', 'uint256[]'],
          [
            toEther(1100),
            toEther(50),
            toEther(1000),
            [accounts[0], accounts[1]],
            [toEther(1), toEther(2)],
          ]
        ),
        transmitter.target,
        []
      )

    assert.equal(fromEther(await strategy.getTotalDeposits()), 2150)
    assert.equal(fromEther(await strategy.tokensInTransitFromL1()), 50)
    assert.equal(fromEther(await strategy.getOperatorRewards(accounts[0])), 1)
    assert.equal(fromEther(await strategy.getOperatorRewards(accounts[1])), 2)
    assert.equal(fromEther(await strategy.getTotalOperatorRewards()), 3)
  })

  it('depositTokensFromL1 should work correctly', async () => {
    const { strategy, transmitter, token, offRamp, signers } = await loadFixture(deployFixture)

    await token.transfer(transmitter.target, toEther(100))

    await expect(transmitter.depositTokensFromL1()).to.be.revertedWithCustomError(
      transmitter,
      'InvalidTransfer()'
    )

    await offRamp
      .connect(signers[5])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        777,
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'uint256', 'uint256', 'address[]', 'uint256[]'],
          [0, toEther(200), 0, [], []]
        ),
        transmitter.target,
        []
      )

    await transmitter.depositTokensFromL1()
    assert.equal(fromEther(await token.balanceOf(strategy.target)), 100)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 100)

    await expect(transmitter.depositTokensFromL1()).to.be.revertedWithCustomError(
      transmitter,
      'InvalidTransfer()'
    )
  })

  it('executeQueuedWithdrawals should work correctly', async () => {
    const {
      signers,
      offRamp,
      transmitter,
      priorityPool,
      accounts,
      withdrawalPool,
      token,
      stakingPool,
    } = await loadFixture(deployFixture)

    await token.transfer(accounts[1], toEther(1000))
    await token.connect(signers[1]).approve(priorityPool.target, ethers.MaxUint256)
    await stakingPool.connect(signers[1]).approve(priorityPool.target, ethers.MaxUint256)
    await priorityPool.connect(signers[1]).deposit(toEther(1000), false, ['0x'])
    await transmitter.executeUpdate({ value: toEther(10) })
    await priorityPool.connect(signers[1]).withdraw(toEther(500), 0, 0, [], false, true, ['0x'])
    await token.transfer(transmitter.target, toEther(200))
    await offRamp
      .connect(signers[5])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        777,
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'uint256', 'uint256', 'address[]', 'uint256[]'],
          [toEther(800), toEther(200), toEther(1000), [], []]
        ),
        transmitter.target,
        []
      )
    await transmitter.depositTokensFromL1()

    await transmitter.executeQueuedWithdrawals()
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 300)
  })

  it('executeUpdate should work correctly', async () => {
    const {
      signers,
      offRamp,
      transmitter,
      priorityPool,
      accounts,
      withdrawalPool,
      token,
      stakingPool,
      onRamp,
      wrappedNative,
      bridge,
      strategy,
    } = await loadFixture(deployFixture)

    await token.transfer(accounts[1], toEther(1000))
    await token.connect(signers[1]).approve(priorityPool.target, ethers.MaxUint256)
    await stakingPool.connect(signers[1]).approve(priorityPool.target, ethers.MaxUint256)
    await priorityPool.connect(signers[1]).deposit(toEther(1000), false, ['0x'])
    await transmitter.executeUpdate({ value: toEther(10) })

    assert.equal(fromEther(await token.balanceOf(strategy.target)), 0)
    assert.equal(fromEther(await token.balanceOf(transmitter.target)), 0)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 0)
    assert.equal(fromEther(await strategy.tokensInTransitToL1()), 1000)
    assert.equal(fromEther(await strategy.tokensInTransitFromL1()), 0)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 0)

    let lastRequestData = await onRamp.getLastRequestData()
    let lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(lastRequestData[0]), 3)
    assert.equal(lastRequestData[1], transmitter.target)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[5]
    )
    assert.deepEqual(
      fromEther(ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], lastRequestMsg[1])[0]),
      0
    )
    assert.equal(lastRequestMsg[3], wrappedNative.target)
    assert.equal(lastRequestMsg[4], '0x1111')

    assert.deepEqual(
      (await bridge.lastTransfer()).map((d: any, i) => {
        if (i == 1) return fromEther(d)
        if (i == 2) return Number(d)
        return d
      }),
      [accounts[5], 1000, 0, '0x']
    )

    await priorityPool.connect(signers[1]).withdraw(toEther(500), 0, 0, [], false, true, ['0x'])
    await token.transfer(transmitter.target, toEther(200))
    await offRamp
      .connect(signers[5])
      .executeSingleMessage(
        ethers.encodeBytes32String('messageId'),
        777,
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'uint256', 'uint256', 'address[]', 'uint256[]'],
          [toEther(800), toEther(200), toEther(1000), [], []]
        ),
        transmitter.target,
        []
      )

    await expect(transmitter.executeUpdate({ value: toEther(10) })).to.be.revertedWithCustomError(
      transmitter,
      'InsufficientTimeElapsed()'
    )

    await time.increase(86400)
    await transmitter.executeUpdate({ value: toEther(10) })

    assert.equal(fromEther(await token.balanceOf(strategy.target)), 0)
    assert.equal(fromEther(await token.balanceOf(transmitter.target)), 0)
    assert.equal(fromEther(await strategy.getTotalQueuedTokens()), 0)
    assert.equal(fromEther(await strategy.tokensInTransitToL1()), 0)
    assert.equal(fromEther(await strategy.tokensInTransitFromL1()), 0)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 300)

    lastRequestData = await onRamp.getLastRequestData()
    lastRequestMsg = await onRamp.getLastRequestMessage()

    assert.equal(fromEther(lastRequestData[0]), 3)
    assert.equal(lastRequestData[1], transmitter.target)

    assert.equal(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], lastRequestMsg[0])[0],
      accounts[5]
    )
    assert.deepEqual(
      fromEther(ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], lastRequestMsg[1])[0]),
      300
    )
    assert.equal(lastRequestMsg[3], wrappedNative.target)
    assert.equal(lastRequestMsg[4], '0x1111')
  })
})
