import { constants, Signer } from 'ethers'
import {
  toEther,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  deployUpgradeable,
} from '../utils/helpers'
import {
  ERC677,
  PoolRouterMock,
  StakingAllowance,
  DelegatorPool,
  RewardsPool,
  DelegatorPoolV1,
} from '../../typechain-types'
import { assert, expect } from 'chai'
import { defaultAbiCoder } from 'ethers/lib/utils'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { upgradeProxy } from '../../scripts/utils/deployment'

describe('DelegatorPool', () => {
  let token: ERC677
  let allowanceToken: StakingAllowance
  let delegatorPool: DelegatorPool
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
    await allowanceToken.mint(accounts[0], toEther(10000))
    await allowanceToken.transfer(accounts[1], toEther(2000))
    await allowanceToken.transfer(accounts[2], toEther(2000))

    delegatorPool = (await deployUpgradeable('DelegatorPool', [
      allowanceToken.address,
      'Staked Staking Allowance',
      'stSTA',
      [],
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
      'Withdrawal amount exceeds available balance'
    )
  })

  it('should not be able to withdraw more allowance than what is available', async () => {
    await allowanceToken
      .connect(signers[1])
      .transferAndCall(delegatorPool.address, toEther(1000), '0x00')

    await expect(delegatorPool.withdrawAllowance(toEther(1000))).to.be.revertedWith(
      'Withdrawal amount exceeds available balance'
    )
  })

  it('should work without pool router set', async () => {
    let pool = (await deployUpgradeable('DelegatorPool', [
      allowanceToken.address,
      'Staked Staking Allowance',
      'stSTA',
      [],
    ])) as DelegatorPool

    await allowanceToken.transferAndCall(pool.address, toEther(1000), '0x00')
    assert.equal(
      fromEther(await pool.balanceOf(accounts[0])),
      1000,
      'balance of account does not match'
    )

    await expect(pool.withdrawAllowance(toEther(500))).to.be.reverted
  })

  describe('token lockup', async () => {
    beforeEach(async () => {
      await allowanceToken.transferAndCall(
        delegatorPool.address,
        toEther(1000),
        defaultAbiCoder.encode(['uint256'], [toEther(500)])
      )
      await allowanceToken
        .connect(signers[1])
        .transferAndCall(
          delegatorPool.address,
          toEther(1000),
          defaultAbiCoder.encode(['uint256'], [toEther(500)])
        )
    })

    it('onTokenTransfer should lock tokens with calldata', async () => {
      for (let i = 0; i < 2; i++) {
        assert.equal(
          fromEther(await delegatorPool.balanceOf(accounts[i])),
          1000,
          'balance of account does not match'
        )
        assert.equal(
          fromEther(await delegatorPool.availableBalanceOf(accounts[i])),
          500,
          'available balance of account does not match'
        )
        assert.equal(
          fromEther(await delegatorPool.lockedBalanceOf(accounts[i])),
          500,
          'locked balance of account does not match'
        )
      }
      assert.equal(
        fromEther(await delegatorPool.totalLocked()),
        1000,
        'locked balance of account does not match'
      )
    })

    it('onTokenTransfer should not allow more tokens to be locked than transferred', async () => {
      await expect(
        allowanceToken.transferAndCall(
          delegatorPool.address,
          toEther(1000),
          defaultAbiCoder.encode(['uint256'], [toEther(1001)])
        )
      ).to.be.revertedWith('Cannot lock more than transferred value')
    })

    it('staked & totalStaked should not returned locked amount with community rewards pool', async () => {
      assert.equal(
        fromEther(await delegatorPool.staked(accounts[0])),
        1000,
        'staked of account does not match'
      )
      await delegatorPool.setCommunityPool(token.address, true)
      assert.equal(
        fromEther(await delegatorPool.connect(rewardsPool.address).staked(accounts[0])),
        500,
        'staked of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.staked(accounts[0])),
        1000,
        'staked of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.connect(rewardsPool.address).totalStaked()),
        1000,
        'total staked does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.totalStaked()),
        2000,
        'staked of account does not match'
      )
    })

    it('distributeToken should exclude locked staked amounts while distributing rewards', async () => {
      await delegatorPool.setCommunityPool(token.address, true)
      await allowanceToken
        .connect(signers[2])
        .transferAndCall(delegatorPool.address, toEther(1000), '0x00')
      await token.transferAndCall(delegatorPool.address, toEther(100), '0x00')

      assert.equal(
        fromEther(await rewardsPool.withdrawableRewards(accounts[0])),
        25,
        'withdrawable rewards of account do not match'
      )
      assert.equal(
        fromEther(await rewardsPool.withdrawableRewards(accounts[1])),
        25,
        'withdrawable rewards of account do not match'
      )
      assert.equal(
        fromEther(await rewardsPool.withdrawableRewards(accounts[2])),
        50,
        'withdrawable rewards of account do not match'
      )
    })

    it('withdrawAllowance should allow withdrawal of unlocked tokens', async () => {
      await delegatorPool.withdrawAllowance(toEther(500))
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        500,
        'balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.availableBalanceOf(accounts[0])),
        0,
        'available balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.lockedBalanceOf(accounts[0])),
        500,
        'locked balance of account does not match'
      )
    })

    it('withdrawAllowance should not allow withdrawal of locked tokens', async () => {
      await expect(delegatorPool.withdrawAllowance(toEther(501))).to.be.revertedWith(
        'Withdrawal amount exceeds available balance'
      )
    })

    it('setLockedApproval should allow locked tokens to be approved for withdrawal', async () => {
      await delegatorPool.setLockedApproval(accounts[0], toEther(250))
      assert.equal(
        fromEther(await delegatorPool.approvedLockedBalanceOf(accounts[0])),
        250,
        'approved locked balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.availableBalanceOf(accounts[0])),
        750,
        'balance of account does not match'
      )

      await delegatorPool.withdrawAllowance(toEther(750))
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        250,
        'balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.availableBalanceOf(accounts[0])),
        0,
        'available balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.approvedLockedBalanceOf(accounts[0])),
        0,
        'approved locked balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.lockedBalanceOf(accounts[0])),
        250,
        'locked balance of account does not match'
      )
      assert.equal(fromEther(await delegatorPool.totalLocked()), 750, 'total locked does not match')

      await delegatorPool.setLockedApproval(accounts[0], toEther(250))
      await delegatorPool.withdrawAllowance(toEther(250))
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        0,
        'balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.availableBalanceOf(accounts[0])),
        0,
        'available balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.approvedLockedBalanceOf(accounts[0])),
        0,
        'approved locked balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.lockedBalanceOf(accounts[0])),
        0,
        'locked balance of account does not match'
      )
      assert.equal(fromEther(await delegatorPool.totalLocked()), 500, 'total locked does not match')
    })

    it.only('should be able to burn locked balances', async () => {
      await delegatorPool.setLockedApproval(accounts[0], toEther(250))
      await delegatorPool.burnLockedBalance(accounts[0], toEther(500))
      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[0])),
        500,
        'balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.availableBalanceOf(accounts[0])),
        500,
        'available balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.approvedLockedBalanceOf(accounts[0])),
        0,
        'approved locked balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.lockedBalanceOf(accounts[0])),
        0,
        'locked balance of account does not match'
      )
      assert.equal(fromEther(await delegatorPool.totalLocked()), 500, 'total locked does not match')
      assert.equal(
        fromEther(await allowanceToken.totalSupply()),
        9500,
        'total supply does not match'
      )

      await delegatorPool.setLockedApproval(accounts[1], toEther(500))
      await delegatorPool.burnLockedBalance(accounts[1], toEther(250))

      assert.equal(
        fromEther(await delegatorPool.balanceOf(accounts[1])),
        750,
        'balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.availableBalanceOf(accounts[1])),
        750,
        'available balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.approvedLockedBalanceOf(accounts[1])),
        250,
        'approved locked balance of account does not match'
      )
      assert.equal(
        fromEther(await delegatorPool.lockedBalanceOf(accounts[1])),
        0,
        'locked balance of account does not match'
      )
      assert.equal(fromEther(await delegatorPool.totalLocked()), 250, 'total locked does not match')
      assert.equal(
        fromEther(await allowanceToken.totalSupply()),
        9250,
        'total supply does not match'
      )
    })

    it('should not be able to burn more than locked balance', async () => {
      await expect(delegatorPool.burnLockedBalance(accounts[0], toEther(501))).to.be.revertedWith(
        'Cannot burn more than locked balance'
      )
    })
  })

  it('should be able to upgrade from V1 implementation to V2', async () => {
    const cliff = (await time.latest()) + 3600
    const duration = 3600

    const delegatorPoolV1 = (await deployUpgradeable('DelegatorPoolV1', [
      allowanceToken.address,
      'Staked Staking Allowance',
      'stSTA',
    ])) as DelegatorPoolV1

    await allowanceToken.transferAndCall(delegatorPoolV1.address, toEther(500), '0x00')
    await allowanceToken.transferAndCall(
      delegatorPoolV1.address,
      toEther(1000),
      defaultAbiCoder.encode(['uint64', 'uint64'], [cliff, duration])
    )

    const delegatorPoolV2 = (await upgradeProxy(delegatorPoolV1.address, 'DelegatorPool', false, {
      fn: 'initialize',
      args: [constants.AddressZero, '', '', [accounts[0]]],
    })) as DelegatorPool

    assert.equal(
      fromEther(await delegatorPoolV2.balanceOf(accounts[0])),
      1500,
      'balance of account does not match'
    )
    assert.equal(
      fromEther(await delegatorPoolV2.availableBalanceOf(accounts[0])),
      500,
      'available balance of account does not match'
    )
    assert.equal(
      fromEther(await delegatorPoolV2.lockedBalanceOf(accounts[0])),
      1000,
      'locked balance of account does not match'
    )
  })
})
