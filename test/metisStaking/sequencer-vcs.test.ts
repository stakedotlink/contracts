import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import {
  StakingPool,
  ERC20,
  MetisLockingInfoMock,
  MetisLockingPoolMock,
  SequencerVCS,
  SequencerVault,
  SequencerVaultV2Mock,
} from '../../typechain-types'
import { Signer } from 'ethers'
import { Interface } from 'ethers/lib/utils'

describe('SequencerVCS', () => {
  let token: ERC20
  let metisLockingInfo: MetisLockingInfoMock
  let metisLockingPool: MetisLockingPoolMock
  let strategy: SequencerVCS
  let stakingPool: StakingPool
  let vaults: string[]
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
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
      toEther(1000),
    ])) as MetisLockingInfoMock

    metisLockingPool = (await deploy('MetisLockingPoolMock', [
      token.address,
      metisLockingInfo.address,
    ])) as MetisLockingPoolMock

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'Staked LINK',
      'stLINK',
      [],
    ])) as StakingPool

    let vaultImplementation = await deployImplementation('SequencerVault')

    strategy = (await deployUpgradeable('SequencerVCS', [
      token.address,
      stakingPool.address,
      metisLockingInfo.address,
      accounts[0],
      vaultImplementation,
      accounts[1],
      [[accounts[4], 500]],
      1000,
    ])) as SequencerVCS

    await strategy.setCCIPController(accounts[0])
    await metisLockingInfo.setManager(metisLockingPool.address)
    await stakingPool.addStrategy(strategy.address)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    for (let i = 0; i < 5; i++) {
      await strategy.addVault('0x5555', accounts[1], accounts[2])
    }

    vaults = await strategy.getVaults()

    await token.approve(stakingPool.address, ethers.constants.MaxUint256)
    await signers[0].sendTransaction({ to: strategy.address, value: toEther(10) })
  })

  it('getVaults should work correctly', async () => {
    assert.deepEqual(await strategy.getVaults(), vaults)
  })

  it('should be able to add vault', async () => {
    await strategy.addVault('0x6666', accounts[2], accounts[5])
    assert.equal((await strategy.getVaults()).length, 6)
    let vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[5])
    assert.equal(await vault.token(), token.address)
    assert.equal(await vault.vaultController(), strategy.address)
    assert.equal(await vault.lockingPool(), metisLockingPool.address)
    assert.equal(await vault.pubkey(), '0x6666')
    assert.equal((await vault.functions.signer()) as any, accounts[2])
    assert.equal((await vault.seqId()).toNumber(), 0)
    assert.equal(await vault.rewardsReceiver(), accounts[5])
  })

  it('deposit should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(50))
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 50)

    await stakingPool.deposit(accounts[0], toEther(200))
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 250)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 250)
  })

  it('depositQueuedTokens should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(5000))
    await strategy.depositQueuedTokens([1, 4], [toEther(500), toEther(700)])

    assert.equal(fromEther(await strategy.getTotalDeposits()), 5000)
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 3800)
    assert.equal(fromEther(await token.balanceOf(metisLockingInfo.address)), 1200)

    let vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[1])
    assert.equal(fromEther(await vault.getTotalDeposits()), 500)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 500)

    vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[4])
    assert.equal(fromEther(await vault.getTotalDeposits()), 700)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 700)
  })

  it('getDepositChange should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(5000))
    await strategy.depositQueuedTokens([1, 4], [toEther(500), toEther(700)])

    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await metisLockingPool.addReward(1, toEther(100))
    assert.equal(fromEther(await strategy.getDepositChange()), 100)

    await metisLockingPool.addReward(2, toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 150)

    await token.transfer(strategy.address, toEther(25))
    assert.equal(fromEther(await strategy.getDepositChange()), 175)

    await stakingPool.updateStrategyRewards([0], '0x')
    await metisLockingPool.addReward(1, toEther(50))
    await metisLockingPool.slashPrincipal(2, toEther(60))
    assert.equal(fromEther(await strategy.getDepositChange()), -10)
  })

  it('getPendingFees should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(5000))
    await strategy.depositQueuedTokens([1, 4], [toEther(500), toEther(700)])

    await metisLockingPool.addReward(1, toEther(100))
    assert.equal(fromEther(await strategy.getPendingFees()), 15)

    await metisLockingPool.addReward(2, toEther(100))
    assert.equal(fromEther(await strategy.getPendingFees()), 30)

    await token.transfer(strategy.address, toEther(50))
    assert.equal(fromEther(await strategy.getPendingFees()), 32.5)

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getPendingFees()), 0)

    await metisLockingPool.addReward(1, toEther(100))
    await metisLockingPool.slashPrincipal(1, toEther(10))
    assert.equal(fromEther(await strategy.getPendingFees()), 13.5)

    await metisLockingPool.slashPrincipal(1, toEther(100))
    assert.equal(fromEther(await strategy.getPendingFees()), 0)
  })

  it('getMaxDeposits and getMinDeposits should work correctly', async () => {
    assert.equal(fromEther(await strategy.canDeposit()), 5000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0)

    await stakingPool.deposit(accounts[0], toEther(2000))
    assert.equal(fromEther(await strategy.canDeposit()), 3000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 2000)

    await stakingPool.deposit(accounts[0], toEther(3000))
    assert.equal(fromEther(await strategy.canDeposit()), 0)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 5000)
  })

  it('updateDeposits should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(400))
    await strategy.depositQueuedTokens([1, 4], [toEther(200), toEther(200)])

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)

    await metisLockingPool.addReward(1, toEther(100))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 5)

    await metisLockingPool.addReward(2, toEther(50))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 15.85)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 7.925)

    await token.transfer(strategy.address, toEther(90))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 640)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(strategy.address)).toFixed(2)), 18.31)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 13.66)
  })

  it('updateDeposits should work correctly with slashing', async () => {
    await stakingPool.deposit(accounts[0], toEther(400))
    await strategy.depositQueuedTokens([1, 4], [toEther(200), toEther(200)])

    await metisLockingPool.addReward(2, toEther(100))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 5)

    await metisLockingPool.slashPrincipal(2, toEther(50))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 450)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 9)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 4.5)

    await metisLockingPool.slashPrincipal(2, toEther(50))
    await metisLockingPool.addReward(1, toEther(20))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 420)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(strategy.address)).toFixed(2)), 10.36)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 4.18)

    await metisLockingPool.addReward(2, toEther(100))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 520)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(strategy.address)).toFixed(2)), 12.7)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 10.13)
  })

  it('updateDeposits should work correctly with reward withdrawals', async () => {
    await stakingPool.deposit(accounts[0], toEther(1000))
    await metisLockingInfo.setMaxLock(toEther(100))
    await strategy.depositQueuedTokens(
      [0, 1, 2, 3, 4],
      [toEther(100), toEther(100), toEther(100), toEther(100), toEther(100)]
    )

    await metisLockingPool.addReward(1, toEther(5))
    await metisLockingPool.addReward(2, toEther(7))
    await metisLockingPool.addReward(3, toEther(8))

    await stakingPool.updateStrategyRewards(
      [0],
      ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint32', 'uint256'],
        [toEther(10), 0, toEther(1)]
      )
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 1020)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1020)
    assert.equal(fromEther(await strategy.l2Rewards()), 0)

    await metisLockingPool.addReward(4, toEther(10))
    await metisLockingPool.addReward(5, toEther(7))
    await metisLockingPool.addReward(1, toEther(7))

    await stakingPool.updateStrategyRewards(
      [0],
      ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint32', 'uint256'],
        [toEther(10), 0, toEther(1)]
      )
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 1044)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1044)
    assert.equal(fromEther(await strategy.l2Rewards()), 22)
  })

  it('handleIncomingL2Rewards should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(1000))
    await strategy.depositQueuedTokens([0], [toEther(100)])
    await metisLockingInfo.setMaxLock(toEther(100))

    await metisLockingPool.addReward(1, toEther(10))

    await stakingPool.updateStrategyRewards(
      [0],
      ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint32', 'uint256'],
        [toEther(10), 0, toEther(1)]
      )
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 1010)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1010)
    assert.equal(fromEther(await strategy.l2Rewards()), 10)

    token.transfer(stakingPool.address, toEther(5))
    await strategy.handleIncomingL2Rewards(toEther(5))
    assert.equal(fromEther(await stakingPool.totalStaked()), 1010)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1005)
    assert.equal(fromEther(await strategy.l2Rewards()), 5)
  })

  it('withdrawOperatorRewards should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(200))
    await strategy.depositQueuedTokens([0, 1], [toEther(100), toEther(100)])

    let vault = (await ethers.getContractAt('SequencerVault', vaults[0])) as SequencerVault

    expect(strategy.withdrawOperatorRewards(accounts[2], 1)).to.be.revertedWith(
      'SenderNotAuthorized()'
    )

    await metisLockingPool.addReward(1, toEther(10))
    await metisLockingPool.addReward(2, toEther(10))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await vault.unclaimedRewards()), 1)
    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await vault.unclaimedRewards()), 0)
    assert.deepEqual(
      (await strategy.getOperatorRewards()).map((v) => fromEther(v)),
      [1, 1]
    )
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 1)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 1)

    vault = (await ethers.getContractAt('SequencerVault', vaults[1])) as SequencerVault

    await metisLockingPool.slashPrincipal(1, toEther(55))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await vault.unclaimedRewards()), 1)
    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await vault.unclaimedRewards()), 0.25)
    assert.deepEqual(
      (await strategy.getOperatorRewards()).map((v) => fromEther(v)),
      [0.25, 0]
    )
    assert.equal(fromEther(await stakingPool.balanceOf(strategy.address)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 1.5)
  })

  it('setOperatorRewardPercentage should work correctly', async () => {
    await stakingPool.deposit(accounts[0], toEther(300))
    await strategy.depositQueuedTokens([0], [toEther(300)])

    await expect(strategy.setOperatorRewardPercentage(10001)).to.be.revertedWith('FeesTooLarge()')
    await metisLockingPool.addReward(1, toEther(100))
    await strategy.setOperatorRewardPercentage(1500)
    assert.equal((await strategy.operatorRewardPercentage()).toNumber(), 1500)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
  })

  it('upgradeVaults should work correctly', async () => {
    let vaultInterface = (await ethers.getContractFactory('SequencerVaultV2Mock'))
      .interface as Interface

    let newVaultImplementation = (await deployImplementation('SequencerVaultV2Mock')) as string
    await strategy.setVaultImplementation(newVaultImplementation)

    await strategy.upgradeVaults([0, 1], ['0x', '0x'])
    for (let i = 0; i < 2; i++) {
      let vault = (await ethers.getContractAt(
        'SequencerVaultV2Mock',
        vaults[i]
      )) as SequencerVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
    }

    await strategy.upgradeVaults(
      [2, 3],
      [
        vaultInterface.encodeFunctionData('initializeV2', [2]),
        vaultInterface.encodeFunctionData('initializeV2', [3]),
      ]
    )
    for (let i = 2; i < 4; i++) {
      let vault = (await ethers.getContractAt(
        'SequencerVaultV2Mock',
        vaults[i]
      )) as SequencerVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
      assert.equal((await vault.getVersion()).toNumber(), i)
    }
  })

  it('setVaultImplementation should work correctly', async () => {
    await expect(strategy.setVaultImplementation(accounts[0])).to.be.revertedWith(
      'AddressNotContract()'
    )

    let newVaultImplementation = (await deployImplementation('SequencerVault')) as string
    await strategy.setVaultImplementation(newVaultImplementation)
    assert.equal(await strategy.vaultImplementation(), newVaultImplementation)
  })
})
