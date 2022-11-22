import { ethers } from 'hardhat'
import { BigNumber, Signer } from 'ethers'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  padBytes,
} from '../utils/helpers'
import {
  ERC677,
  StrategyMock,
  StakingPool,
  WrappedSDToken,
  PoolRouter,
  StakingAllowance,
  WrappedETH,
  LendingPool,
} from '../../typechain-types'

describe('PoolRouter', () => {
  let token1: ERC677
  let token2: ERC677
  let allowanceToken: StakingAllowance
  let poolRouter: PoolRouter
  let lendingPool: LendingPool
  let stakingPool1: StakingPool
  let stakingPool2: StakingPool
  let stakingPool3: StakingPool
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  async function createPool(poolRouter: PoolRouter, token: string): Promise<StakingPool> {
    let stakingPool = (await deploy('StakingPool', [
      token,
      'LinkPool LINK',
      'lpLINK',
      [[accounts[4], 1000]],
      poolRouter.address,
      lendingPool.address,
    ])) as StakingPool

    let strategy1 = (await deployUpgradeable('StrategyMock', [
      token,
      stakingPool.address,
      toEther(1000),
      toEther(0),
    ])) as StrategyMock
    let strategy2 = (await deployUpgradeable('StrategyMock', [
      token,
      stakingPool.address,
      toEther(2000),
      toEther(0),
    ])) as StrategyMock
    let strategy3 = (await deployUpgradeable('StrategyMock', [
      token,
      stakingPool.address,
      toEther(10000),
      toEther(0),
    ])) as StrategyMock

    await stakingPool.addStrategy(strategy1.address)
    await stakingPool.addStrategy(strategy2.address)
    await stakingPool.addStrategy(strategy3.address)

    await poolRouter.addPool(token, stakingPool.address, true, 0)
    await token1.approve(stakingPool.address, ethers.constants.MaxUint256)
    await token2.approve(stakingPool.address, ethers.constants.MaxUint256)

    return stakingPool
  }

  async function stakeAllowances() {
    await allowanceToken.transferAndCall(lendingPool.address, toEther(10), '0x')
    await allowanceToken.connect(signers[1]).transferAndCall(lendingPool.address, toEther(20), '0x')
    await allowanceToken.connect(signers[2]).transferAndCall(lendingPool.address, toEther(30), '0x')
  }

  beforeEach(async () => {
    token1 = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token1, accounts)

    token2 = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token2, accounts)

    allowanceToken = (await deploy('StakingAllowance', [
      'Staking Allowance',
      'STA',
    ])) as StakingAllowance
    await allowanceToken.mint(accounts[0], toEther(10000))
    await allowanceToken.transfer(accounts[1], toEther(2000))
    await allowanceToken.transfer(accounts[2], toEther(2000))

    poolRouter = (await deploy('PoolRouter', [allowanceToken.address])) as PoolRouter

    lendingPool = (await deploy('LendingPool', [
      allowanceToken.address,
      'Staked Staking Allowance',
      'stSTA',
      poolRouter.address,
      10,
      500,
      6,
      12,
      20,
    ])) as LendingPool

    await poolRouter.setLendingPool(lendingPool.address)

    stakingPool1 = await createPool(poolRouter, token1.address)
    stakingPool2 = await createPool(poolRouter, token1.address)
    stakingPool3 = await createPool(poolRouter, token2.address)

    let wsdToken = (await deploy('WrappedSDToken', [
      stakingPool1.address,
      'Wrapped LinkPool LINK',
      'wlplLINK',
    ])) as WrappedSDToken

    let rewardsPool = await deploy('RewardsPoolWSD', [
      lendingPool.address,
      stakingPool1.address,
      wsdToken.address,
    ])
    await lendingPool.addToken(stakingPool1.address, rewardsPool.address)

    await stakeAllowances()
  })

  it('should return a list of supported tokens', async () => {
    let supportedTokens = await poolRouter.supportedTokens()
    assert.deepEqual(
      supportedTokens,
      [token1.address, token2.address],
      'supported tokens do not match'
    )
  })

  it('should return a list of all pools', async () => {
    let pools = await poolRouter.allPools()
    assert.deepEqual(
      pools,
      [
        [token1.address, stakingPool1.address, true, 0, BigNumber.from(0)],
        [token1.address, stakingPool2.address, true, 0, BigNumber.from(0)],
        [token2.address, stakingPool3.address, true, 0, BigNumber.from(0)],
      ],
      'pools do not match'
    )
  })

  it('onTokenTransfer validation should work correctly', async () => {
    let token = (await deploy('ERC677', ['Unknown', 'ANON', 1000000000])) as ERC677
    await setupToken(token, accounts)
    await expect(token.transferAndCall(poolRouter.address, toEther(10), '0x')).to.be.revertedWith(
      'Only callable by supported tokens'
    )
    await expect(
      token1.transferAndCall(poolRouter.address, toEther(10), '0x02')
    ).to.be.revertedWith('Pool does not exist')
    await expect(
      allowanceToken.transferAndCall(
        poolRouter.address,
        toEther(350),
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint', 'uint16'],
          [token1.address, toEther(100), 2]
        )
      )
    ).to.be.revertedWith('Pool does not exist')
  })

  it('should correctly calculate allowance required', async () => {
    let allowanceRequired = await poolRouter.allowanceRequired(token1.address, 0, toEther(1.3))
    assert.equal(fromEther(allowanceRequired), 1, 'allowance required does not match')

    await allowanceToken.mint(accounts[0], toEther(10000))
    allowanceRequired = await poolRouter.allowanceRequired(token1.address, 0, toEther(0.65))
    assert.equal(fromEther(allowanceRequired), 1, 'allowance required does not match')

    await poolRouter.setAllowanceRequired(token1.address, 0, false)
    allowanceRequired = await poolRouter.allowanceRequired(token1.address, 0, toEther(0.65))
    assert.equal(fromEther(allowanceRequired), 0, 'allowance required does not match')
  })

  it('should correctly calculate stakePerAllowance', async () => {
    let stakePerAllowance = await poolRouter.stakePerAllowance(token1.address, 0)
    assert.equal(fromEther(stakePerAllowance), 1.3, 'stake per allowance does not match')
  })

  it('should be able to stake allowance/asset tokens simultaneously via transferAndCall', async () => {
    await token1.approve(poolRouter.address, toEther(100))
    await allowanceToken.transferAndCall(
      poolRouter.address,
      toEther(350),
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint', 'uint16'],
        [token1.address, toEther(100), 1]
      )
    )
    assert.equal(
      fromEther(await lendingPool.balanceOf(accounts[0])),
      360,
      'staked balances do not match'
    )
    assert.equal(
      fromEther(await stakingPool2.balanceOf(accounts[0])),
      100,
      'staked balances do not match'
    )
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 1))[4]),
      100,
      'total staked does not match'
    )
  })

  it('should be able to stake via transferAndCall', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    let stakedAmount = await stakingPool1.balanceOf(accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      13,
      'total staked does not match'
    )
  })

  it('should be able to stake via transferAndCall with index', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x1', 32))

    let stakedAmount = await stakingPool2.balanceOf(accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 1))[4]),
      13,
      'total staked does not match'
    )
  })

  it('should be able to stake via transferAndCall with another token', async () => {
    await token2.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    let stakedAmount = await stakingPool3.balanceOf(accounts[0])
    assert.equal(fromEther(stakedAmount), 13, 'staked amount does not match')
    assert.equal(
      fromEther((await poolRouter.getPool(token2.address, 0))[4]),
      13,
      'total staked does not match'
    )
  })

  it('should not be able to stake more than available allowance', async () => {
    await expect(
      token1.transferAndCall(poolRouter.address, toEther(1000000), padBytes('0x0', 32))
    ).to.be.revertedWith('Not enough allowance staked')
  })

  it('should be able to stake twice', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(7), padBytes('0x0', 32))

    assert.equal(
      fromEther(await stakingPool1.balanceOf(accounts[0])),
      7,
      'staked balances do not match'
    )

    await token1.transferAndCall(poolRouter.address, toEther(6), padBytes('0x0', 32))

    assert.equal(
      fromEther(await stakingPool1.balanceOf(accounts[0])),
      13,
      'staked balances do not match'
    )
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      13,
      'total staked does not match'
    )
  })

  it('should not be able to stake twice exceeding allowance', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(7), padBytes('0x0', 32))

    assert.equal(
      fromEther(await stakingPool1.balanceOf(accounts[0])),
      7,
      'staked balances do not match'
    )

    await expect(
      token1.transferAndCall(poolRouter.address, toEther(10000000), padBytes('0x0', 32))
    ).to.be.revertedWith('Not enough allowance staked')
  })

  it('should be able to stake via ERC20', async () => {
    await token1.approve(poolRouter.address, toEther(13))
    await poolRouter.stake(token1.address, 0, toEther(13))

    assert.equal(
      fromEther(await stakingPool1.balanceOf(accounts[0])),
      13,
      'staked balances do not match'
    )
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      13,
      'total staked does not match'
    )
  })

  it('should not be able to stake with an unsupported token', async () => {
    let token = (await deploy('ERC677', ['Unknown', 'ANON', 1000000000])) as ERC677
    await setupToken(token, accounts)
    await expect(poolRouter.stake(token.address, 0, toEther(10))).to.be.revertedWith(
      'Pool does not exist'
    )
  })

  it('should be able to stake into multiple pools', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    assert.equal(
      fromEther(await stakingPool1.balanceOf(accounts[0])),
      13,
      'staked balances do not match'
    )
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      13,
      'total staked does not match'
    )

    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x1', 32))

    assert.equal(
      fromEther(await stakingPool2.balanceOf(accounts[0])),
      13,
      'staked balances do not match'
    )
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 1))[4]),
      13,
      'total staked does not match'
    )
  })

  it('should be able to withdraw', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    await poolRouter.withdraw(token1.address, 0, toEther(6.5))

    assert.equal(
      fromEther(await stakingPool1.balanceOf(accounts[0])),
      6.5,
      'staked balances do not match'
    )
    assert.equal(
      fromEther(await token1.balanceOf(accounts[0])),
      999969993.5,
      'account balances do not match'
    )
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      6.5,
      'total staked does not match'
    )
  })

  it('should be able to withdraw then stake again', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    await poolRouter.withdraw(token1.address, 0, toEther(6.5))
    await token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))

    assert.equal(
      fromEther(await stakingPool1.balanceOf(accounts[0])),
      13,
      'staked balances do not match'
    )
  })

  it('should be able to fully withdraw with rewards', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    await token1.transfer((await stakingPool1.getStrategies())[0], toEther(10))
    await stakingPool1.updateStrategyRewards([0])

    let rewardBalance = await stakingPool1.balanceOf(accounts[0])
    assert.isAbove(fromEther(rewardBalance), 13, 'balance after rewards is not greater')

    let previousBalance = fromEther(await token1.balanceOf(accounts[0]))
    await poolRouter.withdraw(token1.address, 0, rewardBalance)

    assert.equal(
      fromEther(await token1.balanceOf(accounts[0])),
      previousBalance + fromEther(rewardBalance),
      'token balance after withdraw does not match'
    )
    assert.equal(
      fromEther(await stakingPool1.balanceOf(accounts[0])),
      0,
      'staked balances do not match'
    )
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      0,
      'total staked does not match'
    )
  })

  it('should be able to fully withdraw with rewards in batches', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), '0x00')

    await token1.transfer((await stakingPool1.getStrategies())[0], toEther(50))
    await stakingPool1.updateStrategyRewards([0])

    await poolRouter.withdraw(token1.address, 0, toEther(10))
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      3,
      'total staked does not match'
    )

    await poolRouter.withdraw(token1.address, 0, toEther(30))
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      0,
      'total staked does not match'
    )
  })

  it('should not be able to withdraw when amount exceeds stake', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))
    await token1
      .connect(signers[1])
      .transferAndCall(poolRouter.address, toEther(13), padBytes('0x0', 32))

    await expect(poolRouter.withdraw(token1.address, 0, toEther(13.5))).to.be.revertedWith(
      'Amount exceeds staked balance'
    )
  })

  it('should be able to stake and withdraw when allowance is not required', async () => {
    await poolRouter.setAllowanceRequired(token1.address, 0, false)

    await token1.transferAndCall(poolRouter.address, toEther(5000), padBytes('0x0', 32))
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      5000,
      'total staked does not match'
    )

    await poolRouter.withdraw(token1.address, 0, toEther(5000))
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      0,
      'total staked does not match'
    )
  })

  it('should be able to remove a pool', async () => {
    await poolRouter.removePool(token1.address, 0)

    let pools = await poolRouter.allPools()
    assert.deepEqual(
      pools,
      [
        [token1.address, stakingPool2.address, true, 0, BigNumber.from(0)],
        [token2.address, stakingPool3.address, true, 0, BigNumber.from(0)],
      ],
      'pools do not match'
    )

    let supportedTokens = await poolRouter.supportedTokens()
    assert.equal(
      JSON.stringify(supportedTokens),
      JSON.stringify([token1.address, token2.address]),
      'supported tokens do not match'
    )
  })

  it('should be able to remove a pool and it pops supported tokens', async () => {
    await poolRouter.removePool(token2.address, 0)

    let pools = await poolRouter.allPools()
    assert.deepEqual(
      pools,
      [
        [token1.address, stakingPool1.address, true, 0, BigNumber.from(0)],
        [token1.address, stakingPool2.address, true, 0, BigNumber.from(0)],
      ],
      'pools do not match'
    )

    let supportedTokens = await poolRouter.supportedTokens()
    assert.equal(
      JSON.stringify(supportedTokens),
      JSON.stringify([token1.address]),
      'supported tokens do not match'
    )
  })

  it('should not be able to remove a pool for a non supported token', async () => {
    let token = (await deploy('ERC677', ['Unknown', 'ANON', 1000000000])) as ERC677

    await expect(poolRouter.removePool(token.address, 0)).to.be.revertedWith('Pool does not exist')
  })

  it('should not be able to remove an out of bounds pool', async () => {
    await expect(poolRouter.removePool(token2.address, 2)).to.be.revertedWith('Pool does not exist')
  })

  it('should not be able to remove a pool with an active stake', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))

    await expect(poolRouter.removePool(token1.address, 0)).to.be.revertedWith(
      'Can only remove a pool with no active stake'
    )
  })

  it('should be able to withdraw when pool status is draining', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))
    await poolRouter.setPoolStatus(token1.address, 0, 1)

    assert.equal((await poolRouter.getPool(token1.address, 0))[3], 1, 'pool status does not match')
    await poolRouter.withdraw(token1.address, 0, toEther(6.5))
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      0,
      'total staked does not match'
    )
  })

  it('should not be able to deposit when pool status is draining', async () => {
    await poolRouter.setPoolStatus(token1.address, 0, 1)

    assert.equal((await poolRouter.getPool(token1.address, 0))[3], 1, 'pool status does not match')
    await expect(
      token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))
    ).to.be.revertedWith('Pool is not open')
  })

  it('should not be able to deposit when pool status is closed', async () => {
    await poolRouter.setPoolStatusClosed(token1.address, 0)

    assert.equal((await poolRouter.getPool(token1.address, 0))[3], 2, 'pool status does not match')
    await expect(
      token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))
    ).to.be.revertedWith('Pool is not open')
  })

  it('should not be able to withdraw when pool status is closed', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))
    await poolRouter.setPoolStatusClosed(token1.address, 0)

    assert.equal((await poolRouter.getPool(token1.address, 0))[3], 2, 'pool status does not match')
    await expect(poolRouter.withdraw(token1.address, 0, toEther(6.5))).to.be.revertedWith(
      'Pool is closed'
    )
  })

  it('should not be able to set pool status as closed using setPoolStatus', async () => {
    await expect(poolRouter.setPoolStatus(token1.address, 0, 2)).to.be.revertedWith(
      'Cannot set status to CLOSED'
    )
  })

  it('should be able to set wrappedETH', async () => {
    const wETH = (await deploy('WrappedETH', [])) as WrappedETH
    await poolRouter.setWrappedETH(wETH.address)
    assert.equal(await poolRouter.wrappedETH(), wETH.address, 'wrappedETH incorrect')

    await expect(poolRouter.setWrappedETH(wETH.address)).to.be.revertedWith(
      'wrappedETH already set'
    )
  })

  it('should be able to stake/withdraw ETH', async () => {
    const wETH = (await deploy('WrappedETH', [])) as WrappedETH
    const stakingPool = await createPool(poolRouter, wETH.address)
    await poolRouter.setWrappedETH(wETH.address)

    await poolRouter.stakeETH(0, { value: toEther(10) })
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[0])), 10, 'incorrect stake balance')

    const initialBalance = await ethers.provider.getBalance(accounts[0])
    await poolRouter.withdrawETH(0, toEther(2))
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[0])), 8, 'incorrect stake balance')
    assert.equal(
      (await ethers.provider.getBalance(accounts[0])).gt(initialBalance),
      true,
      'incorrect amount withdrawn'
    )

    await expect(poolRouter.stakeETH(1, { value: toEther(10) })).to.be.revertedWith(
      'Pool does not exist'
    )
    await expect(poolRouter.withdrawETH(1, toEther(8))).to.be.revertedWith('Pool does not exist')
    await expect(poolRouter.withdrawETH(0, toEther(10))).to.be.revertedWith(
      'Amount exceeds staked balance'
    )
  })
})
