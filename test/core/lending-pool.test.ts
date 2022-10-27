import { ethers } from 'hardhat'
import { Signer } from 'ethers'
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
  LendingPool,
  BorrowingPool,
  RewardsPool,
} from '../../typechain-types'
import { assert, expect } from 'chai'

describe('LendingPool', () => {
  let token: ERC677
  let wbstToken: WrappedSDToken
  let allowanceToken: StakingAllowance
  let lendingPool: LendingPool
  let borrowingPool: BorrowingPool
  let poolRouter: PoolRouter
  let stakingPool: StakingPool
  let rewardsPool: RewardsPool
  let strategy: StrategyMock
  let ownersRewards: string
  let signers: Signer[]
  let accounts: string[]

  let distributeRewards = async (amount: number) => {
    await token.transfer(strategy.address, toEther(amount))
    await stakingPool.updateStrategyRewards([0])
    await borrowingPool.updateRewards()
  }

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
    ownersRewards = accounts[4]
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    allowanceToken = (await deploy('StakingAllowance', [
      'Staking Allowance',
      'STA',
    ])) as StakingAllowance
    await allowanceToken.connect(signers[0])
    await allowanceToken.mint(accounts[0], toEther(10000))
    await allowanceToken.transfer(accounts[1], toEther(2000))
    await allowanceToken.transfer(accounts[2], toEther(2000))

    poolRouter = (await deploy('PoolRouter', [allowanceToken.address])) as PoolRouter

    stakingPool = (await deploy('StakingPool', [
      token.address,
      'LinkPool LINK',
      'lpLINK',
      [[ownersRewards, 1000]],
      poolRouter.address,
    ])) as StakingPool

    let wsdToken = (await deploy('WrappedSDToken', [
      stakingPool.address,
      'Wrapped LinkPool LINK',
      'wlplLINK',
    ])) as WrappedSDToken
    await stakingPool.setWSDToken(wsdToken.address)

    strategy = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(1000),
      toEther(0),
    ])) as StrategyMock
    await stakingPool.addStrategy(strategy.address)

    await poolRouter.addPool(token.address, stakingPool.address, accounts[1], true, 0)
    await token.approve(stakingPool.address, ethers.constants.MaxUint256)

    lendingPool = (await deploy('LendingPool', [
      allowanceToken.address,
      'Lent Staking Allowance',
      'lSTA',
      poolRouter.address,
      // Borrower Rate Constants
      10,
      500,
      6,
      12,
      20,
    ])) as LendingPool

    borrowingPool = (await deploy('BorrowingPool', [
      token.address,
      0,
      lendingPool.address,
      stakingPool.address,
      'Borrowed Staked LINK',
      'bstLINK',
    ])) as BorrowingPool
    wbstToken = (await deploy('WrappedSDToken', [
      borrowingPool.address,
      'Wrapped Borrowed LINK',
      'wbstLINK',
    ])) as WrappedSDToken
    await borrowingPool.init(wbstToken.address)

    rewardsPool = (await deploy('RewardsPool', [
      lendingPool.address,
      wbstToken.address,
      'Reward Wrapped Borrowed Staked LINK',
      'rwbstLINK',
    ])) as RewardsPool
    await lendingPool.addToken(wbstToken.address, rewardsPool.address)

    await lendingPool.addPool(token.address, 0, borrowingPool.address)

    await allowanceToken.transferAndCall(lendingPool.address, toEther(1000), padBytes('0x', 32))
  })

  it('should be able to query whether pool is supported', async () => {
    assert.equal(await lendingPool.isPoolSupported(token.address, 0), true, 'pool is not supported')
  })

  it('should be able to lend allowance by transferAndCall', async () => {
    assert.equal(
      fromEther(await lendingPool.totalStaked()),
      1000,
      'total allowance staked does not match'
    )
    assert.equal(
      fromEther(await lendingPool.balanceOf(accounts[0])),
      1000,
      'balance of does not match'
    )
    assert.equal(
      fromEther(await poolRouter.allowanceStakes(lendingPool.address)),
      1000,
      'staked allowance in pool router does not match'
    )
    assert.equal(
      fromEther(await lendingPool.canStake(token.address, 0)),
      100,
      'can stake amount does not match'
    )
  })

  it('should be able to borrow allowance via transferAndCall', async () => {
    await token.transferAndCall(lendingPool.address, toEther(90), padBytes('0x0', 32))

    assert.equal(
      fromEther(await borrowingPool.balanceOf(accounts[0])),
      90,
      'borrowed amount does not match'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(lendingPool.address)),
      90,
      'staked amount does not match'
    )
    assert.equal(
      fromEther(await lendingPool.canStake(token.address, 0)),
      10,
      'can stake amount does not match'
    )
    assert.equal(
      fromEther(await lendingPool.availableAllowance(token.address, 0)),
      100,
      'available allowance amount does not match'
    )
  })

  it('should not be able to borrow more allowance than what is staked', async () => {
    await token.transferAndCall(lendingPool.address, toEther(50), padBytes('0x0', 32))

    await expect(
      token.transferAndCall(lendingPool.address, toEther(51), padBytes('0x0', 32))
    ).to.be.revertedWith('Not enough allowance available')
  })

  it('should not be able to borrow allowance for an unsupported pool', async () => {
    await expect(
      token.transferAndCall(lendingPool.address, toEther(100), padBytes('0x1', 32))
    ).to.be.revertedWith('Pool is not supported')
  })

  it('should be able to lend allowance via lendAllowance', async () => {
    await allowanceToken.approve(lendingPool.address, toEther(1000))
    await lendingPool.lendAllowance(toEther(1000))

    assert.equal(
      fromEther(await lendingPool.totalStaked()),
      2000,
      'total allowance staked does not match'
    )
    assert.equal(
      fromEther(await lendingPool.balanceOf(accounts[0])),
      2000,
      'balance of does not match'
    )
    assert.equal(
      fromEther(await poolRouter.allowanceStakes(lendingPool.address)),
      2000,
      'staked allowance in pool router does not match'
    )
    assert.equal(
      fromEther(await lendingPool.canStake(token.address, 0)),
      200,
      'can stake amount does not match'
    )
  })

  it('should be able to withdraw allowance', async () => {
    await lendingPool.withdrawAllowance(toEther(500))

    assert.equal(
      fromEther(await lendingPool.totalStaked()),
      500,
      'total allowance staked does not match'
    )
    assert.equal(
      fromEther(await lendingPool.balanceOf(accounts[0])),
      500,
      'balance of does not match'
    )
    assert.equal(
      fromEther(await poolRouter.allowanceStakes(lendingPool.address)),
      500,
      'staked allowance in pool router does not match'
    )
    assert.equal(
      fromEther(await allowanceToken.balanceOf(accounts[0])),
      5500,
      'allowance token balance does not match'
    )
  })

  it('should not be able to withdraw more allowance than what is staked', async () => {
    await allowanceToken
      .connect(signers[1])
      .transferAndCall(lendingPool.address, toEther(1000), padBytes('0x', 32))

    await expect(lendingPool.withdrawAllowance(toEther(1001))).to.be.revertedWith(
      'ERC20: burn amount exceeds balance'
    )
  })

  it('should be able to transfer allowance derivative and withdraw allowance', async () => {
    await lendingPool.transfer(accounts[1], toEther(500))

    assert.equal(
      fromEther(await lendingPool.balanceOf(accounts[1])),
      500,
      'balance of does not match'
    )

    await lendingPool.connect(signers[1]).withdrawAllowance(toEther(500))

    assert.equal(
      fromEther(await allowanceToken.balanceOf(accounts[1])),
      2500,
      'allowance token balance does not match'
    )
  })

  it('should be able to withdraw borrowed stake', async () => {
    await token.transferAndCall(lendingPool.address, toEther(100), padBytes('0x0', 32))

    await lendingPool.withdraw(token.address, 0, toEther(100))
    assert.equal(
      fromEther(await borrowingPool.balanceOf(accounts[0])),
      0,
      'borrowed amount does not match'
    )
    assert.equal(
      fromEther(await token.balanceOf(accounts[0])),
      999970000,
      'token balance does not match'
    )
  })

  it('should not be able to withdraw more borrowed stake than balance', async () => {
    await token.transferAndCall(lendingPool.address, toEther(100), padBytes('0x0', 32))

    await expect(lendingPool.withdraw(token.address, 0, toEther(101))).to.be.revertedWith(
      'Burn amount exceeds balance'
    )
  })

  it('should be able to transfer borrowing derivative and withdraw balance', async () => {
    await token.transferAndCall(lendingPool.address, toEther(100), padBytes('0x0', 32))

    await borrowingPool.transfer(accounts[1], toEther(50))
    assert.equal(
      fromEther(await borrowingPool.balanceOf(accounts[1])),
      50,
      'borrowed amount does not match'
    )

    await lendingPool.connect(signers[1]).withdraw(token.address, 0, toEther(50))
    assert.equal(
      fromEther(await borrowingPool.balanceOf(accounts[1])),
      0,
      'borrowed amount does not match'
    )
    assert.equal(
      fromEther(await token.balanceOf(accounts[1])),
      10050,
      'token balance does not match'
    )
  })

  it('should be able to transfer borrowing derivative and retain lender rewards', async () => {
    await token.transferAndCall(lendingPool.address, toEther(100), padBytes('0x0', 32))

    await distributeRewards(1000)

    assert.equal(
      fromEther(await wbstToken.getUnderlyingByWrapped(await rewardsPool.balanceOf(accounts[0]))),
      830.97,
      'lenders fee amount does not match'
    )

    await lendingPool.transfer(accounts[1], toEther(1000))
    assert.equal(
      fromEther(await lendingPool.balanceOf(accounts[1])),
      1000,
      'balance does not match'
    )
    assert.equal(fromEther(await lendingPool.balanceOf(accounts[0])), 0, 'balance does not match')

    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[0])),
      491.6109566349169,
      'lenders fee amount does not match'
    )

    await distributeRewards(1000)

    assert.equal(
      fromEther(await rewardsPool.balanceOf(accounts[0])),
      491.6109566349169,
      'lenders fee amount does not match'
    )
    assert.equal(
      fromEther(await wbstToken.getUnderlyingByWrapped(await rewardsPool.balanceOf(accounts[1]))),
      755.4272727272727,
      'lenders fee amount does not match'
    )
  })

  // Rate set in tests (candidate for production)
  // y\ =\ \left(10\frac{x}{500}\right)^{6}\ +\frac{x}{12}\ +\ 20
  // https://www.desmos.com/calculator
  describe('should be able to correctly calculate current rate', async () => {
    it('0% borrowed (rate: 10%)', async () => {
      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        2000,
        'current rate is wrong'
      )
    })

    it('20% borrowed (rate: 21.67%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(20), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        2167,
        'current rate is wrong'
      )
    })

    it('50% borrowed (rate: 25.16%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(50), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        2516,
        'current rate is wrong'
      )
    })

    it('75% borrowed (rate: 37.64%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(75), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        3764,
        'current rate is wrong'
      )
    })

    it('90% borrowed (rate: 61.51%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(90), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        6151,
        'current rate is wrong'
      )
    })

    it('100% borrowed (rate: 92.33%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(100), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        9233,
        'current rate is wrong'
      )
    })
  })

  describe('should be able to correctly calculate current rate with a linear rate increase', async () => {
    beforeEach(async () => {
      await lendingPool.setRateConstants(1, 2, 1, 0, 0)
    })

    it('0% borrowed (rate: 0%)', async () => {
      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        0,
        'current rate is wrong'
      )
    })

    it('20% borrowed (rate: 10%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(20), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        1000,
        'current rate is wrong'
      )
    })

    it('50% borrowed (rate: 25%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(50), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        2500,
        'current rate is wrong'
      )
    })

    it('75% borrowed (rate: 37.5%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(75), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        3750,
        'current rate is wrong'
      )
    })

    it('100% borrowed (rate: 50%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(100), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        5000,
        'current rate is wrong'
      )
    })
  })

  describe('should be able to correctly calculate current rate with a small curve', async () => {
    beforeEach(async () => {
      await lendingPool.setRateConstants(1, 50, 2, 2, 20)
    })

    it('0% borrowed (rate: 20%)', async () => {
      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        2000,
        'current rate is wrong'
      )
    })

    it('20% borrowed (rate: 30.16%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(20), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        3016,
        'current rate is wrong'
      )
    })

    it('50% borrowed (rate: 46%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(50), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        4600,
        'current rate is wrong'
      )
    })

    it('75% borrowed (rate: 59.75%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(75), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        5975,
        'current rate is wrong'
      )
    })

    it('100% borrowed (rate: 74%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(100), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        7400,
        'current rate is wrong'
      )
    })
  })

  describe('should be able to correctly calculate current rate with a fee cap', async () => {
    beforeEach(async () => {
      await lendingPool.setRateConstants(10, 500, 20, 12, 20)
    })

    it('20% borrowed (rate: 21.66%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(20), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        2166,
        'current rate is wrong'
      )
    })

    it('92% borrowed (rate: 95%)', async () => {
      await token.transferAndCall(lendingPool.address, toEther(92), padBytes('0x0', 32))

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        9500,
        'current rate is wrong'
      )
    })
  })

  it('should be able to getCurrentRateAt with specified percentage', async () => {
    assert.equal(
      (await lendingPool.currentRateAt(toEther(0.5))).toNumber(),
      2516,
      'current rate is wrong'
    )
  })

  it('should be able to distribute rewards and calculate lenders fees', async () => {
    await allowanceToken
      .connect(signers[1])
      .transferAndCall(lendingPool.address, toEther(1000), padBytes('0x0', 32))

    await token.transferAndCall(lendingPool.address, toEther(100), padBytes('0x0', 32))
    await token
      .connect(signers[1])
      .transferAndCall(lendingPool.address, toEther(50), padBytes('0x0', 32))
    await token
      .connect(signers[2])
      .transferAndCall(lendingPool.address, toEther(50), padBytes('0x0', 32))

    await distributeRewards(1000)

    assert.equal(
      fromEther(await borrowingPool.balanceOf(accounts[0])),
      134.515,
      'reward amount does not match'
    )
    assert.equal(
      fromEther(await borrowingPool.balanceOf(accounts[1])),
      67.2575,
      'reward amount does not match'
    )
    assert.equal(
      fromEther(await borrowingPool.balanceOf(accounts[2])),
      67.2575,
      'reward amount does not match'
    )
    assert.equal(
      fromEther(await wbstToken.getUnderlyingByWrapped(await rewardsPool.balanceOf(accounts[0]))),
      415.485,
      'lenders fee amount does not match'
    )
    assert.equal(
      fromEther(await wbstToken.getUnderlyingByWrapped(await rewardsPool.balanceOf(accounts[1]))),
      415.485,
      'lenders fee amount does not match'
    )
  })
})
