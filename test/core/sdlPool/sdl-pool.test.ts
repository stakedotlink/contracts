import { Signer } from 'ethers'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  deployUpgradeable,
} from '../../utils/helpers'
import {
  DelegatorPool,
  ERC677,
  LinearBoostController,
  RewardsPool,
  SDLPool,
  StakingAllowance,
} from '../../../typechain-types'
import { ethers } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'

const DAY = 86400

const parseLocks = (locks: any) =>
  locks.map((l: any) => ({
    amount: fromEther(l.amount),
    boostAmount: Number(fromEther(l.boostAmount).toFixed(4)),
    startTime: l.startTime.toNumber(),
    duration: l.duration.toNumber(),
    expiry: l.expiry.toNumber(),
  }))

describe('SDLPool', () => {
  let sdlToken: StakingAllowance
  let rewardToken: ERC677
  let rewardsPool: RewardsPool
  let boostController: LinearBoostController
  let sdlPool: SDLPool
  let delegatorPool: DelegatorPool
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    sdlToken = (await deploy('StakingAllowance', ['stake.link', 'SDL'])) as StakingAllowance
    rewardToken = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

    await sdlToken.mint(accounts[0], toEther(1000000))
    await setupToken(sdlToken, accounts)

    delegatorPool = (await deployUpgradeable('DelegatorPool', [
      sdlToken.address,
      'Staked SDL',
      'stSDL',
      [],
    ])) as DelegatorPool

    boostController = (await deploy('LinearBoostController', [
      4 * 365 * DAY,
      4,
    ])) as LinearBoostController

    sdlPool = (await deployUpgradeable('SDLPool', [
      'Reward Escrowed SDL',
      'reSDL',
      sdlToken.address,
      boostController.address,
      delegatorPool.address,
    ])) as SDLPool

    rewardsPool = (await deploy('RewardsPool', [
      sdlPool.address,
      rewardToken.address,
    ])) as RewardsPool

    await sdlPool.addToken(rewardToken.address, rewardsPool.address)
  })

  it('token name and symbol should be correct', async () => {
    assert.equal(await sdlPool.name(), 'Reward Escrowed SDL')
    assert.equal(await sdlPool.symbol(), 'reSDL')
  })

  it('should be able to stake without locking', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    await sdlToken
      .connect(signers[2])
      .transferAndCall(
        sdlPool.address,
        toEther(300),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 1000)
    assert.equal(fromEther(await sdlPool.totalStaked()), 1000)
    assert.equal((await sdlPool.lastLockId()).toNumber(), 4)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 1000)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2, 3, 4])), [
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 200, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 300, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 400, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
    ])

    assert.equal(await sdlPool.ownerOf(1), accounts[0])
    assert.equal(await sdlPool.ownerOf(2), accounts[1])
    assert.equal(await sdlPool.ownerOf(3), accounts[2])
    assert.equal(await sdlPool.ownerOf(4), accounts[0])

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 500)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 500)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 2)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [1, 4]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 200)
    assert.equal(fromEther(await sdlPool.staked(accounts[1])), 200)
    assert.equal((await sdlPool.balanceOf(accounts[1])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[1])).map((v) => v.toNumber()),
      [2]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[2])), 300)
    assert.equal(fromEther(await sdlPool.staked(accounts[2])), 300)
    assert.equal((await sdlPool.balanceOf(accounts[2])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[2])).map((v) => v.toNumber()),
      [3]
    )
  })

  it('should be able to stake with locking', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )
    let ts1 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 4 * 365 * DAY])
      )
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken
      .connect(signers[2])
      .transferAndCall(
        sdlPool.address,
        toEther(300),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 100 * DAY])
      )
    let ts3 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )

    assert.equal(Number(fromEther(await sdlPool.totalEffectiveBalance()).toFixed(4)), 1982.1918)
    assert.equal(Number(fromEther(await sdlPool.totalStaked()).toFixed(4)), 1982.1918)
    assert.equal((await sdlPool.lastLockId()).toNumber(), 4)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 1000)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2, 3, 4])), [
      { amount: 100, boostAmount: 100, startTime: ts1, duration: 365 * DAY, expiry: 0 },
      { amount: 200, boostAmount: 800, startTime: ts2, duration: 4 * 365 * DAY, expiry: 0 },
      { amount: 300, boostAmount: 82.1918, startTime: ts3, duration: 100 * DAY, expiry: 0 },
      { amount: 400, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
    ])

    assert.equal(await sdlPool.ownerOf(1), accounts[0])
    assert.equal(await sdlPool.ownerOf(2), accounts[1])
    assert.equal(await sdlPool.ownerOf(3), accounts[2])
    assert.equal(await sdlPool.ownerOf(4), accounts[0])

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 600)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 2)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [1, 4]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 1000)
    assert.equal(fromEther(await sdlPool.staked(accounts[1])), 1000)
    assert.equal((await sdlPool.balanceOf(accounts[1])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[1])).map((v) => v.toNumber()),
      [2]
    )

    assert.equal(
      Number(fromEther(await sdlPool.effectiveBalanceOf(accounts[2])).toFixed(4)),
      382.1918
    )
    assert.equal(Number(fromEther(await sdlPool.staked(accounts[2])).toFixed(4)), 382.1918)
    assert.equal((await sdlPool.balanceOf(accounts[2])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[2])).map((v) => v.toNumber()),
      [3]
    )
  })

  it('should be able to lock an existing stake', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlPool.extendLockDuration(1, 365 * DAY)
    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 200)
    assert.equal(fromEther(await sdlPool.totalStaked()), 200)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 200)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 200)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 100, boostAmount: 100, startTime: ts, duration: 365 * DAY, expiry: 0 },
    ])
  })

  it('should be able extend the duration of a lock', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )
    await sdlPool.extendLockDuration(1, 2 * 365 * DAY)
    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 300)
    assert.equal(fromEther(await sdlPool.totalStaked()), 300)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 300)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 300)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 100, boostAmount: 200, startTime: ts, duration: 2 * 365 * DAY, expiry: 0 },
    ])
  })

  it('should be able add more stake without locking', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(200),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
    )

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 300)
    assert.equal(fromEther(await sdlPool.totalStaked()), 300)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 300)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 300)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 300, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
    ])
  })

  it('should be able to add more stake to a lock with and without extending the duration', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(200),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 365 * DAY])
    )
    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 600)
    assert.equal(fromEther(await sdlPool.totalStaked()), 600)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 600)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 300, boostAmount: 300, startTime: ts, duration: 365 * DAY, expiry: 0 },
    ])

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(200),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 2 * 365 * DAY])
    )
    ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 1500)
    assert.equal(fromEther(await sdlPool.totalStaked()), 1500)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 1500)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 1500)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      { amount: 500, boostAmount: 1000, startTime: ts, duration: 2 * 365 * DAY, expiry: 0 },
    ])
  })

  it('should not be able to stake 0 when creating or updating a lock', async () => {
    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        0,
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    ).to.be.revertedWith('InvalidValue()')
    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        0,
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
      )
    ).to.be.revertedWith('InvalidValue()')

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        0,
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
      )
    ).to.be.revertedWith('InvalidValue()')
    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        0,
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 365 * DAY])
      )
    ).to.be.revertedWith('InvalidValue()')
  })

  it('should not be able to decrease the duration of a lock', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )

    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        toEther(10),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 365 * DAY - 1])
      )
    ).to.be.revertedWith('InvalidLockingDuration()')
    await expect(sdlPool.extendLockDuration(1, 365 * DAY - 1)).to.be.revertedWith(
      'InvalidLockingDuration()'
    )
  })

  it('should not be able to extend the duration of a lock to 0', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )

    await expect(sdlPool.extendLockDuration(1, 0)).to.be.revertedWith('InvalidLockingDuration()')
  })

  it('only the lock owner should be able to update a lock, lock id must be valid', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )

    await expect(sdlPool.connect(signers[1]).extendLockDuration(1, 366 * DAY)).to.be.revertedWith(
      'SenderNotAuthorized()'
    )
    await expect(sdlPool.extendLockDuration(2, 366 * DAY)).to.be.revertedWith('InvalidLockId()')
    await expect(
      sdlToken
        .connect(signers[2])
        .transferAndCall(
          sdlPool.address,
          toEther(100),
          ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 365 * DAY])
        )
    ).to.be.revertedWith('SenderNotAuthorized()')
    await expect(
      sdlToken.transferAndCall(
        sdlPool.address,
        toEther(100),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [2, 365 * DAY])
      )
    ).to.be.revertedWith('InvalidLockId()')
  })

  it('should be able to initiate an unlock', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )
    let ts1 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 100)
    assert.equal(fromEther(await sdlPool.totalStaked()), 100)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 100)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 100)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 100,
        boostAmount: 0,
        startTime: ts1,
        duration: 365 * DAY,
        expiry: ts2 + (365 / 2) * DAY,
      },
    ])
  })

  it('should not be able to initiate unlock until half of locking period has elapsed', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )
    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await time.setNextBlockTimestamp(ts + (365 / 2) * DAY - 1)
    await expect(sdlPool.initiateUnlock(1)).to.be.revertedWith('HalfDurationNotElapsed()')
    await time.setNextBlockTimestamp(ts + (365 / 2) * DAY)
    await sdlPool.initiateUnlock(1)
  })

  it('only the lock owner should be able to initiate an unlock, lock id must be valid', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )
    await time.increase(365 * DAY)
    await expect(sdlPool.connect(signers[1]).initiateUnlock(1)).to.be.revertedWith(
      'SenderNotAuthorized()'
    )
    await expect(sdlPool.initiateUnlock(2)).to.be.revertedWith('InvalidLockId()')
  })

  it('should be able to update a lock after an unlock has been initiated', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )
    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 365 * DAY])
    )
    let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 400)
    assert.equal(fromEther(await sdlPool.totalStaked()), 400)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 400)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 400)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 200,
        boostAmount: 200,
        startTime: ts,
        duration: 365 * DAY,
        expiry: 0,
      },
    ])

    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    await sdlPool.extendLockDuration(1, 2 * 365 * DAY)
    ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 600)
    assert.equal(fromEther(await sdlPool.totalStaked()), 600)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 600)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 200,
        boostAmount: 400,
        startTime: ts,
        duration: 2 * 365 * DAY,
        expiry: 0,
      },
    ])
  })

  it('should be able to update a lock after a lock has been fully unlocked', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )
    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    await time.increase(200 * DAY)
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
    )

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 200)
    assert.equal(fromEther(await sdlPool.totalStaked()), 200)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 200)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 200)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 200,
        boostAmount: 0,
        startTime: 0,
        duration: 0,
        expiry: 0,
      },
    ])
  })

  it('should be able to withdraw and burn lock NFT', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )
    let ts1 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await time.increase(200 * DAY)

    let startingBalance = await sdlToken.balanceOf(accounts[0])
    await sdlPool.withdraw(1, toEther(20))

    assert.equal(fromEther((await sdlToken.balanceOf(accounts[0])).sub(startingBalance)), 20)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 80)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 80)
    assert.equal(fromEther(await sdlPool.totalStaked()), 80)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 80)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 80)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 80,
        boostAmount: 0,
        startTime: ts1,
        duration: 365 * DAY,
        expiry: ts2 + (365 / 2) * DAY,
      },
    ])

    startingBalance = await sdlToken.balanceOf(accounts[0])
    await sdlPool.withdraw(1, toEther(80))

    assert.equal(fromEther((await sdlToken.balanceOf(accounts[0])).sub(startingBalance)), 80)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 0)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 0)
    assert.equal(fromEther(await sdlPool.totalStaked()), 0)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 0)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 0)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      []
    )
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 0)
    await expect(sdlPool.ownerOf(1)).to.be.revertedWith('InvalidLockId()')
  })

  it('should be able withdraw tokens that were never locked', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )

    let startingBalance = await sdlToken.balanceOf(accounts[0])
    await sdlPool.withdraw(1, toEther(20))

    assert.equal(fromEther((await sdlToken.balanceOf(accounts[0])).sub(startingBalance)), 20)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 80)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 80)
    assert.equal(fromEther(await sdlPool.totalStaked()), 80)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 80)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 80)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1])), [
      {
        amount: 80,
        boostAmount: 0,
        startTime: 0,
        duration: 0,
        expiry: 0,
      },
    ])

    startingBalance = await sdlToken.balanceOf(accounts[0])
    await sdlPool.withdraw(1, toEther(80))

    assert.equal(fromEther((await sdlToken.balanceOf(accounts[0])).sub(startingBalance)), 80)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 0)
    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 0)
    assert.equal(fromEther(await sdlPool.totalStaked()), 0)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 0)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 0)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      []
    )
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 0)
    await expect(sdlPool.ownerOf(1)).to.be.revertedWith('InvalidLockId()')
  })

  it('should only be able to withdraw once full lock period has elapsed', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )

    await expect(sdlPool.withdraw(1, toEther(1))).to.be.revertedWith('UnlockNotInitiated()')

    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)

    await expect(sdlPool.withdraw(1, toEther(1))).to.be.revertedWith('TotalDurationNotElapsed()')

    await time.increase(200 * DAY)
    sdlPool.withdraw(1, toEther(1))
  })

  it('only the lock owner should be able to withdraw, lock id must be valid', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
    )

    await time.increase(200 * DAY)
    await sdlPool.initiateUnlock(1)
    await time.increase(200 * DAY)

    await expect(sdlPool.connect(signers[1]).withdraw(1, toEther(1))).to.be.revertedWith(
      'SenderNotAuthorized()'
    )
    await expect(sdlPool.withdraw(2, toEther(1))).to.be.revertedWith('InvalidLockId()')

    sdlPool.withdraw(1, toEther(1))
  })

  it('should be able to transfer ownership of locks using transferFrom', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
      )
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken
      .connect(signers[2])
      .transferAndCall(
        sdlPool.address,
        toEther(300),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 2 * 365 * DAY])
      )
    let ts3 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 3 * 365 * DAY])
    )
    let ts4 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    await sdlPool.transferFrom(accounts[0], accounts[1], 1)
    await sdlPool.connect(signers[2]).transferFrom(accounts[2], accounts[3], 3)

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 3000)
    assert.equal(fromEther(await sdlPool.totalStaked()), 3000)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2, 3, 4])), [
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 200, boostAmount: 200, startTime: ts2, duration: 365 * DAY, expiry: 0 },
      { amount: 300, boostAmount: 600, startTime: ts3, duration: 2 * 365 * DAY, expiry: 0 },
      { amount: 400, boostAmount: 1200, startTime: ts4, duration: 3 * 365 * DAY, expiry: 0 },
    ])

    assert.equal(await sdlPool.ownerOf(1), accounts[1])
    assert.equal(await sdlPool.ownerOf(2), accounts[1])
    assert.equal(await sdlPool.ownerOf(3), accounts[3])
    assert.equal(await sdlPool.ownerOf(4), accounts[0])

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 1600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 1600)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [4]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 500)
    assert.equal(fromEther(await sdlPool.staked(accounts[1])), 500)
    assert.equal((await sdlPool.balanceOf(accounts[1])).toNumber(), 2)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[1])).map((v) => v.toNumber()),
      [1, 2]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[2])), 0)
    assert.equal(fromEther(await sdlPool.staked(accounts[2])), 0)
    assert.equal((await sdlPool.balanceOf(accounts[2])).toNumber(), 0)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[2])).map((v) => v.toNumber()),
      []
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[3])), 900)
    assert.equal(fromEther(await sdlPool.staked(accounts[3])), 900)
    assert.equal((await sdlPool.balanceOf(accounts[3])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[3])).map((v) => v.toNumber()),
      [3]
    )
  })

  it('should be able to transfer ownership of locks using safeTransferFrom', async () => {
    const receiver = await deploy('ERC721ReceiverMock')

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
      )
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken
      .connect(signers[2])
      .transferAndCall(
        sdlPool.address,
        toEther(300),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 2 * 365 * DAY])
      )
    let ts3 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 3 * 365 * DAY])
    )
    let ts4 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    await sdlPool.functions['safeTransferFrom(address,address,uint256)'](
      accounts[0],
      accounts[1],
      1
    )
    await sdlPool
      .connect(signers[2])
      .functions['safeTransferFrom(address,address,uint256)'](accounts[2], receiver.address, 3)

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 3000)
    assert.equal(fromEther(await sdlPool.totalStaked()), 3000)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2, 3, 4])), [
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 200, boostAmount: 200, startTime: ts2, duration: 365 * DAY, expiry: 0 },
      { amount: 300, boostAmount: 600, startTime: ts3, duration: 2 * 365 * DAY, expiry: 0 },
      { amount: 400, boostAmount: 1200, startTime: ts4, duration: 3 * 365 * DAY, expiry: 0 },
    ])

    assert.equal(await sdlPool.ownerOf(1), accounts[1])
    assert.equal(await sdlPool.ownerOf(2), accounts[1])
    assert.equal(await sdlPool.ownerOf(3), receiver.address)
    assert.equal(await sdlPool.ownerOf(4), accounts[0])

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 1600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 1600)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [4]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 500)
    assert.equal(fromEther(await sdlPool.staked(accounts[1])), 500)
    assert.equal((await sdlPool.balanceOf(accounts[1])).toNumber(), 2)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[1])).map((v) => v.toNumber()),
      [1, 2]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[2])), 0)
    assert.equal(fromEther(await sdlPool.staked(accounts[2])), 0)
    assert.equal((await sdlPool.balanceOf(accounts[2])).toNumber(), 0)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[2])).map((v) => v.toNumber()),
      []
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(receiver.address)), 900)
    assert.equal(fromEther(await sdlPool.staked(receiver.address)), 900)
    assert.equal((await sdlPool.balanceOf(receiver.address)).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(receiver.address)).map((v) => v.toNumber()),
      [3]
    )
    assert.deepEqual(
      await receiver.getData().then((d: any) => ({
        operator: d[0].operator,
        from: d[0].from,
        tokenId: d[0].tokenId.toNumber(),
        data: d[0].data,
      })),
      {
        operator: accounts[2],
        from: accounts[2],
        tokenId: 3,
        data: '0x',
      }
    )
  })

  it('should be able to transfer ownership of locks using safeTransferFrom with data', async () => {
    const receiver = await deploy('ERC721ReceiverMock')

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(200),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 365 * DAY])
      )
    let ts2 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken
      .connect(signers[2])
      .transferAndCall(
        sdlPool.address,
        toEther(300),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 2 * 365 * DAY])
      )
    let ts3 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(400),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 3 * 365 * DAY])
    )
    let ts4 = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp

    await sdlPool.functions['safeTransferFrom(address,address,uint256,bytes)'](
      accounts[0],
      accounts[1],
      1,
      '0x'
    )
    await sdlPool
      .connect(signers[2])
      .functions['safeTransferFrom(address,address,uint256,bytes)'](
        accounts[2],
        receiver.address,
        3,
        '0x01'
      )

    assert.equal(fromEther(await sdlPool.totalEffectiveBalance()), 3000)
    assert.equal(fromEther(await sdlPool.totalStaked()), 3000)
    assert.deepEqual(parseLocks(await sdlPool.getLocks([1, 2, 3, 4])), [
      { amount: 100, boostAmount: 0, startTime: 0, duration: 0, expiry: 0 },
      { amount: 200, boostAmount: 200, startTime: ts2, duration: 365 * DAY, expiry: 0 },
      { amount: 300, boostAmount: 600, startTime: ts3, duration: 2 * 365 * DAY, expiry: 0 },
      { amount: 400, boostAmount: 1200, startTime: ts4, duration: 3 * 365 * DAY, expiry: 0 },
    ])

    assert.equal(await sdlPool.ownerOf(1), accounts[1])
    assert.equal(await sdlPool.ownerOf(2), accounts[1])
    assert.equal(await sdlPool.ownerOf(3), receiver.address)
    assert.equal(await sdlPool.ownerOf(4), accounts[0])

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 1600)
    assert.equal(fromEther(await sdlPool.staked(accounts[0])), 1600)
    assert.equal((await sdlPool.balanceOf(accounts[0])).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[0])).map((v) => v.toNumber()),
      [4]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 500)
    assert.equal(fromEther(await sdlPool.staked(accounts[1])), 500)
    assert.equal((await sdlPool.balanceOf(accounts[1])).toNumber(), 2)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[1])).map((v) => v.toNumber()),
      [1, 2]
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[2])), 0)
    assert.equal(fromEther(await sdlPool.staked(accounts[2])), 0)
    assert.equal((await sdlPool.balanceOf(accounts[2])).toNumber(), 0)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(accounts[2])).map((v) => v.toNumber()),
      []
    )

    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(receiver.address)), 900)
    assert.equal(fromEther(await sdlPool.staked(receiver.address)), 900)
    assert.equal((await sdlPool.balanceOf(receiver.address)).toNumber(), 1)
    assert.deepEqual(
      (await sdlPool.getLockIdsByOwner(receiver.address)).map((v) => v.toNumber()),
      [3]
    )
    assert.deepEqual(
      await receiver.getData().then((d: any) => ({
        operator: d[0].operator,
        from: d[0].from,
        tokenId: d[0].tokenId.toNumber(),
        data: d[0].data,
      })),
      {
        operator: accounts[2],
        from: accounts[2],
        tokenId: 3,
        data: '0x01',
      }
    )
  })

  it('safeTransferFrom should revert on transfer to non ERC721 receivers', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )

    await expect(
      sdlPool.functions['safeTransferFrom(address,address,uint256,bytes)'](
        accounts[0],
        sdlToken.address,
        1,
        '0x'
      )
    ).to.be.revertedWith('TransferToNonERC721Implementer()')
    await expect(
      sdlPool.functions['safeTransferFrom(address,address,uint256,bytes)'](
        accounts[0],
        sdlToken.address,
        1,
        '0x01'
      )
    ).to.be.revertedWith('TransferToNonERC721Implementer()')
  })

  it('token approvals should work correctly', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )

    await expect(sdlPool.connect(signers[2]).approve(accounts[1], 1)).to.be.revertedWith(
      'SenderNotAuthorized()'
    )
    await expect(sdlPool.approve(accounts[1], 3)).to.be.revertedWith('InvalidLockId()')
    await expect(sdlPool.approve(accounts[0], 1)).to.be.revertedWith('ApprovalToCurrentOwner()')
    await expect(sdlPool.getApproved(3)).to.be.revertedWith('InvalidLockId()')

    await sdlPool.approve(accounts[1], 1)
    await sdlPool.approve(accounts[2], 2)
    assert.equal(await sdlPool.getApproved(1), accounts[1])
    assert.equal(await sdlPool.getApproved(2), accounts[2])

    await sdlPool.connect(signers[1]).transferFrom(accounts[0], accounts[1], 1)
    await sdlPool
      .connect(signers[2])
      .functions['safeTransferFrom(address,address,uint256)'](accounts[0], accounts[2], 2)

    assert.equal(await sdlPool.getApproved(1), ethers.constants.AddressZero)
    assert.equal(await sdlPool.getApproved(2), ethers.constants.AddressZero)

    await sdlPool.connect(signers[1]).approve(accounts[2], 1)
    assert.equal(await sdlPool.getApproved(1), accounts[2])
    await sdlPool.connect(signers[1]).approve(ethers.constants.AddressZero, 1)
    assert.equal(await sdlPool.getApproved(1), ethers.constants.AddressZero)
  })

  it('operator approvals should work correctly', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )

    await sdlPool.setApprovalForAll(accounts[1], true)
    await sdlPool.setApprovalForAll(accounts[2], true)

    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[1]), true)
    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[2]), true)

    await sdlPool.connect(signers[1]).transferFrom(accounts[0], accounts[1], 1)
    await sdlPool
      .connect(signers[2])
      .functions['safeTransferFrom(address,address,uint256)'](accounts[0], accounts[2], 2)
    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[1]), true)
    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[2]), true)

    await sdlPool.setApprovalForAll(accounts[1], false)
    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[1]), false)
    assert.equal(await sdlPool.isApprovedForAll(accounts[0], accounts[2]), true)
  })

  it('should be able to distribute rewards', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    assert.equal(fromEther(await rewardsPool.withdrawableRewards(accounts[0])), 1000)
  })

  it('creating, modifying, or transferring locks should update rewards', async () => {
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 0)

    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
    )
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 1000)

    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    await sdlToken.transferAndCall(
      sdlPool.address,
      toEther(100),
      ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [1, 0])
    )
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 2000)

    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    await sdlPool.extendLockDuration(2, 10000)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 3000)

    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    await time.increase(5000)
    await sdlPool.initiateUnlock(2)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 4000)

    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    await time.increase(5000)
    await sdlPool.withdraw(2, toEther(10))
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 5000)

    await sdlToken
      .connect(signers[1])
      .transferAndCall(
        sdlPool.address,
        toEther(290),
        ethers.utils.defaultAbiCoder.encode(['uint256', 'uint64'], [0, 0])
      )
    await rewardToken.transferAndCall(sdlPool.address, toEther(1000), '0x')
    await sdlPool.transferFrom(accounts[0], accounts[1], 1)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[0])), 5500)
    assert.equal(fromEther(await rewardsPool.userRewards(accounts[1])), 500)
  })

  it('migration from delegator pool should work correctly', async () => {
    let dpRewardsPool = (await deploy('RewardsPool', [
      delegatorPool.address,
      rewardToken.address,
    ])) as RewardsPool

    await delegatorPool.addToken(rewardToken.address, dpRewardsPool.address)

    for (let i = 0; i < 2; i++) {
      await sdlToken.connect(signers[i]).transferAndCall(delegatorPool.address, toEther(250), '0x')
      assert.equal(fromEther(await delegatorPool.balanceOf(accounts[i])), 250)
      assert.equal(fromEther(await delegatorPool.availableBalanceOf(accounts[i])), 250)
      assert.equal(fromEther(await delegatorPool.lockedBalanceOf(accounts[i])), 0)
    }
    for (let i = 2; i < 4; i++) {
      await sdlToken
        .connect(signers[i])
        .transferAndCall(
          delegatorPool.address,
          toEther(1000),
          ethers.utils.defaultAbiCoder.encode(['uint256'], [toEther(400)])
        )
      assert.equal(fromEther(await delegatorPool.balanceOf(accounts[i])), 1000)
      assert.equal(fromEther(await delegatorPool.availableBalanceOf(accounts[i])), 600)
      assert.equal(fromEther(await delegatorPool.lockedBalanceOf(accounts[i])), 400)
    }
    await rewardToken.transferAndCall(delegatorPool.address, toEther(1000), '0x')
    await rewardToken.transfer(accounts[5], await rewardToken.balanceOf(accounts[0]))
    assert.equal(fromEther(await sdlToken.balanceOf(delegatorPool.address)), 2500)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 0)

    await expect(delegatorPool.migrate(toEther(10), 0)).to.be.revertedWith(
      'Cannot migrate until contract is retired'
    )
    await expect(sdlPool.migrate(accounts[2], toEther(100), 0)).to.be.revertedWith(
      'SenderNotAuthorized()'
    )

    await delegatorPool.retireDelegatorPool([accounts[2], accounts[3]], sdlPool.address)
    assert.equal(fromEther(await sdlToken.balanceOf(delegatorPool.address)), 500)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 1200)
    assert.equal(fromEther(await delegatorPool.totalSupply()), 500)
    for (let i = 2; i < 4; i++) {
      assert.equal(fromEther(await delegatorPool.balanceOf(accounts[i])), 0)
      assert.equal(fromEther(await delegatorPool.availableBalanceOf(accounts[i])), 0)
      assert.equal(fromEther(await delegatorPool.lockedBalanceOf(accounts[i])), 0)
      assert.equal(fromEther(await delegatorPool.approvedLockedBalanceOf(accounts[i])), 0)
      assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[i])), 600)
      assert.equal(fromEther(await rewardToken.balanceOf(accounts[i])), 400)
    }

    await delegatorPool.migrate(toEther(100), 0)
    assert.equal(fromEther(await sdlToken.balanceOf(delegatorPool.address)), 400)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 1300)
    assert.equal(fromEther(await delegatorPool.totalSupply()), 400)
    assert.equal(fromEther(await delegatorPool.balanceOf(accounts[0])), 150)
    assert.equal(fromEther(await delegatorPool.availableBalanceOf(accounts[0])), 150)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 100)
    assert.equal(fromEther(await rewardToken.balanceOf(accounts[0])), 100)

    await expect(delegatorPool.migrate(toEther(200), 0)).to.be.revertedWith('Insufficient balance')
    await expect(delegatorPool.migrate(0, 0)).to.be.revertedWith('Invalid amount')

    await delegatorPool.migrate(toEther(150), 0)
    assert.equal(fromEther(await sdlToken.balanceOf(delegatorPool.address)), 250)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 1450)
    assert.equal(fromEther(await delegatorPool.totalSupply()), 250)
    assert.equal(fromEther(await delegatorPool.balanceOf(accounts[0])), 0)
    assert.equal(fromEther(await delegatorPool.availableBalanceOf(accounts[0])), 0)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[0])), 250)
    assert.equal(fromEther(await rewardToken.balanceOf(accounts[0])), 100)

    await delegatorPool.connect(signers[1]).migrate(toEther(100), 365 * DAY)
    assert.equal(fromEther(await sdlToken.balanceOf(delegatorPool.address)), 150)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 1550)
    assert.equal(fromEther(await delegatorPool.totalSupply()), 150)
    assert.equal(fromEther(await delegatorPool.balanceOf(accounts[1])), 150)
    assert.equal(fromEther(await delegatorPool.availableBalanceOf(accounts[1])), 150)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 200)
    assert.equal(fromEther(await rewardToken.balanceOf(accounts[1])), 100)

    await delegatorPool.connect(signers[1]).migrate(toEther(150), 2 * 365 * DAY)
    assert.equal(fromEther(await sdlToken.balanceOf(delegatorPool.address)), 0)
    assert.equal(fromEther(await sdlToken.balanceOf(sdlPool.address)), 1700)
    assert.equal(fromEther(await delegatorPool.totalSupply()), 0)
    assert.equal(fromEther(await delegatorPool.balanceOf(accounts[1])), 0)
    assert.equal(fromEther(await delegatorPool.availableBalanceOf(accounts[1])), 0)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 650)
    assert.equal(fromEther(await rewardToken.balanceOf(accounts[1])), 100)
  })
})
