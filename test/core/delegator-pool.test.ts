import { Signer } from 'ethers'
import { toEther, deploy, getAccounts, setupToken, fromEther } from '../utils/helpers'
import {
  ERC677,
  PoolRouterMock,
  StakingAllowance,
  DelegatorPool,
  RewardsPool,
  RampUpCurve,
} from '../../typechain-types'
import { assert, expect } from 'chai'
import { defaultAbiCoder } from 'ethers/lib/utils'
import { time } from '@nomicfoundation/hardhat-network-helpers'

describe('DelegatorPool', () => {
  let token: ERC677
  let allowanceToken: StakingAllowance
  let delegatorPool: DelegatorPool
  let poolRouter: PoolRouterMock
  let rewardsPool: RewardsPool
  let feeCurve: RampUpCurve
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
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

    feeCurve = (await deploy('RampUpCurve', [10, 500, 6, 12, 20])) as RampUpCurve

    delegatorPool = (await deploy('DelegatorPool', [
      allowanceToken.address,
      'Staked Staking Allowance',
      'stSTA',
      feeCurve.address,
    ])) as DelegatorPool

    poolRouter = (await deploy('PoolRouterMock', [
      allowanceToken.address,
      token.address,
      0,
      delegatorPool.address,
    ])) as PoolRouterMock

    await delegatorPool.setPoolRouter(poolRouter.address)

    rewardsPool = (await deploy('RewardsPool', [
      delegatorPool.address,
      token.address,
    ])) as RewardsPool
    await delegatorPool.addToken(token.address, rewardsPool.address)
  })

  it('should be able to stake allowance', async () => {
    await allowanceToken.transferAndCall(delegatorPool.address, toEther(1000), '0x00')

    assert.equal(fromEther(await delegatorPool.totalSupply()), 1000, 'total supply does not match')
    assert.equal(
      fromEther(await delegatorPool.balanceOf(accounts[0])),
      1000,
      'balance of account does not match'
    )
    assert.equal(
      fromEther(await allowanceToken.balanceOf(accounts[0])),
      5000,
      'allowance token balance does not match'
    )
  })

  it('should be able to distribute rewards', async () => {
    await allowanceToken.transferAndCall(delegatorPool.address, toEther(1000), '0x00')
    await token.transferAndCall(delegatorPool.address, toEther(100), '0x00')
    assert.equal(fromEther(await rewardsPool.totalRewards()), 100, 'total rewards does not match')
  })

  it('onTokenTransfer should only be callable by authorized tokens', async () => {
    await expect(
      delegatorPool.onTokenTransfer(accounts[1], toEther(1001), '0x00')
    ).to.be.revertedWith('Sender must be allowance or rewards token')
  })

  it('should be able to withdraw allowance', async () => {
    await allowanceToken.transferAndCall(delegatorPool.address, toEther(1000), '0x00')
    await delegatorPool.withdrawAllowance(toEther(500))

    assert.equal(
      fromEther(await delegatorPool.totalStaked()),
      500,
      'total allowance staked does not match'
    )
    assert.equal(
      fromEther(await delegatorPool.balanceOf(accounts[0])),
      500,
      'balance of account does not match'
    )
    assert.equal(
      fromEther(await allowanceToken.balanceOf(accounts[0])),
      5500,
      'allowance token balance does not match'
    )
  })

  it('should not be able to withdraw allowance when pools are in reserved mode', async () => {
    await poolRouter.setReservedMode(true)

    await expect(delegatorPool.withdrawAllowance(toEther(500))).to.be.revertedWith(
      'Allowance cannot be withdrawn when pools are reserved'
    )
  })

  it('should not be able to withdraw more allowance than what is staked', async () => {
    await allowanceToken.transferAndCall(delegatorPool.address, toEther(1000), '0x00')
    await allowanceToken
      .connect(signers[1])
      .transferAndCall(delegatorPool.address, toEther(1000), '0x00')

    await expect(delegatorPool.withdrawAllowance(toEther(1001))).to.be.revertedWith(
      'Withdrawal amount exceeds balance'
    )
  })

  it('should not be able to withdraw more allowance than what is available', async () => {
    await allowanceToken
      .connect(signers[1])
      .transferAndCall(delegatorPool.address, toEther(1000), '0x00')

    await expect(delegatorPool.withdrawAllowance(toEther(1000))).to.be.revertedWith(
      'Withdrawal amount exceeds balance'
    )
  })

  it('should work without pool router set', async () => {
    let pool = (await deploy('DelegatorPool', [
      allowanceToken.address,
      'Staked Staking Allowance',
      'stSTA',
      feeCurve.address,
    ])) as DelegatorPool

    await allowanceToken.transferAndCall(pool.address, toEther(1000), '0x00')
    assert.equal(
      fromEther(await pool.balanceOf(accounts[0])),
      1000,
      'balance of account does not match'
    )

    await expect(pool.withdrawAllowance(toEther(500))).to.be.reverted
  })

  // Rate set in tests (candidate for production)
  // y\ =\ \left(10\frac{x}{500}\right)^{6}\ +\frac{x}{12}\ +\ 20
  // https://www.desmos.com/calculator
  describe('should be able to correctly calculate current rate', async () => {
    it('0% borrowed (rate: 10%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0))
      assert.equal(
        (await delegatorPool.currentRate(accounts[0], 0)).toNumber(),
        2000,
        'current rate is wrong'
      )
    })

    it('20% borrowed (rate: 21.67%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.2))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        2167,
        'current rate is wrong'
      )
    })

    it('50% borrowed (rate: 25.16%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.5))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        2516,
        'current rate is wrong'
      )
    })

    it('75% borrowed (rate: 37.64%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.75))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        3764,
        'current rate is wrong'
      )
    })

    it('90% borrowed (rate: 61.51%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.9))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        6151,
        'current rate is wrong'
      )
    })

    it('100% borrowed (rate: 92.33%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(1))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        9233,
        'current rate is wrong'
      )
    })
  })

  describe('should be able to correctly calculate current rate with a linear rate increase', async () => {
    beforeEach(async () => {
      await feeCurve.setRateConstants(1, 2, 1, 0, 0)
    })

    it('0% borrowed (rate: 0%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0))
      assert.equal(
        (await delegatorPool.currentRate(accounts[0], 0)).toNumber(),
        0,
        'current rate is wrong'
      )
    })

    it('20% borrowed (rate: 10%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.2))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        1000,
        'current rate is wrong'
      )
    })

    it('50% borrowed (rate: 25%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.5))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        2500,
        'current rate is wrong'
      )
    })

    it('75% borrowed (rate: 37.5%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.75))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        3750,
        'current rate is wrong'
      )
    })

    it('100% borrowed (rate: 50%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(1))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        5000,
        'current rate is wrong'
      )
    })
  })

  describe('should be able to correctly calculate current rate with a small curve', async () => {
    beforeEach(async () => {
      await feeCurve.setRateConstants(1, 50, 2, 2, 20)
    })

    it('0% borrowed (rate: 20%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0))
      assert.equal(
        (await delegatorPool.currentRate(accounts[0], 0)).toNumber(),
        2000,
        'current rate is wrong'
      )
    })

    it('20% borrowed (rate: 30.16%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.2))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        3016,
        'current rate is wrong'
      )
    })

    it('50% borrowed (rate: 46%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.5))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        4600,
        'current rate is wrong'
      )
    })

    it('75% borrowed (rate: 59.75%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.75))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        5975,
        'current rate is wrong'
      )
    })

    it('100% borrowed (rate: 74%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(1))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        7400,
        'current rate is wrong'
      )
    })
  })

  describe('should be able to correctly calculate current rate with a fee cap', async () => {
    beforeEach(async () => {
      await feeCurve.setRateConstants(10, 500, 20, 12, 20)
    })

    it('20% borrowed (rate: 21.66%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.2))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        2166,
        'current rate is wrong'
      )
    })

    it('92% borrowed (rate: 95%)', async () => {
      await poolRouter.setPoolUtilisation(toEther(0.92))
      assert.equal(
        (await delegatorPool.currentRate(token.address, 0)).toNumber(),
        9500,
        'current rate is wrong'
      )
    })
  })

  it('should be able to getCurrentRateAt with specified percentage', async () => {
    assert.equal(
      (await delegatorPool.currentRateAt(toEther(0.5))).toNumber(),
      2516,
      'current rate is wrong'
    )
  })

  describe('token vesting', async () => {
    let cliff: number
    let duration: number

    beforeEach(async () => {
      cliff = (await time.latest()) + 3600
      duration = 3600
      await allowanceToken.transferAndCall(
        delegatorPool.address,
        toEther(1000),
        defaultAbiCoder.encode(['uint64', 'uint64'], [cliff, duration])
      )
    })

    it('should see token vest', async () => {
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        0,
        'balance should be zero'
      )
    })

    it('should not be able to withdraw vested tokens', async () => {
      await expect(delegatorPool.withdrawAllowance(toEther(1000))).to.be.revertedWith(
        'Withdrawal amount exceeds balance'
      )
    })

    it('should see amount staked include vesting', async () => {
      assert.equal(
        fromEther(await delegatorPool.staked(accounts[0])),
        1000,
        'staked balance incorrect'
      )
    })

    it('should receive rewards including those from vesting tokens', async () => {
      await token.transferAndCall(delegatorPool.address, toEther(1000), '0x00')
      assert.equal(
        fromEther(await rewardsPool.totalRewards()),
        1000,
        'rewards balance does not match'
      )
    })

    it('should see able to stake and withdraw tokens without vest', async () => {
      await allowanceToken.transferAndCall(delegatorPool.address, toEther(1000), '0x00')
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        1000,
        'balance does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.staked(accounts[0])),
        2000,
        'staked balance incorrect'
      )
      let balance = fromEther(await allowanceToken.balanceOf(accounts[0]))
      await delegatorPool.withdrawAllowance(toEther(1000))
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        0,
        'balance does not match'
      )
      assert.equal(
        fromEther(await allowanceToken.balanceOf(accounts[0])),
        balance + 1000,
        'staked balance incorrect'
      )
    })

    it('should see zero balance after cliff ends', async () => {
      await time.increaseTo(cliff)
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        0,
        'balance should be zero'
      )
    })

    it('should be able to get 50% of balance during vest', async () => {
      await time.increaseTo(cliff + 1800)
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        500,
        'balance should be zero'
      )
    })

    it('should be able withdraw 50% of vested balance', async () => {
      await time.setNextBlockTimestamp(cliff + 1800)

      await delegatorPool.withdrawAllowance(toEther(500))
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        0,
        'balance should be zero'
      )
      assert.equal(
        fromEther(await delegatorPool.staked(accounts[0])),
        500,
        'staked balance incorrect'
      )
    })

    it('should be able withdraw 50% and then 75% of vested balance', async () => {
      await time.setNextBlockTimestamp(cliff + 1800)
      await delegatorPool.withdrawAllowance(toEther(500))

      await time.setNextBlockTimestamp(cliff + 2700)
      await delegatorPool.withdrawAllowance(toEther(250))
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        0,
        'balance should be zero'
      )
      assert.equal(
        fromEther(await delegatorPool.staked(accounts[0])),
        250,
        'staked balance incorrect'
      )
    })

    it('should be able to withdraw all once vested', async () => {
      await time.setNextBlockTimestamp(cliff + 3600)
      await delegatorPool.withdrawAllowance(toEther(1000))

      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        0,
        'balance should be zero'
      )
      assert.equal(
        fromEther(await delegatorPool.staked(accounts[0])),
        0,
        'staked balance incorrect'
      )
    })

    it('should be able to vest more tokens on a new schedule', async () => {
      await time.setNextBlockTimestamp(cliff + 1800)

      let cliff2 = (await time.latest()) + 7200
      await allowanceToken.transferAndCall(
        delegatorPool.address,
        toEther(1000),
        defaultAbiCoder.encode(['uint64', 'uint64'], [cliff2, duration])
      )

      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        500,
        'balance does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.staked(accounts[0])),
        2000,
        'staked balance incorrect'
      )

      await time.increaseTo(cliff2 + 1800)
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        1250,
        'balance does not match'
      )
    })

    it('should be able to vest more tokens on the same schedule', async () => {
      await time.setNextBlockTimestamp(cliff + 1800)

      await allowanceToken.transferAndCall(
        delegatorPool.address,
        toEther(1000),
        defaultAbiCoder.encode(['uint64', 'uint64'], [cliff, duration])
      )

      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        1000,
        'balance does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.staked(accounts[0])),
        2000,
        'staked balance incorrect'
      )

      await time.increaseTo(cliff + 3600)
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        2000,
        'balance does not match'
      )
    })

    it('should be able to mint allowance directly into vesting', async () => {
      await allowanceToken.mintToContract(
        delegatorPool.address,
        accounts[1],
        toEther(600),
        defaultAbiCoder.encode(['uint64', 'uint64'], [10, 20])
      )

      let vestingSchedule = await delegatorPool.getVestingSchedule(accounts[1])

      assert.equal(fromEther(vestingSchedule[0]), 600, 'total amount does not match')
      assert.equal(vestingSchedule[1].toNumber(), 10, 'start timestamp does not match')
      assert.equal(vestingSchedule[2].toNumber(), 20, 'duration does not match')
    })
  })
})
