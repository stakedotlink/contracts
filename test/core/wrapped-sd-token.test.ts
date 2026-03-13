import { assert } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  getConnection,
} from '../utils/helpers'
import { ERC677, StrategyMock, StakingPool, WrappedSDToken } from '../../types/ethers-contracts'

const { ethers, loadFixture } = getConnection()

describe('WrappedSDToken', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    const stakingPool = (await deployUpgradeable('StakingPool', [
      token.target,
      'LinkPool LINK',
      'lplLINK',
      [[accounts[4], 0]],
      toEther(10000),
    ])) as StakingPool

    const wsdToken = (await deploy('WrappedSDToken', [
      stakingPool.target,
      'Wrapped LinkPool LINK',
      'wlplLINK',
    ])) as WrappedSDToken

    const strategy1 = (await deployUpgradeable('StrategyMock', [
      token.target,
      stakingPool.target,
      toEther(1000),
      toEther(10),
    ])) as StrategyMock

    async function stake(account: number, amount: number) {
      await token.connect(signers[account]).transfer(accounts[0], toEther(amount))
      await stakingPool.deposit(accounts[account], toEther(amount), ['0x'])
    }

    await stakingPool.addStrategy(strategy1.target)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    await token.approve(stakingPool.target, ethers.MaxUint256)
    await stakingPool.deposit(accounts[0], 1000, ['0x'])

    return { signers, accounts, token, stakingPool, wsdToken, strategy1, stake }
  }

  it('token metadata should be correct', async () => {
    const { wsdToken } = await loadFixture(deployFixture)

    assert.equal(await wsdToken.name(), 'Wrapped LinkPool LINK', 'Name incorrect')
    assert.equal(await wsdToken.symbol(), 'wlplLINK', 'Symbol incorrect')
    assert.equal(Number(await wsdToken.decimals()), 18, 'Decimals incorrect')
  })

  it('should be able to wrap/unwrap tokens', async () => {
    const { signers, accounts, stakingPool, wsdToken, stake } = await loadFixture(deployFixture)

    await stake(1, 1000)
    await stakingPool.connect(signers[1]).approve(wsdToken.target, toEther(1000))
    await wsdToken.connect(signers[1]).wrap(toEther(1000))

    assert.equal(
      fromEther(await stakingPool.balanceOf(wsdToken.target)),
      1000,
      'wsdToken balance incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.balanceOf(accounts[1])),
      1000,
      'account-1 balance incorrect'
    )

    await wsdToken.connect(signers[1]).unwrap(toEther(1000))

    assert.equal(
      fromEther(await stakingPool.balanceOf(wsdToken.target)),
      0,
      'wsdToken balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1000,
      'account-1 balance incorrect'
    )
    assert.equal(fromEther(await wsdToken.balanceOf(accounts[1])), 0, 'account-1 balance incorrect')
  })

  it('should be able to wrap tokens using onTokenTransfer', async () => {
    const { signers, accounts, stakingPool, wsdToken, stake } = await loadFixture(deployFixture)

    await stake(1, 1000)
    await stakingPool.connect(signers[1]).transferAndCall(wsdToken.target, toEther(1000), '0x00')

    assert.equal(
      fromEther(await stakingPool.balanceOf(wsdToken.target)),
      1000,
      'wsdToken balance incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.balanceOf(accounts[1])),
      1000,
      'account-1 balance incorrect'
    )
  })

  it('getWrappedByUnderlying and getUnderlyingByWrapped should work correctly', async () => {
    const { token, stakingPool, wsdToken, strategy1, stake } = await loadFixture(deployFixture)

    await stake(1, 1000)
    await stake(2, 3000)
    await token.transfer(strategy1.target, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(
      fromEther(await wsdToken.getWrappedByUnderlying(toEther(12.5))),
      10,
      'getWrappedByUnderlying incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.getUnderlyingByWrapped(toEther(10))),
      12.5,
      'getUnderlyingByWrapped incorrect'
    )
  })

  it('tokens should be wrapped/unwrapped at current exchange rate', async () => {
    const { signers, accounts, token, stakingPool, wsdToken, strategy1, stake } = await loadFixture(
      deployFixture
    )

    await stake(1, 1000)
    await token.transfer(strategy1.target, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await stakingPool.connect(signers[1]).transferAndCall(wsdToken.target, toEther(500), '0x00')

    assert.equal(
      fromEther(await stakingPool.balanceOf(wsdToken.target)),
      500,
      'wsdToken balance incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.balanceOf(accounts[1])),
      250,
      'account-1 balance incorrect'
    )

    await wsdToken.connect(signers[1]).transfer(accounts[2], toEther(100))
    await wsdToken.connect(signers[2]).unwrap(toEther(100))

    assert.equal(
      fromEther(await stakingPool.balanceOf(wsdToken.target)),
      300,
      'wsdToken balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      200,
      'account-2 balance incorrect'
    )
    assert.equal(fromEther(await wsdToken.balanceOf(accounts[2])), 0, 'account-2 balance incorrect')
  })
})
