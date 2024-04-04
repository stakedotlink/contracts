import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  fromEther,
  deployUpgradeable,
  getAccounts,
  setupToken,
} from '../../utils/helpers'
import { ERC677, StakingPool, StrategyMock } from '../../../typechain-types'
import { ethers } from 'hardhat'
import { Signer } from 'ethers'
import { WithdrawalPool } from '../../../typechain-types/WithdrawalPool'

describe('WithdrawalPool', () => {
  let withdrawalPool: WithdrawalPool
  let stakingPool: StakingPool
  let token: ERC677
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts, true)

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'Staked LINK',
      'stLINK',
      [],
    ])) as StakingPool

    let strategy = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(1000000000),
      toEther(0),
    ])) as StrategyMock

    withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
      token.address,
      stakingPool.address,
      accounts[0],
      toEther(10),
    ])) as WithdrawalPool

    await stakingPool.addStrategy(strategy.address)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])
    await token.approve(stakingPool.address, ethers.constants.MaxUint256)
    await token.approve(withdrawalPool.address, ethers.constants.MaxUint256)
    await stakingPool.approve(withdrawalPool.address, ethers.constants.MaxUint256)

    await stakingPool.deposit(accounts[0], toEther(100000))
    await token.transfer(strategy.address, toEther(100000))
    await stakingPool.updateStrategyRewards([0], '0x')
  })

  it('queueWithdrawal should work correctly', async () => {
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))

    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.address)), 1750)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 1750)
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[0])).map((id) => id.toNumber()),
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
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(400))

    await expect(withdrawalPool.deposit(toEther(1751))).to.be.reverted

    assert.equal(fromEther(await token.balanceOf(withdrawalPool.address)), 400)
    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.address)), 1350)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 1350)
    assert.equal((await withdrawalPool.indexOfNextWithdrawal()).toNumber(), 1)
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
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => d.toNumber()),
      [0, 0, 0]
    )

    await withdrawalPool.deposit(toEther(700))

    assert.equal(fromEther(await token.balanceOf(withdrawalPool.address)), 1100)
    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.address)), 650)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 650)
    assert.equal((await withdrawalPool.indexOfNextWithdrawal()).toNumber(), 2)
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
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => d.toNumber()),
      [2, 0, 0]
    )

    await withdrawalPool.deposit(toEther(650))

    assert.equal(fromEther(await token.balanceOf(withdrawalPool.address)), 1750)
    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.address)), 0)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 0)
    assert.equal((await withdrawalPool.indexOfNextWithdrawal()).toNumber(), 4)
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
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => d.toNumber()),
      [2, 3, 3]
    )
  })

  it('withdraw should work correctly', async () => {
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(1200))

    await expect(withdrawalPool.withdraw([1, 2, 3], [1, 1, 0])).to.be.revertedWith(
      'SenderNotAuthorized()'
    )
    await expect(withdrawalPool.withdraw([1, 3], [1, 1])).to.be.revertedWith(
      'InvalidWithdrawalId()'
    )

    await withdrawalPool.deposit(toEther(550))

    await expect(withdrawalPool.withdraw([1], [2])).to.be.revertedWith('InvalidWithdrawalId()')

    let startingBalance = await token.balanceOf(accounts[1])
    await withdrawalPool.connect(signers[1]).withdraw([2], [2])
    assert.equal(fromEther((await token.balanceOf(accounts[1])).sub(startingBalance)), 250)
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => id.toNumber()),
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
    assert.equal(fromEther((await token.balanceOf(accounts[0])).sub(startingBalance)), 1500)
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => id.toNumber()),
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
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(600))

    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[0])).map((id) => id.toNumber()),
      [1, 3]
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => id.toNumber()),
      [2]
    )

    await withdrawalPool.withdraw([1], [0])

    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[0])).map((id) => id.toNumber()),
      [1, 3]
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => id.toNumber()),
      [2]
    )

    await withdrawalPool.deposit(toEther(1150))
    await withdrawalPool.withdraw([3], [2])

    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[0])).map((id) => id.toNumber()),
      [1]
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => id.toNumber()),
      [2]
    )

    await withdrawalPool.connect(signers[1]).withdraw([2], [2])

    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[0])).map((id) => id.toNumber()),
      [1]
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => id.toNumber()),
      []
    )
  })

  it('getBatchIdsByOwner should work correctly', async () => {
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(600))

    assert.deepEqual(
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => d.toNumber()),
      [0, 0, 0]
    )

    await withdrawalPool.deposit(toEther(500))

    assert.deepEqual(
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => d.toNumber()),
      [2, 0, 0]
    )

    await withdrawalPool.deposit(toEther(50))
    await withdrawalPool.deposit(toEther(50))

    assert.deepEqual(
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => d.toNumber()),
      [2, 0, 0]
    )

    await withdrawalPool.deposit(toEther(550))

    assert.deepEqual(
      (await withdrawalPool.getBatchIds([1, 2, 3])).map((d: any) => d.toNumber()),
      [2, 5, 5]
    )
  })

  it('getFinalizedWithdrawalIdsByOwner should work correctly', async () => {
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000))
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(600))

    let data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[0])
    assert.deepEqual(
      data[0].map((id) => id.toNumber()),
      [1]
    )
    assert.equal(fromEther(data[1]), 600)

    await withdrawalPool.withdraw([1], [0])

    data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[0])
    assert.deepEqual(
      data[0].map((id) => id.toNumber()),
      []
    )
    assert.equal(fromEther(data[1]), 0)

    await withdrawalPool.deposit(toEther(600))

    data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[0])
    assert.deepEqual(
      data[0].map((id) => id.toNumber()),
      [1]
    )
    assert.equal(fromEther(data[1]), 400)

    data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[1])
    assert.deepEqual(
      data[0].map((id) => id.toNumber()),
      [2]
    )
    assert.equal(fromEther(data[1]), 200)

    await withdrawalPool.deposit(toEther(550))

    data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[0])
    assert.deepEqual(
      data[0].map((id) => id.toNumber()),
      [1, 3]
    )
    assert.equal(fromEther(data[1]), 900)

    data = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(accounts[1])
    assert.deepEqual(
      data[0].map((id) => id.toNumber()),
      [2]
    )
    assert.equal(fromEther(data[1]), 250)
  })
})
