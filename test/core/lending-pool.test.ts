import { Signer } from 'ethers'
import { toEther, deploy, getAccounts, setupToken, fromEther } from '../utils/helpers'
import {
  ERC677,
  PoolRouterMock,
  StakingAllowance,
  LendingPool,
  RewardsPool,
} from '../../typechain-types'
import { assert, expect } from 'chai'

describe('LendingPool', () => {
  let token: ERC677
  let allowanceToken: StakingAllowance
  let lendingPool: LendingPool
  let poolRouter: PoolRouterMock
  let rewardsPool: RewardsPool
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

    poolRouter = (await deploy('PoolRouterMock', [
      allowanceToken.address,
      token.address,
      0,
    ])) as PoolRouterMock

    lendingPool = (await deploy('LendingPool', [
      allowanceToken.address,
      'Staked Staking Allowance',
      'stSTA',
      poolRouter.address,
      // Borrower Rate Constants
      10,
      500,
      6,
      12,
      20,
    ])) as LendingPool
    await poolRouter.setLendingPool(lendingPool.address)

    rewardsPool = (await deploy('RewardsPool', [lendingPool.address, token.address])) as RewardsPool
    await lendingPool.addToken(token.address, rewardsPool.address)
  })

  it('should be able to stake allowance', async () => {
    await allowanceToken.transferAndCall(lendingPool.address, toEther(1000), '0x00')

    assert.equal(fromEther(await lendingPool.totalSupply()), 1000, 'total supply does not match')
    assert.equal(
      fromEther(await lendingPool.balanceOf(accounts[0])),
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
    await allowanceToken.transferAndCall(lendingPool.address, toEther(1000), '0x00')
    await token.transferAndCall(lendingPool.address, toEther(100), '0x00')
    assert.equal(fromEther(await rewardsPool.totalRewards()), 100, 'total rewards does not match')
  })

  it('onTokenTransfer should only be callable by authorized tokens', async () => {
    await expect(
      lendingPool.onTokenTransfer(accounts[1], toEther(1001), '0x00')
    ).to.be.revertedWith('Sender must be allowance or rewards token')
  })

  it('should be able to withdraw allowance', async () => {
    await allowanceToken.transferAndCall(lendingPool.address, toEther(1000), '0x00')
    await lendingPool.withdrawAllowance(toEther(500))

    assert.equal(
      fromEther(await lendingPool.totalStaked()),
      500,
      'total allowance staked does not match'
    )
    assert.equal(
      fromEther(await lendingPool.balanceOf(accounts[0])),
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

    await expect(lendingPool.withdrawAllowance(toEther(500))).to.be.revertedWith(
      'Allowance cannot be withdrawn when pools are reserved'
    )
  })

  it('should not be able to withdraw more allowance than what is staked', async () => {
    await allowanceToken.transferAndCall(lendingPool.address, toEther(1000), '0x00')
    await allowanceToken
      .connect(signers[1])
      .transferAndCall(lendingPool.address, toEther(1000), '0x00')

    await expect(lendingPool.withdrawAllowance(toEther(1001))).to.be.revertedWith(
      'ERC20: burn amount exceeds balance'
    )
  })

  it('availableAllowance should return correct amount', async () => {
    await allowanceToken
      .connect(signers[1])
      .transferAndCall(lendingPool.address, toEther(1000), '0x00')

    assert.equal(
      fromEther(await lendingPool.availableAllowance()),
      980,
      'available allowance incorrect'
    )
  })

  it('should not be able to withdraw more allowance than what is available', async () => {
    await allowanceToken
      .connect(signers[1])
      .transferAndCall(lendingPool.address, toEther(1000), '0x00')

    await expect(lendingPool.withdrawAllowance(toEther(1000))).to.be.revertedWith(
      'Insufficient allowance available for withdrawal'
    )
  })

  it('should be able to transfer allowance derivative and withdraw allowance', async () => {
    await allowanceToken.transferAndCall(lendingPool.address, toEther(1000), '0x00')
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

  // Rate set in tests (candidate for production)
  // y\ =\ \left(10\frac{x}{500}\right)^{6}\ +\frac{x}{12}\ +\ 20
  // https://www.desmos.com/calculator
  describe('should be able to correctly calculate current rate', async () => {
    it('0% borrowed (rate: 10%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(50), '0x00')
      assert.equal(
        (await lendingPool.currentRate(accounts[0], 0)).toNumber(),
        2000,
        'current rate is wrong'
      )
    })

    it('20% borrowed (rate: 21.67%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(50), '0x00')

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        2167,
        'current rate is wrong'
      )
    })

    it('50% borrowed (rate: 25.16%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(20), '0x00')

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        2516,
        'current rate is wrong'
      )
    })

    it('75% borrowed (rate: 37.64%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(13.33333333), '0x00')

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        3764,
        'current rate is wrong'
      )
    })

    it('90% borrowed (rate: 61.51%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(11.111111111), '0x00')

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        6151,
        'current rate is wrong'
      )
    })

    it('100% borrowed (rate: 92.33%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(10), '0x00')

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
      await allowanceToken.transferAndCall(lendingPool.address, toEther(50), '0x00')
      assert.equal(
        (await lendingPool.currentRate(accounts[0], 0)).toNumber(),
        0,
        'current rate is wrong'
      )
    })

    it('20% borrowed (rate: 10%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(50), '0x00')

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        1000,
        'current rate is wrong'
      )
    })

    it('50% borrowed (rate: 25%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(20), '0x00')

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        2500,
        'current rate is wrong'
      )
    })

    it('75% borrowed (rate: 37.5%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(13.3333333), '0x00')

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        3750,
        'current rate is wrong'
      )
    })

    it('100% borrowed (rate: 50%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(10), '0x00')

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
      await allowanceToken.transferAndCall(lendingPool.address, toEther(50), '0x00')
      assert.equal(
        (await lendingPool.currentRate(accounts[0], 0)).toNumber(),
        2000,
        'current rate is wrong'
      )
    })

    it('20% borrowed (rate: 30.16%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(50), '0x00')

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        3016,
        'current rate is wrong'
      )
    })

    it('50% borrowed (rate: 46%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(20), '0x00')

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        4600,
        'current rate is wrong'
      )
    })

    it('75% borrowed (rate: 59.75%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(13.3333333), '0x00')

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        5975,
        'current rate is wrong'
      )
    })

    it('100% borrowed (rate: 74%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(10), '0x00')

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
      await allowanceToken.transferAndCall(lendingPool.address, toEther(50), '0x00')

      assert.equal(
        (await lendingPool.currentRate(token.address, 0)).toNumber(),
        2166,
        'current rate is wrong'
      )
    })

    it('92% borrowed (rate: 95%)', async () => {
      await allowanceToken.transferAndCall(lendingPool.address, toEther(10.52631), '0x00')

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
})
