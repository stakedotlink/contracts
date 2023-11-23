import { ethers, upgrades } from 'hardhat'
import { assert } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import {
  ERC677,
  StakingPool,
  StakingMockV1,
  OperatorVCSUpgrade,
  StakingMock,
  PFAlertsControllerMock,
  OperatorVaultV1,
  OperatorVault,
  OperatorVCS,
  CommunityVCS,
  CommunityVault,
  StakingRewardsMock,
} from '../../typechain-types'
import { Interface } from '@ethersproject/abi'

describe('LINK-Staking-0.2-Upgrade', () => {
  let linkToken: ERC677
  let stakingV1: StakingMockV1
  let rewardVault: StakingRewardsMock
  let operatorStaking: StakingMock
  let communityStaking: StakingMock
  let pfAlertsController: PFAlertsControllerMock
  let operatorVCS: OperatorVCSUpgrade
  let stakingPool: StakingPool
  let operatorVaults: string[]
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    linkToken = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

    stakingPool = (await deployUpgradeable('StakingPool', [
      linkToken.address,
      'Staked LINK',
      'stLINK',
      [[accounts[1], 300]],
    ])) as StakingPool

    stakingV1 = (await deploy('StakingMockV1', [linkToken.address])) as StakingMockV1
    rewardVault = (await deploy('StakingRewardsMock', [linkToken.address])) as StakingRewardsMock
    operatorStaking = (await deploy('StakingMock', [
      linkToken.address,
      rewardVault.address,
      toEther(1000),
      toEther(75000),
      toEther(10000000),
    ])) as StakingMock
    communityStaking = (await deploy('StakingMock', [
      linkToken.address,
      rewardVault.address,
      toEther(1000),
      toEther(15000),
      toEther(5000000),
    ])) as StakingMock
    pfAlertsController = (await deploy('PFAlertsControllerMock', [
      linkToken.address,
    ])) as PFAlertsControllerMock

    await stakingPool.setPriorityPool(accounts[0])
    await stakingV1.setMigration(operatorStaking.address)
    await stakingV1.setBaseReward(toEther(1000))
    await linkToken.transfer(stakingV1.address, toEther(15000))

    const opVaultV1 = (await deployImplementation('OperatorVaultV1')) as string
    operatorVCS = (await deployUpgradeable('OperatorVCSUpgrade', [
      linkToken.address,
      stakingPool.address,
      stakingV1.address,
      opVaultV1,
      toEther(1000),
      [
        [accounts[2], 1500],
        [accounts[3], 500],
      ],
      [],
    ])) as OperatorVCSUpgrade

    await stakingPool.addStrategy(operatorVCS.address)

    for (let i = 0; i < 15; i++) {
      await operatorVCS.addVault(accounts[0])
    }

    operatorVaults = await operatorVCS.getVaults()

    await linkToken.approve(stakingPool.address, ethers.constants.MaxUint256)
    await stakingPool.deposit(accounts[0], toEther(750000))
    await operatorVCS.depositBufferedTokens(0)
  })

  it('test env should be properly setup', async () => {
    assert.equal(fromEther(await stakingPool.canDeposit()), 0)
    assert.equal(fromEther(await linkToken.balanceOf(stakingV1.address)), 765000)
    assert.deepEqual(
      (await operatorVCS.getFees()).map((fee) => [fee[0], fee[1].toNumber()]),
      [
        [accounts[2], 1500],
        [accounts[3], 500],
      ]
    )

    for (let i = 0; i < operatorVaults.length; i++) {
      let vault = (await ethers.getContractAt(
        'OperatorVaultV1',
        operatorVaults[i]
      )) as OperatorVaultV1
      assert.equal(fromEther(await stakingV1.getStake(operatorVaults[i])), 50000)
      assert.equal(fromEther(await vault.getTotalDeposits()), 51000)
      assert.equal(fromEther(await vault.getPrincipalDeposits()), 50000)
    }
  })

  it('should be able to upgrade operator strategy contracts', async () => {
    const operatorVCSImp = (await upgrades.prepareUpgrade(
      operatorVCS.address,
      await ethers.getContractFactory('OperatorVCS'),
      {
        kind: 'uups',
        unsafeSkipStorageCheck: true,
        unsafeAllowRenames: true,
      }
    )) as string

    const operatorVaultImp = (await upgrades.deployImplementation(
      await ethers.getContractFactory('OperatorVault'),
      {
        kind: 'uups',
      }
    )) as string

    const operatorVCSInterface = (await ethers.getContractFactory('OperatorVCS'))
      .interface as Interface
    await operatorVCS.upgradeToAndCall(
      operatorVCSImp,
      operatorVCSInterface.encodeFunctionData('initialize', [
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        operatorStaking.address,
        operatorVaultImp,
        [],
        9000,
        1000,
      ])
    )
    const operatorVCSUpgraded = (await ethers.getContractAt(
      'OperatorVCS',
      operatorVCS.address
    )) as OperatorVCS

    await operatorVCS.updateFee(1, ethers.constants.AddressZero, 0)

    const operatorVaultInterface = (await ethers.getContractFactory('OperatorVault'))
      .interface as Interface
    await operatorVCS.upgradeVaults(
      0,
      15,
      operatorVaultInterface.encodeFunctionData('initialize', [
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        operatorStaking.address,
        rewardVault.address,
        pfAlertsController.address,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
      ])
    )

    assert.equal(fromEther(await stakingPool.canDeposit()), 0)
    assert.equal(fromEther(await linkToken.balanceOf(operatorStaking.address)), 765000)
    assert.deepEqual(
      (await operatorVCS.getFees()).map((fee) => [fee[0], fee[1].toNumber()]),
      [[accounts[2], 1500]]
    )
    assert.equal((await operatorVCSUpgraded.operatorRewardPercentage()).toNumber(), 1000)
    assert.equal(fromEther(await operatorVCSUpgraded.getTotalDeposits()), 750000)
    assert.equal(fromEther(await operatorVCSUpgraded.totalPrincipalDeposits()), 750000)
    assert.equal(fromEther(await operatorVCSUpgraded.getDepositChange()), 15000)
    assert.equal((await operatorVCSUpgraded.indexOfLastFullVault()).toNumber(), 0)
    assert.equal((await operatorVCSUpgraded.maxDepositSizeBP()).toNumber(), 9000)

    for (let i = 0; i < operatorVaults.length; i++) {
      let vault = (await ethers.getContractAt('OperatorVault', operatorVaults[i])) as OperatorVault
      assert.equal(fromEther(await operatorStaking.getStakerPrincipal(operatorVaults[i])), 51000)
      assert.equal(fromEther(await vault.getTotalDeposits()), 51000)
      assert.equal(fromEther(await vault.getPrincipalDeposits()), 51000)
      assert.equal(fromEther(await vault.getRewards()), 0)
      assert.equal(await vault.rewardsController(), rewardVault.address)
    }
  })

  it('should be able to deploy community strategy contracts', async () => {
    const communityVaultImp = (await upgrades.deployImplementation(
      await ethers.getContractFactory('CommunityVault'),
      {
        kind: 'uups',
      }
    )) as string

    const communityVCS = (await deployUpgradeable('CommunityVCS', [
      linkToken.address,
      stakingPool.address,
      communityStaking.address,
      communityVaultImp,
      [[accounts[2], 500]],
      9000,
      10,
      20,
    ])) as CommunityVCS

    await stakingPool.addStrategy(communityVCS.address)
    await stakingPool.reorderStrategies([1, 0])

    await stakingPool.deposit(accounts[0], toEther(105000))

    assert.equal(fromEther(await stakingPool.canDeposit()), 195000)
    assert.equal(fromEther(await linkToken.balanceOf(communityStaking.address)), 105000)
    assert.deepEqual(
      (await communityVCS.getFees()).map((fee) => [fee[0], fee[1].toNumber()]),
      [[accounts[2], 500]]
    )
    assert.equal(fromEther(await communityVCS.getTotalDeposits()), 105000)
    assert.equal(fromEther(await communityVCS.totalPrincipalDeposits()), 105000)
    assert.equal((await communityVCS.maxDepositSizeBP()).toNumber(), 9000)

    let communityVaults = await communityVCS.getVaults()
    for (let i = 0; i < 7; i++) {
      let vault = (await ethers.getContractAt(
        'CommunityVault',
        communityVaults[i]
      )) as CommunityVault
      assert.equal(fromEther(await communityStaking.getStakerPrincipal(communityVaults[i])), 15000)
      assert.equal(fromEther(await vault.getTotalDeposits()), 15000)
      assert.equal(fromEther(await vault.getPrincipalDeposits()), 15000)
      assert.equal(fromEther(await vault.getRewards()), 0)
      assert.equal(await vault.rewardsController(), rewardVault.address)
    }
  })
})
