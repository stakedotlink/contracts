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
import { ERC677, StakingPool, StrategyMock, TokenForwarder } from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('TokenForwarder', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.token = await token.getAddress()
    await setupToken(token, accounts)

    // contract with no onTokenTransfer, standing in for a receiver such as a multisig
    const receiver = await deploy('Multicall3')
    adrs.receiver = await receiver.getAddress()

    const tokenForwarder = (await deploy('TokenForwarder', [adrs.receiver])) as TokenForwarder
    adrs.tokenForwarder = await tokenForwarder.getAddress()

    return { signers, accounts, adrs, token, tokenForwarder }
  }

  it('should not be deployable with a zero address receiver', async () => {
    await expect(deploy('TokenForwarder', [ethers.ZeroAddress])).to.be.revertedWithCustomError(
      await ethers.getContractFactory('TokenForwarder'),
      'InvalidAddress'
    )
  })

  it('should forward tokens received through transferAndCall', async () => {
    const { signers, accounts, adrs, token } = await loadFixture(deployFixture)

    await token.connect(signers[1]).transferAndCall(adrs.tokenForwarder, toEther(100), '0x')
    await token.connect(signers[2]).transferAndCall(adrs.tokenForwarder, toEther(50), '0x1234')

    assert.equal(fromEther(await token.balanceOf(adrs.receiver)), 150)
    assert.equal(fromEther(await token.balanceOf(adrs.tokenForwarder)), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9900)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
  })

  it('should only forward the calling token', async () => {
    const { accounts, adrs, token, tokenForwarder } = await loadFixture(deployFixture)

    await token.transfer(adrs.tokenForwarder, toEther(100))

    await expect(
      tokenForwarder.onTokenTransfer(accounts[0], toEther(100), '0x')
    ).to.be.revertedWith('Address: call to non-contract')
    assert.equal(fromEther(await token.balanceOf(adrs.tokenForwarder)), 100)
    assert.equal(fromEther(await token.balanceOf(adrs.receiver)), 0)
  })

  it('should forward staking pool fees', async () => {
    const { accounts, adrs, token } = await loadFixture(deployFixture)

    const stakingPool = (await deployUpgradeable('StakingPool', [
      adrs.token,
      'Staked LINK',
      'stLINK',
      [
        [accounts[4], 1000],
        [adrs.tokenForwarder, 2000],
      ],
      toEther(10000),
    ])) as StakingPool
    adrs.stakingPool = await stakingPool.getAddress()

    const strategy = (await deployUpgradeable('StrategyMock', [
      adrs.token,
      adrs.stakingPool,
      toEther(10000),
      toEther(10),
    ])) as StrategyMock
    adrs.strategy = await strategy.getAddress()

    await stakingPool.addStrategy(adrs.strategy)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    await token.approve(adrs.stakingPool, ethers.MaxUint256)
    await stakingPool.deposit(accounts[0], toEther(1000), ['0x'])
    await token.transfer(adrs.strategy, toEther(100))
    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.receiver)), 20)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.tokenForwarder)), 0)
  })
})
