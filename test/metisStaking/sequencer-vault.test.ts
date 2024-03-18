import { assert, expect } from 'chai'
import { Signer } from 'ethers'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../utils/helpers'
import {
  ERC20,
  SequencerVault,
  MetisLockingPoolMock,
  SequencerVCSMock,
  MetisLockingInfoMock,
} from '../../typechain-types'

describe('SequencerVault', () => {
  let token: ERC20
  let metisLockingInfo: MetisLockingInfoMock
  let metisLockingPool: MetisLockingPoolMock
  let strategy: SequencerVCSMock
  let vault: SequencerVault
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Metis',
      'METIS',
      1000000000,
    ])) as ERC20

    metisLockingInfo = (await deploy('MetisLockingInfoMock', [
      token.address,
      toEther(100),
      toEther(10000),
    ])) as MetisLockingInfoMock

    metisLockingPool = (await deploy('MetisLockingPoolMock', [
      token.address,
      metisLockingInfo.address,
    ])) as MetisLockingPoolMock

    strategy = (await deploy('SequencerVCSMock', [token.address, 1000, 5000])) as SequencerVCSMock

    vault = (await deployUpgradeable('SequencerVault', [
      token.address,
      strategy.address,
      metisLockingPool.address,
      metisLockingInfo.address,
      '0x5555',
      accounts[1],
      accounts[2],
    ])) as SequencerVault

    await strategy.addVault(vault.address)
    await token.approve(strategy.address, toEther(100000000))
  })

  it('deposit should work correctly', async () => {
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(metisLockingInfo.address)), 100)
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)
    assert.equal(fromEther(await vault.unclaimedRewards()), 0)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 100)
    assert.equal((await vault.seqId()).toNumber(), 1)

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(metisLockingInfo.address)), 200)
    assert.equal(fromEther(await vault.getTotalDeposits()), 200)
    assert.equal(fromEther(await vault.unclaimedRewards()), 0)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 200)
    assert.equal((await vault.seqId()).toNumber(), 1)
  })

  it('getPrincipalDeposits should work correctly', async () => {
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    await strategy.deposit(toEther(30))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 130)
  })

  it('getRewards should work correctly', async () => {
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getRewards()), 0)
    await metisLockingPool.addReward(1, toEther(10))
    assert.equal(fromEther(await vault.getRewards()), 10)
  })

  it('getTotalDeposits should work correctly', async () => {
    await strategy.deposit(toEther(100))
    await metisLockingPool.addReward(1, toEther(10))
    assert.equal(fromEther(await vault.getTotalDeposits()), 110)

    await strategy.deposit(toEther(50))
    await metisLockingPool.addReward(1, toEther(15))
    assert.equal(fromEther(await vault.getTotalDeposits()), 175)
  })

  it('getPendingRewards should work correctly', async () => {
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    await metisLockingPool.addReward(1, toEther(10))
    assert.equal(fromEther(await vault.getPendingRewards()), 1)
    await metisLockingPool.addReward(1, toEther(5))
    assert.equal(fromEther(await vault.getPendingRewards()), 1.5)
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getPendingRewards()), 1.5)

    await strategy.updateDeposits(0)
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    await metisLockingPool.addReward(1, toEther(10))
    assert.equal(fromEther(await vault.getPendingRewards()), 1)
  })

  it('updateDeposits should work correctly', async () => {
    await strategy.deposit(toEther(100))
    await metisLockingPool.addReward(1, toEther(10))
    assert.deepEqual(
      (await strategy.callStatic.updateDeposits(0)).map((v: any) => fromEther(v)),
      [110, 1, 0]
    )
    await strategy.updateDeposits(0)
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await metisLockingPool.slashPrincipal(1, toEther(5))
    assert.deepEqual(
      (await strategy.callStatic.updateDeposits(0)).map((v: any) => fromEther(v)),
      [105, 0, 0]
    )
    await strategy.updateDeposits(0)
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await metisLockingPool.addReward(1, toEther(8))
    assert.deepEqual(
      (await strategy.callStatic.updateDeposits(0)).map((v) => fromEther(v)),
      [113, 0.3, 0]
    )
    await strategy.updateDeposits(0)
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1.3)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 113)

    await metisLockingPool.addReward(1, toEther(1))
    assert.deepEqual(
      (await strategy.callStatic.updateDeposits(0)).map((v) => fromEther(v)),
      [114, 0.1, 0]
    )
    await strategy.updateDeposits(0)
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1.4)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 114)

    assert.deepEqual(
      (await strategy.callStatic.updateDeposits(toEther(20))).map((v) => fromEther(v)),
      [114, 0, 0]
    )
    await strategy.updateDeposits(toEther(20))
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1.4)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 114)

    assert.deepEqual(
      (await strategy.callStatic.updateDeposits(toEther(19))).map((v) => fromEther(v)),
      [95, 0, 19]
    )
    await strategy.updateDeposits(toEther(19))
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1.4)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 95)

    await expect(vault.updateDeposits(0, 0)).to.be.revertedWith('SenderNotAuthorized()')
  })

  it('withdrawRewards should work correctly', async () => {
    await strategy.deposit(toEther(100))

    await metisLockingPool.addReward(1, toEther(10))
    await strategy.updateDeposits(0)

    await expect(vault.withdrawRewards()).to.be.revertedWith('SenderNotAuthorized()')

    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await vault.unclaimedRewards()), 0.5)

    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await vault.unclaimedRewards()), 0.25)

    await strategy.setWithdrawalPercentage(10000)
    await vault.connect(signers[2]).withdrawRewards()

    assert.equal(fromEther(await vault.unclaimedRewards()), 0)
  })
})
