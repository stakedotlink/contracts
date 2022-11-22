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
  DelegatorPool,
  RampUpCurve,
} from '../../typechain-types'

describe('PoolRouter', () => {
  let token1: ERC677
  let token2: ERC677
  let allowanceToken: StakingAllowance
  let poolRouter: PoolRouter
  let delegatorPool: DelegatorPool
  let stakingPool1: StakingPool
  let stakingPool2: StakingPool
  let stakingPool3: StakingPool
  let feeCurve: RampUpCurve
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
      delegatorPool.address,
    ])) as StakingPool

    let strategy1 = (await deployUpgradeable('StrategyMock', [
      token,
      stakingPool.address,
      toEther(2500),
      toEther(0),
    ])) as StrategyMock
    let strategy2 = (await deployUpgradeable('StrategyMock', [
      token,
      stakingPool.address,
      toEther(2500),
      toEther(0),
    ])) as StrategyMock
    let strategy3 = (await deployUpgradeable('StrategyMock', [
      token,
      stakingPool.address,
      toEther(5000),
      toEther(0),
    ])) as StrategyMock

    await stakingPool.addStrategy(strategy1.address)
    await stakingPool.addStrategy(strategy2.address)
    await stakingPool.addStrategy(strategy3.address)

    await poolRouter.addPool(token, stakingPool.address, 0, false)
    await token1.approve(stakingPool.address, ethers.constants.MaxUint256)
    await token2.approve(stakingPool.address, ethers.constants.MaxUint256)

    return stakingPool
  }

  async function stakeAllowances() {
    await allowanceToken.transferAndCall(delegatorPool.address, toEther(200), '0x')
    await allowanceToken
      .connect(signers[1])
      .transferAndCall(delegatorPool.address, toEther(300), '0x')
    await allowanceToken
      .connect(signers[2])
      .transferAndCall(delegatorPool.address, toEther(500), '0x')
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

    feeCurve = (await deploy('RampUpCurve', [10, 500, 6, 12, 20])) as RampUpCurve

    delegatorPool = (await deploy('DelegatorPool', [
      allowanceToken.address,
      'Staked Staking Allowance',
      'stSTA',
      poolRouter.address,
      feeCurve.address,
    ])) as DelegatorPool

    await poolRouter.setDelegatorPool(delegatorPool.address)

    stakingPool1 = await createPool(poolRouter, token1.address)
    stakingPool2 = await createPool(poolRouter, token1.address)
    stakingPool3 = await createPool(poolRouter, token2.address)

    let wsdToken = (await deploy('WrappedSDToken', [
      stakingPool1.address,
      'Wrapped LinkPool LINK',
      'wlplLINK',
    ])) as WrappedSDToken

    let rewardsPool = await deploy('RewardsPoolWSD', [
      delegatorPool.address,
      stakingPool1.address,
      wsdToken.address,
    ])
    await delegatorPool.addToken(stakingPool1.address, rewardsPool.address)

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
        [token1.address, stakingPool1.address, 0, false, BigNumber.from(0)],
        [token1.address, stakingPool2.address, 0, false, BigNumber.from(0)],
        [token2.address, stakingPool3.address, 0, false, BigNumber.from(0)],
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

  it('should be able to remove a pool', async () => {
    await poolRouter.removePool(token1.address, 0)

    let pools = await poolRouter.allPools()
    assert.deepEqual(
      pools,
      [
        [token1.address, stakingPool2.address, 0, false, BigNumber.from(0)],
        [token2.address, stakingPool3.address, 0, false, BigNumber.from(0)],
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
        [token1.address, stakingPool1.address, 0, false, BigNumber.from(0)],
        [token1.address, stakingPool2.address, 0, false, BigNumber.from(0)],
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

    assert.equal((await poolRouter.getPool(token1.address, 0))[2], 1, 'pool status does not match')
    await poolRouter.withdraw(token1.address, 0, toEther(6.5))
    assert.equal(
      fromEther((await poolRouter.getPool(token1.address, 0))[4]),
      0,
      'total staked does not match'
    )
  })

  it('should not be able to deposit when pool status is draining', async () => {
    await poolRouter.setPoolStatus(token1.address, 0, 1)

    assert.equal((await poolRouter.getPool(token1.address, 0))[2], 1, 'pool status does not match')
    await expect(
      token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))
    ).to.be.revertedWith('Pool is not open')
  })

  it('should not be able to deposit when pool status is closed', async () => {
    await poolRouter.setPoolStatusClosed(token1.address, 0)

    assert.equal((await poolRouter.getPool(token1.address, 0))[2], 2, 'pool status does not match')
    await expect(
      token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))
    ).to.be.revertedWith('Pool is not open')
  })

  it('should not be able to withdraw when pool status is closed', async () => {
    await token1.transferAndCall(poolRouter.address, toEther(6.5), padBytes('0x0', 32))
    await poolRouter.setPoolStatusClosed(token1.address, 0)

    assert.equal((await poolRouter.getPool(token1.address, 0))[2], 2, 'pool status does not match')
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

  describe('reserved allocation', async () => {
    beforeEach(async () => {
      await poolRouter.setReservedModeActive(token1.address, 0, true)
    })

    it('maximum stake for unreserved pools should be unaffected', async () => {
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,uint16,uint256)'](token1.address, 1, toEther(1))
        ),
        10000,
        'incorrect maximum stake'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[4], token1.address, 1)
        ),
        10000,
        'incorrect maximum stake'
      )
    })

    it('isReserved should be true when any pool is in reserved mode', async () => {
      assert.equal(await poolRouter.isReservedMode(), true, 'isReservedMode should be true')
      await poolRouter.setReservedModeActive(token1.address, 0, false)
      assert.equal(await poolRouter.isReservedMode(), false, 'isReservedMode should be false')
      await poolRouter.setReservedModeActive(token1.address, 1, true)
      assert.equal(await poolRouter.isReservedMode(), true, 'isReservedMode should be true')
    })

    it('should be able to calculate maximum stake for an arbitrary amount of allowance', async () => {
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,uint16,uint256)'](token1.address, 0, toEther(600))
        ),
        600,
        'incorrect maximum stake'
      )
      await poolRouter.setReservedModeActive(token1.address, 0, false)

      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,uint16,uint256)'](token1.address, 0, toEther(60))
        ),
        10000,
        'incorrect maximum stake'
      )
    })

    it('should be able to calculate maximum stake when reserved space is 50%', async () => {
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[3], token1.address, 0)
        ),
        0,
        'incorrect maximum stake'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[2], token1.address, 0)
        ),
        500,
        'incorrect maximum stake'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[1], token1.address, 0)
        ),
        300,
        'incorrect maximum stake'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[0], token1.address, 0)
        ),
        200,
        'incorrect maximum stake'
      )
    })

    it('should be able to calculate maximum stake when reserved space is 50% and multiplier is x1.5', async () => {
      await poolRouter.setReservedSpaceMultiplier(15000)

      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[2], token1.address, 0)
        ),
        750,
        'incorrect maximum stake'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[1], token1.address, 0)
        ),
        450,
        'incorrect maximum stake'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[0], token1.address, 0)
        ),
        300,
        'incorrect maximum stake'
      )
    })

    it('should be able to stake into reserved space', async () => {
      await token1
        .connect(signers[2])
        .transferAndCall(poolRouter.address, toEther(150), padBytes('0x0', 32))
      assert.equal(
        fromEther(await stakingPool1.balanceOf(accounts[2])),
        150,
        'incorrect staked balance'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[2], token1.address, 0)
        ),
        350,
        'incorrect maximum stake'
      )
    })

    it('should not be able to stake more than reserved', async () => {
      await expect(
        token1
          .connect(signers[2])
          .transferAndCall(poolRouter.address, toEther(501), padBytes('0x0', 32))
      ).to.be.revertedWith('Not enough allowance staked')
    })

    it('should be able to calculate maximum stake after some reserved space is staked into', async () => {
      await token1
        .connect(signers[2])
        .transferAndCall(poolRouter.address, toEther(250), padBytes('0x0', 32))
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[2], token1.address, 0)
        ),
        250,
        'incorrect maximum stake'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[1], token1.address, 0)
        ),
        300,
        'incorrect maximum stake'
      )
    })

    it('should be able to stake 10%', async () => {
      await token1.transferAndCall(poolRouter.address, toEther(200), padBytes('0x0', 32))
      await token1
        .connect(signers[1])
        .transferAndCall(poolRouter.address, toEther(300), padBytes('0x0', 32))
      await token1
        .connect(signers[2])
        .transferAndCall(poolRouter.address, toEther(500), padBytes('0x0', 32))

      assert.equal(
        fromEther(await poolRouter.poolUtilisation(token1.address, 0)),
        0.1,
        'incorrect maximum stake'
      )
    })

    it('should be able 10% with a 2x multiplier', async () => {
      await poolRouter.setReservedSpaceMultiplier(20000)

      await token1.transferAndCall(poolRouter.address, toEther(400), padBytes('0x0', 32))
      await token1
        .connect(signers[1])
        .transferAndCall(poolRouter.address, toEther(600), padBytes('0x0', 32))

      assert.equal(
        fromEther(await poolRouter.poolUtilisation(token1.address, 0)),
        0.1,
        'incorrect maximum stake'
      )
    })

    it('should update reserved amounts when maximum deposits are increased', async () => {
      await token1.transferAndCall(poolRouter.address, toEther(200), padBytes('0x0', 32))
      await token1
        .connect(signers[1])
        .transferAndCall(poolRouter.address, toEther(300), padBytes('0x0', 32))
      await token1
        .connect(signers[2])
        .transferAndCall(poolRouter.address, toEther(500), padBytes('0x0', 32))
      assert.equal(
        fromEther(await poolRouter.poolUtilisation(token1.address, 0)),
        0.1,
        'incorrect maximum stake'
      )

      let strategy4 = (await deployUpgradeable('StrategyMock', [
        token1.address,
        stakingPool1.address,
        toEther(10000),
        toEther(0),
      ])) as StrategyMock
      await stakingPool1.addStrategy(strategy4.address)

      assert.equal(
        fromEther(await poolRouter.poolUtilisation(token1.address, 0)),
        0.05,
        'incorrect pool utilisation'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[2], token1.address, 0)
        ),
        500,
        'incorrect maximum stake'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[1], token1.address, 0)
        ),
        300,
        'incorrect maximum stake'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[0], token1.address, 0)
        ),
        200,
        'incorrect maximum stake'
      )
    })

    it('should be able to receive more of the staked derivative once using all allocation', async () => {
      await token1.transferAndCall(poolRouter.address, toEther(200), padBytes('0x0', 32))
      await token1
        .connect(signers[1])
        .transferAndCall(poolRouter.address, toEther(300), padBytes('0x0', 32))
      await stakingPool1.connect(signers[1]).transfer(accounts[0], toEther(100))

      assert.equal(
        fromEther(await stakingPool1.balanceOf(accounts[0])),
        300,
        'incorrect maximum stake'
      )
      assert.equal(
        fromEther(
          await poolRouter['canDeposit(address,address,uint16)'](accounts[0], token1.address, 0)
        ),
        0,
        'incorrect maximum stake'
      )
    })
  })
})
