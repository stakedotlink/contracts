import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  fromEther,
  deployUpgradeable,
  getAccounts,
  setupToken,
} from '../../utils/helpers'
import {
  ERC677,
  PriorityPool,
  StakingPool,
  StrategyMock,
  WithdrawalPool,
} from '../../../typechain-types'
import { ethers } from 'hardhat'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

describe('WithdrawalPool', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts, true)

    const stakingPool = (await deployUpgradeable('StakingPool', [
      token.target,
      'Staked LINK',
      'stLINK',
      [],
      toEther(10000),
    ])) as StakingPool

    const strategy = (await deployUpgradeable('StrategyMock', [
      token.target,
      stakingPool.target,
      toEther(1000000000),
      toEther(5000),
    ])) as StrategyMock

    const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
      token.target,
      stakingPool.target,
      accounts[0],
      toEther(10),
      86400,
    ])) as WithdrawalPool

    await stakingPool.addStrategy(strategy.target)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])
    await token.approve(stakingPool.target, ethers.MaxUint256)
    await token.approve(withdrawalPool.target, ethers.MaxUint256)
    await stakingPool.approve(withdrawalPool.target, ethers.MaxUint256)

    await stakingPool.deposit(accounts[0], toEther(100000), ['0x'])
    await token.transfer(strategy.target, toEther(100000))
    await stakingPool.updateStrategyRewards([0], '0x')

    return { signers, accounts, token, stakingPool, strategy, withdrawalPool }
  }

  it('queueWithdrawal should work correctly', async () => {
    const { accounts, withdrawalPool, stakingPool } = await loadFixture(deployFixture)

    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))

    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.target)), 1750)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 1750)
    assert.equal(
      fromEther(await withdrawalPool.getAccountTotalQueuedWithdrawals(accounts[0])),
      1500
    )
    assert.equal(fromEther(await withdrawalPool.getAccountTotalQueuedWithdrawals(accounts[1])), 250)

    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[0])).map((id) => Number(id)),
      [1, 3]
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawals([1, 2, 3])).map((d: any) => [
        fromEther(d[0]),
        fromEther(d[1]),
      ]),
      [
        [500, 0],
        [125, 0],
        [250, 0],
      ]
    )
  })

  it('deposit should work correctly', async () => {
    const { accounts, withdrawalPool, stakingPool, token } = await loadFixture(deployFixture)

    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(400))

    await expect(withdrawalPool.deposit(toEther(1751))).to.be.reverted

    assert.equal(fromEther(await token.balanceOf(withdrawalPool.target)), 400)
    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.target)), 1350)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 1350)
    assert.equal(
      fromEther(await withdrawalPool.getAccountTotalQueuedWithdrawals(accounts[0])),
      1100
    )
    assert.equal(fromEther(await withdrawalPool.getAccountTotalQueuedWithdrawals(accounts[1])), 250)
    assert.equal(Number(await withdrawalPool.indexOfNextWithdrawal()), 1)
    assert.deepEqual(
      (await withdrawalPool.getWithdrawals([1, 2, 3])).map((d: any) => [
        fromEther(d[0]),
        fromEther(d[1]),
      ]),
      [
        [300, 400],
        [125, 0],
        [250, 0],
      ]
    )
    assert.deepEqual(
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => Number(d)),
      [0, 0, 0]
    )

    await withdrawalPool.deposit(toEther(700))

    assert.equal(fromEther(await token.balanceOf(withdrawalPool.target)), 1100)
    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.target)), 650)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 650)
    assert.equal(Number(await withdrawalPool.indexOfNextWithdrawal()), 2)
    assert.deepEqual(
      (await withdrawalPool.getWithdrawals([1, 2, 3])).map((d: any) => [
        fromEther(d[0]),
        fromEther(d[1]),
      ]),
      [
        [300, 400],
        [75, 100],
        [250, 0],
      ]
    )
    assert.deepEqual(
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => Number(d)),
      [2, 0, 0]
    )

    await withdrawalPool.deposit(toEther(650))

    assert.equal(fromEther(await token.balanceOf(withdrawalPool.target)), 1750)
    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.target)), 0)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 0)
    assert.equal(Number(await withdrawalPool.indexOfNextWithdrawal()), 4)
    assert.deepEqual(
      (await withdrawalPool.getWithdrawals([1, 2, 3])).map((d: any) => [
        fromEther(d[0]),
        fromEther(d[1]),
      ]),
      [
        [300, 400],
        [75, 100],
        [250, 0],
      ]
    )
    assert.deepEqual(
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => Number(d)),
      [2, 3, 3]
    )
  })

  it('does not discard sub-100 dust shares on partial finalization', async () => {
    const { accounts, withdrawalPool, token } = await loadFixture(deployFixture)

    // share price is 2 tokens/share in this fixture, so toEther(1000) queues 500e18 shares
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))

    // finalize all but 50 wei of shares, leaving sharesRemaining = 50 (< 100 dust threshold)
    await withdrawalPool.deposit(toEther(1000) - 100n)

    const [wd] = await withdrawalPool.getWithdrawals([1])
    // the leftover dust must be retained (not deleted to zero) so its value is not lost
    assert.equal(wd[0], 50n, 'sub-100 dust shares were discarded instead of retained')
    // and it must still be counted in the queued total (50 shares x 2 = 100 wei of stLINK)
    assert.equal(
      await withdrawalPool.getTotalQueuedWithdrawals(),
      100n,
      'dust shares were removed from the queued total'
    )

    // a later deposit finalizes the leftover dust (only 100 wei of stLINK is still queued)
    await withdrawalPool.deposit(100n)

    // the owner can now claim the full value: the already-finalized portion (batch 1) plus the dust
    const startingBalance = await token.balanceOf(accounts[0])
    await withdrawalPool.withdraw([1], [1])
    // essentially the full 1000 stLINK (500 shares x 2) is recovered, dust included — within a few
    // wei of per-batch stakePerShares rounding. The dust value is NOT lost (pre-fix it was zeroed).
    const recovered = (await token.balanceOf(accounts[0])) - startingBalance
    assert.isTrue(recovered >= toEther(1000) - 200n, `dust value lost: only ${recovered} recovered`)
  })

  it('deposit should retain untransferable dust without reporting it as queued', async () => {
    const { signers, accounts, withdrawalPool, stakingPool, strategy, token } = await loadFixture(
      deployFixture
    )

    // a share price of 2.2455 makes shares -> stake -> shares round down twice and lose a share
    await token.transfer(strategy.target, toEther(24550))
    await stakingPool.updateStrategyRewards([0], '0x')

    // finalize everything reported as queued
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.deposit(await withdrawalPool.getTotalQueuedWithdrawals())

    // 1 share remains with the owner, but its 2 wei converts back to 0 shares and cannot be
    // transferred, so it must not be reported as queued
    const [wd] = await withdrawalPool.getWithdrawals([1])
    assert.equal(wd[0], 1n)
    assert.equal(await withdrawalPool.getTotalQueuedWithdrawals(), 0n)

    // the next finalization pays the remainder out with the rest of the withdrawal
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(1000))
    await withdrawalPool.deposit(await withdrawalPool.getTotalQueuedWithdrawals())

    const startingBalance = await token.balanceOf(accounts[0])
    await withdrawalPool.withdraw([1], [...(await withdrawalPool.getBatchIds([1]))])
    const recovered = (await token.balanceOf(accounts[0])) - startingBalance
    assert.equal((await withdrawalPool.getWithdrawals([1]))[0][0], 0n)
    assert.isTrue(
      recovered >= toEther(1000) - 5n && recovered <= toEther(1000),
      `recovered ${recovered}`
    )

    // paying out the remainder must not leave the last claimer short; their withdrawal now
    // carries the next untransferable share
    const startingBalance1 = await token.balanceOf(accounts[1])
    await withdrawalPool
      .connect(signers[1])
      .withdraw([2], [...(await withdrawalPool.getBatchIds([2]))])
    const recovered1 = (await token.balanceOf(accounts[1])) - startingBalance1
    assert.equal((await withdrawalPool.getWithdrawals([2]))[0][0], 1n)
    assert.equal(await withdrawalPool.getTotalQueuedWithdrawals(), 0n)
    assert.isTrue(
      recovered1 >= toEther(1000) - 5n && recovered1 <= toEther(1000),
      `recovered ${recovered1}`
    )
  })

  it('withdraw should work correctly', async () => {
    const { signers, accounts, withdrawalPool, token } = await loadFixture(deployFixture)

    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(1200))

    await expect(withdrawalPool.withdraw([1, 2, 3], [1, 1, 0])).to.be.revertedWithCustomError(
      withdrawalPool,
      'SenderNotAuthorized()'
    )
    await expect(withdrawalPool.withdraw([1, 3], [1, 1])).to.be.revertedWithCustomError(
      withdrawalPool,
      'InvalidWithdrawalId()'
    )

    await withdrawalPool.deposit(toEther(550))

    await expect(withdrawalPool.withdraw([1], [2])).to.be.revertedWithCustomError(
      withdrawalPool,
      'InvalidWithdrawalId()'
    )

    let startingBalance = await token.balanceOf(accounts[1])
    await withdrawalPool.connect(signers[1]).withdraw([2], [2])
    assert.equal(fromEther((await token.balanceOf(accounts[1])) - startingBalance), 250)
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => Number(id)),
      []
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawals([2])).map((d: any) => [
        fromEther(d[0]),
        fromEther(d[1]),
      ]),
      [[0, 0]]
    )

    startingBalance = await token.balanceOf(accounts[0])
    await withdrawalPool.withdraw([1, 3], [1, 2])
    assert.equal(fromEther((await token.balanceOf(accounts[0])) - startingBalance), 1500)
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => Number(id)),
      []
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawals([1, 2, 3])).map((d: any) => [
        fromEther(d[0]),
        fromEther(d[1]),
      ]),
      [
        [0, 0],
        [0, 0],
        [0, 0],
      ]
    )
  })

  it('forceWithdraw should work correctly', async () => {
    const { signers, accounts, withdrawalPool, token } = await loadFixture(deployFixture)

    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(1200))

    // mismatched calldata array lengths revert with a named error rather than reading past an array
    await expect(withdrawalPool.forceWithdraw([1], [1, 2])).to.be.revertedWithCustomError(
      withdrawalPool,
      'InvalidCalldata()'
    )
    // batchId 0 reverts with a named error rather than underflowing withdrawalBatches[batchId - 1]
    await expect(withdrawalPool.forceWithdraw([1], [0])).to.be.revertedWithCustomError(
      withdrawalPool,
      'InvalidWithdrawalId()'
    )

    await expect(withdrawalPool.forceWithdraw([1, 3], [1, 1])).to.be.revertedWithCustomError(
      withdrawalPool,
      'InvalidWithdrawalId()'
    )

    await withdrawalPool.deposit(toEther(550))

    await expect(withdrawalPool.forceWithdraw([1], [2])).to.be.revertedWithCustomError(
      withdrawalPool,
      'InvalidWithdrawalId()'
    )

    let startingBalance1 = await token.balanceOf(accounts[1])
    let startingBalance0 = await token.balanceOf(accounts[0])

    await withdrawalPool.forceWithdraw([2, 1, 3], [2, 1, 2])
    assert.equal(fromEther((await token.balanceOf(accounts[1])) - startingBalance1), 250)
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => Number(id)),
      []
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawals([2])).map((d: any) => [
        fromEther(d[0]),
        fromEther(d[1]),
      ]),
      [[0, 0]]
    )

    assert.equal(fromEther((await token.balanceOf(accounts[0])) - startingBalance0), 1500)
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => Number(id)),
      []
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawals([1, 2, 3])).map((d: any) => [
        fromEther(d[0]),
        fromEther(d[1]),
      ]),
      [
        [0, 0],
        [0, 0],
        [0, 0],
      ]
    )
  })

  it('getWithdrawalIdsByOwner should work correctly', async () => {
    const { signers, accounts, withdrawalPool } = await loadFixture(deployFixture)

    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(600))

    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[0])).map((id) => Number(id)),
      [1, 3]
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => Number(id)),
      [2]
    )

    await withdrawalPool.withdraw([1], [0])

    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[0])).map((id) => Number(id)),
      [1, 3]
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => Number(id)),
      [2]
    )

    await withdrawalPool.deposit(toEther(1150))
    await withdrawalPool.withdraw([3], [2])

    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[0])).map((id) => Number(id)),
      [1]
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => Number(id)),
      [2]
    )

    await withdrawalPool.connect(signers[1]).withdraw([2], [2])

    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[0])).map((id) => Number(id)),
      [1]
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => Number(id)),
      []
    )
  })

  it('getBatchIdsByOwner should work correctly', async () => {
    const { accounts, withdrawalPool } = await loadFixture(deployFixture)

    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(600))

    assert.deepEqual(
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => Number(d)),
      [0, 0, 0]
    )

    await withdrawalPool.deposit(toEther(500))

    assert.deepEqual(
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => Number(d)),
      [2, 0, 0]
    )

    await withdrawalPool.deposit(toEther(50))
    await withdrawalPool.deposit(toEther(50))

    assert.deepEqual(
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => Number(d)),
      [2, 0, 0]
    )

    await withdrawalPool.deposit(toEther(550))

    assert.deepEqual(
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => Number(d)),
      [2, 5, 5]
    )
  })

  it('getFinalizedWithdrawalIdsByOwner should work correctly', async () => {
    const { accounts, withdrawalPool } = await loadFixture(deployFixture)

    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(600))

    let data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[0])
    assert.deepEqual(
      data[0].map((id) => Number(id)),
      [1]
    )
    assert.equal(fromEther(data[1]), 600)

    await withdrawalPool.withdraw([1], [0])

    data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[0])
    assert.deepEqual(
      data[0].map((id) => Number(id)),
      []
    )
    assert.equal(fromEther(data[1]), 0)

    await withdrawalPool.deposit(toEther(600))

    data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[0])
    assert.deepEqual(
      data[0].map((id) => Number(id)),
      [1]
    )
    assert.equal(fromEther(data[1]), 400)

    data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[1])
    assert.deepEqual(
      data[0].map((id) => Number(id)),
      [2]
    )
    assert.equal(fromEther(data[1]), 200)

    await withdrawalPool.deposit(toEther(550))

    data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[0])
    assert.deepEqual(
      data[0].map((id) => Number(id)),
      [1, 3]
    )
    assert.equal(fromEther(data[1]), 900)

    data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[1])
    assert.deepEqual(
      data[0].map((id) => Number(id)),
      [2]
    )
    assert.equal(fromEther(data[1]), 250)
  })

  it('checkUpkeep and performUpkeep should work correctly', async () => {
    const { accounts, stakingPool, token, strategy } = await loadFixture(deployFixture)

    let priorityPool = (await deployUpgradeable('PriorityPool', [
      token.target,
      stakingPool.target,
      accounts[0],
      0,
      0,
      false,
    ])) as PriorityPool
    const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
      stakingPool.target,
      stakingPool.target,
      priorityPool.target,
      toEther(10),
      86400,
    ])) as WithdrawalPool
    await stakingPool.approve(priorityPool.target, ethers.MaxUint256)
    await stakingPool.setPriorityPool(priorityPool.target)
    await priorityPool.setWithdrawalPool(withdrawalPool.target)

    await priorityPool.withdraw(toEther(199000), 0, 0, [], false, true, ['0x'])
    assert.deepEqual(await withdrawalPool.checkUpkeep('0x'), [false, '0x'])
    await expect(withdrawalPool.performUpkeep('0x')).to.be.revertedWithCustomError(
      withdrawalPool,
      'NoUpkeepNeeded()'
    )

    await time.increase(86400)
    assert.deepEqual(await withdrawalPool.checkUpkeep('0x'), [true, '0x'])
    await withdrawalPool.performUpkeep(
      ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']])
    )
    assert.equal(fromEther(await token.balanceOf(withdrawalPool.target)), 195000)
    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.target)), 4000)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 4000)

    await time.increase(86400)
    assert.deepEqual(await withdrawalPool.checkUpkeep('0x'), [false, '0x'])
    await expect(withdrawalPool.performUpkeep('0x')).to.be.revertedWithCustomError(
      withdrawalPool,
      'NoUpkeepNeeded()'
    )

    await strategy.setMinDeposits(toEther(0))
    assert.deepEqual(await withdrawalPool.checkUpkeep('0x'), [true, '0x'])
    await withdrawalPool.performUpkeep(
      ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']])
    )
    assert.equal(fromEther(await token.balanceOf(withdrawalPool.target)), 199000)
    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.target)), 0)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 0)
  })

  it('upkeep and priority pool deposits should ignore untransferable dust', async () => {
    const { accounts, stakingPool, token, strategy } = await loadFixture(deployFixture)

    const priorityPool = (await deployUpgradeable('PriorityPool', [
      token.target,
      stakingPool.target,
      accounts[0],
      0,
      0,
      false,
    ])) as PriorityPool
    const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
      token.target,
      stakingPool.target,
      priorityPool.target,
      toEther(10),
      86400,
    ])) as WithdrawalPool
    await stakingPool.approve(priorityPool.target, ethers.MaxUint256)
    await token.approve(priorityPool.target, ethers.MaxUint256)
    await stakingPool.setPriorityPool(priorityPool.target)
    await priorityPool.setWithdrawalPool(withdrawalPool.target)

    // a share price of 2.2455 makes shares -> stake -> shares round down twice and lose a share
    await token.transfer(strategy.target, toEther(24550))
    await stakingPool.updateStrategyRewards([0], '0x')

    // upkeep finalizes everything reported as queued, leaving 1 untransferable share
    await priorityPool.withdraw(toEther(1000), 0, 0, [], false, true, ['0x'])
    await time.increase(86400)
    await withdrawalPool.performUpkeep(
      ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']])
    )
    const [wd] = await withdrawalPool.getWithdrawals([1])
    assert.equal(wd[0], 1n)

    // deposits must not route the remainder into WithdrawalPool.deposit, where it would revert
    await expect(priorityPool.deposit(toEther(10), false, ['0x'])).to.not.be.reverted

    // balanceOf reports the 2 wei remainder as 0, so canWithdraw only has liquidity to act on it
    // once the pool holds stLINK beyond the queued shares
    await stakingPool.transfer(withdrawalPool.target, 1000)
    await time.increase(86400)
    assert.deepEqual(await withdrawalPool.checkUpkeep('0x'), [false, '0x'])
    await expect(
      withdrawalPool.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']]))
    ).to.be.revertedWithCustomError(withdrawalPool, 'NoUpkeepNeeded()')
  })
})
