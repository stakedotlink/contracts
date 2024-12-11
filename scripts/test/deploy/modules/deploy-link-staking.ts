import { ethers } from 'hardhat'
import {
  ERC677,
  OperatorVCS,
  PriorityPool,
  SDLPoolPrimary,
  StakingPool,
} from '../../../../typechain-types'
import {
  updateDeployments,
  deploy,
  getContract,
  deployUpgradeable,
  deployImplementation,
} from '../../../utils/deployment'
import { getAccounts, toEther } from '../../../utils/helpers'

// Operator Vault Controller Strategy
const OperatorVCSArgs = {
  maxDepositSizeBP: 9000, //basis point amount of the remaing deposit room in the Chainlink staking contract that can be deposited at once
  operatorRewardPercentage: 1000, // basis point amount of an operator's earned rewards that they receive
  fees: [], // fee receivers & percentage amounts in basis points
  vaultMaxDeposits: toEther(75000), // max number of tokens that a vault can hold
}

async function deployOperatorVCS(vaultDepositController: string) {
  const { accounts } = await getAccounts()
  const linkToken = (await getContract('LINKToken')) as ERC677
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool

  const stakingRewardsMock = await deploy('StakingRewardsMock', [linkToken.target])
  const stakingMock = await deploy('StakingMock', [
    linkToken.target,
    stakingRewardsMock.target,
    toEther(1000),
    toEther(75000),
    toEther(10000000),
    28 * 86400,
    7 * 86400,
  ])
  const pfAlertsControllerMock = await deploy('PFAlertsControllerMock', [linkToken.target])

  const vaultImpAddress = (await deployImplementation('OperatorVault')) as string
  console.log('OperatorVault implementation deployed: ', vaultImpAddress)

  const operatorVCS = (await deployUpgradeable(
    'OperatorVCS',
    [
      linkToken.target,
      stakingPool.target,
      stakingMock.target,
      vaultImpAddress,
      OperatorVCSArgs.fees,
      OperatorVCSArgs.maxDepositSizeBP,
      OperatorVCSArgs.vaultMaxDeposits,
      OperatorVCSArgs.operatorRewardPercentage,
      vaultDepositController,
    ],
    { unsafeAllow: ['delegatecall'] }
  )) as OperatorVCS
  console.log('OperatorVCS deployed: ', operatorVCS.target)

  await (await linkToken.transfer(stakingRewardsMock.target, toEther(100000))).wait()
  await (await linkToken.transfer(pfAlertsControllerMock.target, toEther(10000))).wait()
  await (await stakingPool.addStrategy(operatorVCS.target)).wait()

  for (let i = 0; i < 3; i++) {
    await (
      await operatorVCS.addVault(ethers.ZeroAddress, accounts[0], pfAlertsControllerMock.target)
    ).wait()
  }

  updateDeployments(
    { LINK_OperatorVCS: operatorVCS.target.toString() },
    { LINK_OperatorVCS: 'OperatorVCS' }
  )

  return operatorVCS.target
}

// Community Vault Controller Strategy
const CommunityVCSArgs = {
  maxDepositSizeBP: 9000, //basis point amount of the remaing deposit room in the Chainlink staking contract that can be deposited at once
  vaultDeploymentThreshold: 10, // the min number of non-full vaults before a new batch is deployed
  vaultDeploymentAmount: 10, // amount of vaults to deploy when threshold is met
  fees: [], // fee receivers & percentage amounts in basis points
  vaultMaxDeposits: toEther(15000), // max number of tokens that a vault can hold
}

async function deployCommunityVCS(vaultDepositController: string) {
  const linkToken = (await getContract('LINKToken')) as ERC677
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool

  const stakingRewardsMock = await deploy('StakingRewardsMock', [linkToken.target])
  const stakingMock = await deploy('StakingMock', [
    linkToken.target,
    stakingRewardsMock.target,
    toEther(1000),
    toEther(15000),
    toEther(10000000),
    28 * 86400,
    7 * 86400,
  ])

  const vaultImpAddress = await deployImplementation('CommunityVault')
  console.log('CommunityVault implementation deployed: ', vaultImpAddress)

  const communityVCS = await deployUpgradeable(
    'CommunityVCS',
    [
      linkToken.target,
      stakingPool.target,
      stakingMock.target,
      vaultImpAddress,
      CommunityVCSArgs.fees,
      CommunityVCSArgs.maxDepositSizeBP,
      CommunityVCSArgs.vaultMaxDeposits,
      CommunityVCSArgs.vaultDeploymentThreshold,
      CommunityVCSArgs.vaultDeploymentAmount,
      vaultDepositController,
    ],
    { unsafeAllow: ['delegatecall'] }
  )
  console.log('CommunityVCS deployed: ', communityVCS.target)

  await (await linkToken.transfer(stakingRewardsMock.target, toEther(100000))).wait()
  await (await stakingPool.addStrategy(communityVCS.target)).wait()

  updateDeployments(
    { LINK_CommunityVCS: communityVCS.target },
    { LINK_CommunityVCS: 'CommunityVCS' }
  )

  return communityVCS.target
}

// Wrapped stLINK
const WrappedSDTokenArgs = {
  name: 'Wrapped stLINK', // wrapped token name
  symbol: 'wstLINK', // wrapped token symbol
}
// LINK Staking Pool
const StakingPoolArgs = {
  derivativeTokenName: 'Staked LINK', // LINK staking derivative token name
  derivativeTokenSymbol: 'stLINK', // LINK staking derivative token symbol
  fees: [], // fee receivers & percentage amounts in basis points
  unusedDepositLimit: toEther(10000), // max number of tokens that can sit in the pool outside of a strategy
}
// LINK Priority Pool
const PriorityPoolArgs = {
  queueDepositMin: toEther(1000), // min amount of tokens neede to execute deposit
  queueDepositMax: toEther(200000), // max amount of tokens in a single deposit tx}
}
// stLINK/LINK Security Pool
const SecurityPoolArgs = {
  maxClaimAmountBP: 3000,
  withdrawalDelayDuration: 86400,
  withdrawalWindowDuration: 86400,
}
// LINK Withdrawal Pool
const WithdrawalPoolArgs = {
  minWithdrawalAmount: toEther(1), // minimum amount of LSTs that can be queued for withdrawal
  minTimeBetweenWithdrawals: 86400, // min amount of time between execution of withdrawals
}

export async function deployLINKStaking() {
  const { accounts } = await getAccounts()
  const linkToken = (await getContract('LINKToken')) as ERC677
  const sdlPoolPrimary = (await getContract('SDLPool')) as SDLPoolPrimary

  const stakingPool = (await deployUpgradeable('StakingPool', [
    linkToken.target,
    StakingPoolArgs.derivativeTokenName,
    StakingPoolArgs.derivativeTokenSymbol,
    StakingPoolArgs.fees,
    StakingPoolArgs.unusedDepositLimit,
  ])) as StakingPool
  console.log('LINK_StakingPool deployed: ', stakingPool.target)

  const priorityPool = (await deployUpgradeable('PriorityPool', [
    linkToken.target,
    stakingPool.target,
    sdlPoolPrimary.target,
    PriorityPoolArgs.queueDepositMin,
    PriorityPoolArgs.queueDepositMax,
  ])) as PriorityPool
  console.log('LINK_PriorityPool deployed: ', priorityPool.target)

  const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
    linkToken.target,
    stakingPool.target,
    priorityPool.target,
    WithdrawalPoolArgs.minWithdrawalAmount,
    WithdrawalPoolArgs.minTimeBetweenWithdrawals,
  ])) as PriorityPool
  console.log('LINK_WithdrawalPool deployed: ', withdrawalPool.target)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.target,
    WrappedSDTokenArgs.name,
    WrappedSDTokenArgs.symbol,
  ])
  console.log('LINK_WrappedSDToken token deployed: ', wsdToken.target)

  const stLinkSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPoolPrimary.target,
    stakingPool.target,
    wsdToken.target,
  ])
  console.log('stLINK_SDLRewardsPool deployed: ', stLinkSDLRewardsPool.target)

  const curveLPToken = await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
    'Curve.fi Factory Plain Pool: stLINK/LINK',
    'stLINK-f',
    1000000,
  ])
  console.log('stLINK/LINK_CurveLPToken deployed: ', curveLPToken.target)

  const securityPool = await deployUpgradeable('SecurityPool', [
    curveLPToken.target,
    'Security LINK/stLINK LP',
    'secLINK/stLINK',
    accounts[0],
    SecurityPoolArgs.maxClaimAmountBP,
    SecurityPoolArgs.withdrawalDelayDuration,
    SecurityPoolArgs.withdrawalWindowDuration,
  ])
  console.log('stLINK_SecurityPool deployed: ', securityPool.target)

  updateDeployments(
    {
      LINK_StakingPool: stakingPool.target.toString(),
      LINK_PriorityPool: priorityPool.target.toString(),
      LINK_WithdrawalPool: withdrawalPool.target.toString(),
      LINK_WrappedSDToken: wsdToken.target,
      stLINK_SDLRewardsPool: stLinkSDLRewardsPool.target,
      'stLINK/LINK_CurveLPToken': curveLPToken.target,
      stLINK_SecurityPool: securityPool.target,
    },
    {
      LINK_StakingPool: 'StakingPool',
      LINK_PriorityPool: 'PriorityPool',
      LINK_WithdrawalPool: 'WithdrawalPool',
      LINK_WrappedSDToken: 'WrappedSDToken',
      stLINK_SDLRewardsPool: 'RewardsPoolWSD',
      'stLINK/LINK_CurveLPToken': 'contracts/core/tokens/base/ERC677.sol:ERC677',
      stLINK_SecurityPool: 'SecurityPool',
    }
  )

  await (await sdlPoolPrimary.addToken(stakingPool.target, stLinkSDLRewardsPool.target)).wait()
  await (await stakingPool.setPriorityPool(priorityPool.target)).wait()
  await (await priorityPool.setDistributionOracle(accounts[0])).wait()
  await (await priorityPool.setWithdrawalPool(withdrawalPool.target)).wait()

  const vaultDepositController = await deploy('VaultDepositController')

  const operatorVCS = await deployOperatorVCS(vaultDepositController.target)
  const communityVCS = await deployCommunityVCS(vaultDepositController.target)

  const fundFlowController = await deployUpgradeable('FundFlowController', [
    operatorVCS,
    communityVCS,
    28 * 86400,
    7 * 86400,
    5,
  ])
  console.log('FundFlowController deployed at', fundFlowController.target)

  updateDeployments({
    FundFlowController: fundFlowController.target,
  })
}
