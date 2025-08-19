import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { assert, expect } from 'chai'
import { ethers } from 'hardhat'
import { id, AbiCoder } from 'ethers'
import {
  CCIPCurveGaugeReceiver,
  CCIPCurveGaugeSender,
  CurveGaugeDistributorMock,
  MockCCIPRouter,
  StakingPool,
  WrappedSDToken,
} from '../../../typechain-types'
import { deploy, deployUpgradeable, fromEther, getAccounts, toEther } from '../../utils/helpers'
import { ERC677 } from '../../../typechain-types/contracts/core/tokens/base'

const sourceChainSelector = 7777n
const destChainSelector = 8888n

const gasLimit = 200000
const functionSelector = id('CCIP EVMExtraArgsV1').slice(0, 10)
const extraArgs = AbiCoder.defaultAbiCoder().encode(['uint256'], [gasLimit])
const encodedExtraArgs = `${functionSelector}${extraArgs.slice(2)}`

describe('CCIPCurveGaugeSender', function () {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

    const ccipRouter = (await deploy('MockCCIPRouter')) as MockCCIPRouter
    const linkToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'LINK',
      'LINK',
      1000000000,
    ])) as ERC677
    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'TKN',
      'TKN',
      1000000000,
    ])) as ERC677
    const lst = (await deployUpgradeable('StakingPool', [
      token.target,
      'lst',
      'lst',
      [],
      toEther(10000),
    ])) as StakingPool
    const wlst = (await deploy('WrappedSDToken', [lst.target, 'wlst', 'wlst'])) as WrappedSDToken
    const strategy = await deployUpgradeable('StrategyMock', [
      token.target,
      lst.target,
      toEther(1000),
      toEther(10),
    ])

    const curveGaugeSender = (await deploy('CCIPCurveGaugeSender', [
      lst.target,
      wlst.target,
      ccipRouter.target,
      linkToken.target,
      destChainSelector,
      encodedExtraArgs,
      accounts[0],
    ])) as CCIPCurveGaugeSender

    const curveGaugeDistributor = (await deploy('CurveGaugeDistributorMock', [
      wlst.target,
    ])) as CurveGaugeDistributorMock
    const curveGaugeReceiver = (await deploy('CCIPCurveGaugeReceiver', [
      wlst.target,
      curveGaugeDistributor.target,
      ccipRouter.target,
      sourceChainSelector,
      curveGaugeSender.target,
    ])) as CCIPCurveGaugeReceiver

    await ccipRouter.setFee(toEther(1))
    await curveGaugeSender.setCCIPCurveGaugeReceiver(curveGaugeReceiver.target)
    await lst.setPriorityPool(accounts[0])
    await lst.addStrategy(strategy.target)
    await token.approve(lst.target, ethers.MaxUint256)
    await lst.deposit(accounts[0], toEther(1000), ['0x'])

    return {
      accounts,
      signers,
      ccipRouter,
      linkToken,
      curveGaugeDistributor,
      wlst,
      lst,
      curveGaugeSender,
      curveGaugeReceiver,
    }
  }

  it('sendRewards should work correctly', async function () {
    const {
      signers,
      wlst,
      lst,
      linkToken,
      curveGaugeDistributor,
      curveGaugeSender,
      ccipRouter,
      curveGaugeReceiver,
    } = await loadFixture(deployFixture)

    await expect(curveGaugeSender.sendRewards()).to.be.revertedWithCustomError(
      curveGaugeSender,
      'NoRewards()'
    )

    await lst.transfer(curveGaugeSender.target, toEther(100))
    await linkToken.transfer(curveGaugeSender.target, toEther(10))

    await expect(curveGaugeSender.connect(signers[1]).sendRewards()).to.be.revertedWithCustomError(
      curveGaugeSender,
      'SenderNotAuthorized()'
    )

    await curveGaugeSender.sendRewards()

    assert.deepEqual(await ccipRouter.lastSentMessage(), [
      ethers.AbiCoder.defaultAbiCoder().encode(['address'], [curveGaugeReceiver.target]),
      '0x',
      linkToken.target,
      encodedExtraArgs,
    ])
    assert.equal(await ccipRouter.lastSentMessageChainSelector(), destChainSelector)

    assert.equal(fromEther(await wlst.balanceOf(curveGaugeDistributor.target)), 100)
    assert.equal(fromEther(await curveGaugeDistributor.lastBalance()), 100)
    assert.equal(fromEther(await curveGaugeDistributor.lastMinMintAmount()), 0)
  })

  it('should be be able to receive ERC677 transferAndCalls', async () => {
    const { curveGaugeSender, lst } = await loadFixture(deployFixture)

    await lst.transferAndCall(curveGaugeSender.target, toEther(100), '0x')

    assert.equal(fromEther(await lst.balanceOf(curveGaugeSender.target)), 100)
  })

  it('getFeeBalance should work correctly', async function () {
    const { curveGaugeSender, linkToken } = await loadFixture(deployFixture)

    assert.equal(fromEther(await curveGaugeSender.getFeeBalance()), 0)

    await linkToken.transfer(curveGaugeSender.target, toEther(100))

    assert.equal(fromEther(await curveGaugeSender.getFeeBalance()), 100)
  })

  it('withdrawFees should work correctly', async function () {
    const { accounts, curveGaugeSender, linkToken } = await loadFixture(deployFixture)

    await linkToken.transfer(curveGaugeSender.target, toEther(100))
    assert.equal(fromEther(await curveGaugeSender.getFeeBalance()), 100)

    let preBalance = await linkToken.balanceOf(accounts[0])

    await curveGaugeSender.withdrawFees(toEther(40))

    assert.equal(fromEther(await curveGaugeSender.getFeeBalance()), 60)
    assert.equal(fromEther(await linkToken.balanceOf(accounts[0])), fromEther(preBalance) + 40)
    assert.equal(fromEther(await linkToken.balanceOf(curveGaugeSender.target)), 60)
  })

  it('setExtraArgs should work correctly', async function () {
    const { signers, curveGaugeSender } = await loadFixture(deployFixture)

    await expect(curveGaugeSender.connect(signers[1]).setExtraArgs('0x1234')).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )

    await curveGaugeSender.setExtraArgs('0x1234')

    assert.equal(await curveGaugeSender.extraArgs(), '0x1234')
  })

  it('setCCIPCurveGaugeReceiver should work correctly', async function () {
    const { signers, accounts, curveGaugeSender } = await loadFixture(deployFixture)

    await expect(
      curveGaugeSender.connect(signers[1]).setCCIPCurveGaugeReceiver(accounts[2])
    ).to.be.revertedWith('Ownable: caller is not the owner')

    await curveGaugeSender.setCCIPCurveGaugeReceiver(accounts[2])

    assert.equal(await curveGaugeSender.ccipCurveGaugeReceiver(), accounts[2])
  })

  it('setRewardsSender should work correctly', async function () {
    const { signers, accounts, curveGaugeSender } = await loadFixture(deployFixture)

    await expect(
      curveGaugeSender.connect(signers[1]).setRewardsSender(accounts[2])
    ).to.be.revertedWith('Ownable: caller is not the owner')

    await curveGaugeSender.setRewardsSender(accounts[2])

    assert.equal(await curveGaugeSender.rewardsSender(), accounts[2])
  })
})
