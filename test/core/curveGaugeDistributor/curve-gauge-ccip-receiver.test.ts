import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { assert, expect } from 'chai'
import { ethers } from 'hardhat'
import { id, AbiCoder } from 'ethers'
import {
  CCIPCurveGaugeReceiver,
  CurveGaugeDistributorMock,
  MockCCIPRouter,
} from '../../../typechain-types'
import { deploy, fromEther, getAccounts, toEther } from '../../utils/helpers'
import { ERC677 } from '../../../typechain-types/contracts/core/tokens/base'

const chainSelector = 7777n

describe('CCIPCurveGaugeReceiver', function () {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

    const ccipRouter = (await deploy('MockCCIPRouter')) as MockCCIPRouter
    const linkToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'LINK',
      'LINK',
      1000000000,
    ])) as ERC677
    const wlst = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'wLST',
      'wLST',
      1000000000,
    ])) as ERC677
    const curveGaugeDistributor = (await deploy('CurveGaugeDistributorMock', [
      wlst.target,
    ])) as CurveGaugeDistributorMock

    const curveGaugeReceiver = (await deploy('CCIPCurveGaugeReceiver', [
      wlst.target,
      curveGaugeDistributor.target,
      ccipRouter.target,
      chainSelector,
      accounts[0],
    ])) as CCIPCurveGaugeReceiver

    await wlst.approve(ccipRouter.target, ethers.MaxUint256)
    await wlst.connect(signers[1]).approve(ccipRouter.target, ethers.MaxUint256)
    await wlst.transfer(accounts[1], toEther(100))

    return {
      accounts,
      signers,
      ccipRouter,
      linkToken,
      curveGaugeDistributor,
      wlst,
      curveGaugeReceiver,
    }
  }

  it('Receiving rewards should work correctly', async function () {
    const { signers, wlst, linkToken, curveGaugeReceiver, ccipRouter, curveGaugeDistributor } =
      await loadFixture(deployFixture)

    const tokenAmounts = [
      {
        token: wlst.target,
        amount: toEther(100),
      },
    ]

    const gasLimit = 200000
    const functionSelector = id('CCIP EVMExtraArgsV1').slice(0, 10)
    const defaultAbiCoder = AbiCoder.defaultAbiCoder()
    const extraArgs = defaultAbiCoder.encode(['uint256'], [gasLimit])
    const encodedExtraArgs = `${functionSelector}${extraArgs.slice(2)}`

    const message = {
      receiver: defaultAbiCoder.encode(['address'], [curveGaugeReceiver.target]),
      data: defaultAbiCoder.encode(['string'], ['']),
      tokenAmounts: tokenAmounts,
      feeToken: linkToken.target,
      extraArgs: encodedExtraArgs,
    }

    await expect(ccipRouter.connect(signers[1]).ccipSend(chainSelector, message)).to.be.reverted
    await expect(
      ccipRouter.connect(signers[1]).ccipSend(chainSelector, { ...message, tokenAmounts: [] })
    ).to.be.reverted

    await ccipRouter.ccipSend(chainSelector, message)

    assert.equal(fromEther(await wlst.balanceOf(curveGaugeDistributor.target)), 100)
    assert.equal(fromEther(await curveGaugeDistributor.lastBalance()), 100)
    assert.equal(fromEther(await curveGaugeDistributor.lastMinMintAmount()), 0)
  })
})
