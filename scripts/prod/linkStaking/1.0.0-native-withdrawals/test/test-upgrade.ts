import { fromEther, toEther } from '../../../../utils/helpers'
import { getContract } from '../../../../utils/deployment'
import { ethers } from 'hardhat'
import {
  CommunityVCS,
  FundFlowController,
  OperatorVCS,
  PriorityPool,
  RebaseController,
  StakingPool,
  WithdrawalPool,
} from '../../../../../typechain-types'
import { assert } from 'chai'
import { time } from '@nomicfoundation/hardhat-network-helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const priorityPoolImp = '0xf4BC57b78c4f6B05Af601A30E58490dd2FDf025E'
const stakingPoolImp = '0x0051f643c74c7e0B0200405120126C4ec8b80957'
const operatorVCSImp = '0xbE20bC31F55e02FAB74323f325006B847304C98e'
const communityVCSImp = '0xFB8D714eEb9065e1352d43975b9B881074d2036E'
const operatorVaultImp = '0x050E47265c25Eb624d12671a7Ced8495A431B445'
const communityVaultImp = '0xc8611567343873F2AE4Fe9Da1dfB0f8B12a449ff'
const vaultDepositController = '0xCFB924e0413bA14b888A138B18c63B2621E631Fa'

// Staking Pool
const StakingPoolArgs = {
  unusedDepositLimit: toEther(5000),
}
// Operator VCS
const OperatorVCSArgs = {
  maxDepositSizeBP: 9000,
  vaultMaxDeposits: toEther(75000),
}
// Community VCS
const CommunityVCSArgs = {
  maxDepositSizeBP: 10000,
  vaultMaxDeposits: toEther(15000),
}

async function main() {
  const fundHolder = await ethers.getImpersonatedSigner(
    '0x11187eff852069a33d102476b2E8A9cc9167dAde'
  )
  await fundHolder.sendTransaction({ to: multisigAddress, value: toEther(100) })
  const signer = await ethers.getImpersonatedSigner(multisigAddress)

  const priorityPool = (await (
    await getContract('LINK_PriorityPool')
  ).connect(signer)) as PriorityPool
  const withdrawalPool = (await getContract('LINK_WithdrawalPool')) as WithdrawalPool
  const stakingPool = (await (await getContract('LINK_StakingPool')).connect(signer)) as StakingPool
  const rebaseController = (await getContract('LINK_RebaseController')) as RebaseController
  const operatorVCS = (await (await getContract('LINK_OperatorVCS')).connect(signer)) as OperatorVCS
  const communityVCS = (await (
    await getContract('LINK_CommunityVCS')
  ).connect(signer)) as CommunityVCS
  const fundFlowController = (await getContract('LINK_FundFlowController')) as FundFlowController
  const linkToken = await getContract('LINKToken')

  const operatorVaults = await operatorVCS.getVaults()
  const operatorVaultsToUpgrade = [...Array(operatorVaults.length).keys()]
  const operatorVaultUpgradeData = Array(operatorVaults.length).fill('0x')

  const communityVaults = await communityVCS.getVaults()
  const communityVaultsToUpgrade = [...Array(communityVaults.length).keys()]
  const communityVaultUpgradeData = Array(communityVaults.length).fill('0x')

  await priorityPool.upgradeTo(priorityPoolImp)
  await priorityPool.setRebaseController(rebaseController.target)
  await priorityPool.setWithdrawalPool(withdrawalPool.target)

  await stakingPool.upgradeTo(stakingPoolImp)
  await stakingPool.setRebaseController(rebaseController.target)
  await stakingPool.setUnusedDepositLimit(StakingPoolArgs.unusedDepositLimit)

  await operatorVCS.upgradeToAndCall(
    operatorVCSImp,
    operatorVCS.interface.encodeFunctionData('initialize', [
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      [],
      OperatorVCSArgs.maxDepositSizeBP,
      OperatorVCSArgs.vaultMaxDeposits,
      0,
      ethers.ZeroAddress,
    ])
  )
  await operatorVCS.setVaultImplementation(operatorVaultImp)
  await operatorVCS.setFundFlowController(fundFlowController.target)
  await operatorVCS.setVaultDepositController(vaultDepositController)
  await operatorVCS.upgradeVaults(operatorVaultsToUpgrade, operatorVaultUpgradeData)

  await communityVCS.upgradeToAndCall(
    communityVCSImp,
    communityVCS.interface.encodeFunctionData('initialize', [
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      [],
      CommunityVCSArgs.maxDepositSizeBP,
      CommunityVCSArgs.vaultMaxDeposits,
      0,
      0,
      ethers.ZeroAddress,
    ])
  )
  await communityVCS.setVaultImplementation(communityVaultImp)
  await communityVCS.setFundFlowController(fundFlowController.target)
  await communityVCS.setVaultDepositController(vaultDepositController)
  await communityVCS.upgradeVaults(communityVaultsToUpgrade, communityVaultUpgradeData)

  assert.equal(await priorityPool.rebaseController(), rebaseController.target)
  assert.equal(await priorityPool.withdrawalPool(), withdrawalPool.target)
  assert.equal(await priorityPool.allowInstantWithdrawals(), false)

  assert.equal(await withdrawalPool.token(), linkToken.target)
  assert.equal(await withdrawalPool.lst(), stakingPool.target)
  assert.equal(await withdrawalPool.priorityPool(), priorityPool.target)
  assert.equal(Number(await withdrawalPool.minTimeBetweenWithdrawals()), 86400 * 3)
  assert.equal(fromEther(await withdrawalPool.minWithdrawalAmount()), 5)

  assert.equal(fromEther(await stakingPool.unusedDepositLimit()), 5000)
  assert.deepEqual(await stakingPool.getFees(), [
    ['0x23c4602e63ACfe29b930c530B19d44a84AF0d767', 300n],
  ])
  assert.equal(await stakingPool.priorityPool(), priorityPool.target)
  assert.equal(await stakingPool.rebaseController(), rebaseController.target)

  assert.equal(await operatorVCS.fundFlowController(), fundFlowController.target)
  assert.equal(fromEther(await operatorVCS.totalUnbonded()), 0)
  assert.deepEqual(await operatorVCS.vaultGroups(3), [3n, 0n])
  assert.deepEqual(await operatorVCS.globalVaultState(), [5n, 0n, 0n, 15n])
  assert.equal(fromEther(await operatorVCS.vaultMaxDeposits()), 75000)
  assert.equal(await operatorVCS.vaultDepositController(), vaultDepositController)
  assert.equal(await operatorVCS.operatorRewardPercentage(), 500n)
  assert.deepEqual(await operatorVCS.getVaultRemovalQueue(), [])
  assert.equal(
    await (await ethers.getContractAt('OperatorVault', operatorVaults[0])).isRemoved(),
    false
  )
  assert.equal(
    await (
      await ethers.getContractAt('OperatorVault', operatorVaults[operatorVaults.length - 1])
    ).isRemoved(),
    false
  )

  assert.equal(await communityVCS.fundFlowController(), fundFlowController.target)
  assert.equal(fromEther(await communityVCS.totalUnbonded()), 0)
  assert.deepEqual(await communityVCS.vaultGroups(3), [3n, 0n])
  assert.deepEqual(await communityVCS.globalVaultState(), [5n, 0n, 0n, 128n])
  assert.equal(fromEther(await communityVCS.vaultMaxDeposits()), 15000)
  assert.equal(await communityVCS.vaultDepositController(), vaultDepositController)
  assert.equal(await communityVCS.vaultDeploymentThreshold(), 6n)
  assert.equal(await communityVCS.vaultDeploymentAmount(), 10n)
  assert.equal(
    await (await ethers.getContractAt('CommunityVault', communityVaults[0])).isRemoved(),
    false
  )
  assert.equal(
    await (
      await ethers.getContractAt('CommunityVault', communityVaults[communityVaults.length - 1])
    ).isRemoved(),
    false
  )

  assert.equal(await fundFlowController.operatorVCS(), operatorVCS.target)
  assert.equal(await fundFlowController.communityVCS(), communityVCS.target)
  assert.equal(await fundFlowController.unbondingPeriod(), 2419200n)
  assert.equal(await fundFlowController.claimPeriod(), 604800n)
  assert.equal(await fundFlowController.numVaultGroups(), 5n)

  assert.equal(await rebaseController.stakingPool(), stakingPool.target)
  assert.equal(await rebaseController.priorityPool(), priorityPool.target)
  assert.equal(
    await rebaseController.emergencyPauser(),
    '0x785A2De1CaD17721b05d111Bf087B1D87048f4a5'
  )

  const chainlinkAdmin = '0xF5dF3d2750E3b18B1CaA2b7E30796973bB9bE715'
  const staker = await ethers.getImpersonatedSigner('0x9BBb46637A1Df7CADec2AFcA19C2920CdDCc8Db8')

  await fundHolder.sendTransaction({ to: chainlinkAdmin, value: toEther(100) })
  await fundHolder.sendTransaction({ to: staker.address, value: toEther(100) })

  const comPool = new ethers.Contract('0xBc10f2E862ED4502144c7d632a3459F49DFCDB5e', [
    'function setPoolConfig(uint256,uint256) external',
  ]) as any
  await comPool
    .connect(await ethers.getImpersonatedSigner(chainlinkAdmin))
    .setPoolConfig(toEther(42175000), toEther(15000))
  await communityVCS.addVaults(15)

  let depositData = await fundFlowController.getDepositData(toEther(200000))
  await priorityPool.depositQueuedTokens(0, toEther(300000), [...depositData])

  depositData = await fundFlowController.getDepositData(toEther(1000))
  await linkToken
    .connect(staker)
    .transferAndCall(
      priorityPool.target,
      toEther(1000),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, [...depositData]])
    )

  assert.equal(fromEther(await stakingPool.balanceOf(staker.address)), 1000)
  assert.closeTo(fromEther(await stakingPool.totalStaked()), 3380138, 1)
  assert.equal(fromEther(await priorityPool.totalQueued()), 0)
  assert.closeTo(fromEther(await operatorVCS.getTotalDeposits()), 1127818, 1)
  assert.closeTo(fromEther(await communityVCS.getTotalDeposits()), 2252320, 1)

  await stakingPool
    .connect(staker)
    .transferAndCall(
      priorityPool.target,
      toEther(300),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, ['0x', '0x']])
    )

  assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 300)

  depositData = await fundFlowController.getDepositData(toEther(400))
  await linkToken
    .connect(staker)
    .transferAndCall(
      priorityPool.target,
      toEther(400),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, [...depositData]])
    )

  assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 0)

  await stakingPool
    .connect(staker)
    .transferAndCall(
      priorityPool.target,
      toEther(50),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, ['0x', '0x']])
    )

  assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 50)
  assert.closeTo(fromEther(await communityVCS.getTotalDeposits()), 2252420, 1)

  console.log(fromEther(await operatorVCS.getTotalDeposits()))
  console.log(fromEther(await stakingPool.totalStaked()))

  await fundFlowController.updateVaultGroups()
  await time.increase(604800)
  await fundFlowController.updateVaultGroups()
  await time.increase(604800)
  await fundFlowController.updateVaultGroups()
  await time.increase(604800)
  await fundFlowController.updateVaultGroups()
  await time.increase(604800)
  await fundFlowController.updateVaultGroups()

  await withdrawalPool.performUpkeep(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes[]'],
      [await fundFlowController.getWithdrawalData(toEther(50))]
    )
  )

  console.log(await stakingPool.getStrategies())

  console.log('oio')
  console.log(fromEther(await operatorVCS.getTotalDeposits()))
  console.log(fromEther(await stakingPool.totalStaked()))

  assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 0)
  assert.closeTo(fromEther(await communityVCS.getTotalDeposits()), 2252370, 1)

  console.log('All tests passed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
