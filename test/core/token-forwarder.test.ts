import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  ethers,
  loadFixture,
} from '../utils/helpers'
import { ERC677, StakingPool, StrategyMock, TokenForwarder } from '../../typechain-types'

describe('TokenForwarder', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    // contract with no onTokenTransfer, standing in for a receiver such as a multisig
    const receiver = await deploy('Multicall3')

    const tokenForwarder = (await deploy('TokenForwarder', [receiver.target])) as TokenForwarder

    return { signers, accounts, receiver, token, tokenForwarder }
  }

  it('should not be deployable with a zero address receiver', async () => {
    const TokenForwarder = await ethers.getContractFactory('TokenForwarder')
    await expect(deploy('TokenForwarder', [ethers.ZeroAddress])).to.be.revertedWithCustomError(
      TokenForwarder,
      'InvalidAddress'
    )
  })

  it('should forward tokens received through transferAndCall', async () => {
    const { signers, accounts, tokenForwarder, receiver, token } = await loadFixture(deployFixture)

    await token.connect(signers[1]).transferAndCall(tokenForwarder.target, toEther(100), '0x')
    await token.connect(signers[2]).transferAndCall(tokenForwarder.target, toEther(50), '0x1234')

    assert.equal(fromEther(await token.balanceOf(receiver.target)), 150)
    assert.equal(fromEther(await token.balanceOf(tokenForwarder.target)), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9900)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
  })

  it('should only forward the calling token', async () => {
    const { accounts, receiver, token, tokenForwarder } = await loadFixture(deployFixture)

    await token.transfer(tokenForwarder.target, toEther(100))

    await expect(
      tokenForwarder.onTokenTransfer(accounts[0], toEther(100), '0x')
    ).to.be.revertedWith('Address: call to non-contract')
    assert.equal(fromEther(await token.balanceOf(tokenForwarder.target)), 100)
    assert.equal(fromEther(await token.balanceOf(receiver.target)), 0)
  })

  it('should forward staking pool fees', async () => {
    const { accounts, tokenForwarder, receiver, token } = await loadFixture(deployFixture)

    const stakingPool = (await deployUpgradeable('StakingPool', [
      token.target,
      'Staked LINK',
      'stLINK',
      [
        [accounts[4], 1000],
        [tokenForwarder.target, 2000],
      ],
      toEther(10000),
    ])) as StakingPool

    const strategy = (await deployUpgradeable('StrategyMock', [
      token.target,
      stakingPool.target,
      toEther(10000),
      toEther(10),
    ])) as StrategyMock

    await stakingPool.addStrategy(strategy.target)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    await token.approve(stakingPool.target, ethers.MaxUint256)
    await stakingPool.deposit(accounts[0], toEther(1000), ['0x'])
    await token.transfer(strategy.target, toEther(100))
    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(receiver.target)), 20)
    assert.equal(fromEther(await stakingPool.balanceOf(tokenForwarder.target)), 0)
  })
})
