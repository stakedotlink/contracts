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
}

async function deployOperatorVCS() {
  const { accounts } = await getAccounts()
  const linkToken = (await getContract('LINKToken')) as ERC677
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool

  const stakingRewardsMock = await deploy('StakingRewardsMock', [linkToken.address])
  const stakingMock = await deploy('StakingMock', [
    linkToken.address,
    stakingRewardsMock.address,
    toEther(1000),
    toEther(75000),
    toEther(10000000),
  ])
  const pfAlertsControllerMock = await deploy('PFAlertsControllerMock', [linkToken.address])

  const vaultImpAddress = (await deployImplementation('OperatorVault')) as string
  console.log('OperatorVault implementation deployed: ', vaultImpAddress)

  const operatorVCS = (await deployUpgradeable('OperatorVCS', [
    linkToken.address,
    stakingPool.address,
    stakingMock.address,
    vaultImpAddress,
    OperatorVCSArgs.fees,
    OperatorVCSArgs.maxDepositSizeBP,
    OperatorVCSArgs.operatorRewardPercentage,
  ])) as OperatorVCS
  console.log('OperatorVCS deployed: ', operatorVCS.address)

  await (await linkToken.transfer(stakingRewardsMock.address, toEther(100000))).wait()
  await (await linkToken.transfer(pfAlertsControllerMock.address, toEther(10000))).wait()
  await (await stakingPool.addStrategy(operatorVCS.address)).wait()

  for (let i = 0; i < 3; i++) {
    await (
      await operatorVCS.addVault(
        ethers.constants.AddressZero,
        accounts[0],
        pfAlertsControllerMock.address
      )
    ).wait()
  }

  updateDeployments({ LINK_OperatorVCS: operatorVCS.address }, { LINK_OperatorVCS: 'OperatorVCS' })
}

// Community Vault Controller Strategy
const CommunityVCSArgs = {
  maxDepositSizeBP: 9000, //basis point amount of the remaing deposit room in the Chainlink staking contract that can be deposited at once
  vaultDeploymentThreshold: 10, // the min number of non-full vaults before a new batch is deployed
  vaultDeploymentAmount: 10, // amount of vaults to deploy when threshold is met
  fees: [], // fee receivers & percentage amounts in basis points
}

async function deployCommunityVCS() {
  const linkToken = (await getContract('LINKToken')) as ERC677
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool

  const stakingRewardsMock = await deploy('StakingRewardsMock', [linkToken.address])
  const stakingMock = await deploy('StakingMock', [
    linkToken.address,
    stakingRewardsMock.address,
    toEther(1000),
    toEther(15000),
    toEther(10000000),
  ])

  const vaultImpAddress = await deployImplementation('CommunityVault')
  console.log('CommunityVault implementation deployed: ', vaultImpAddress)

  const communityVCS = await deployUpgradeable('CommunityVCS', [
    linkToken.address,
    stakingPool.address,
    stakingMock.address,
    vaultImpAddress,
    CommunityVCSArgs.fees,
    CommunityVCSArgs.maxDepositSizeBP,
    CommunityVCSArgs.vaultDeploymentThreshold,
    CommunityVCSArgs.vaultDeploymentAmount,
  ])
  console.log('CommunityVCS deployed: ', communityVCS.address)

  await (await linkToken.transfer(stakingRewardsMock.address, toEther(100000))).wait()
  await (await stakingPool.addStrategy(communityVCS.address)).wait()

  updateDeployments(
    { LINK_CommunityVCS: communityVCS.address },
    { LINK_CommunityVCS: 'CommunityVCS' }
  )
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
}
// LINK Priority Pool
const PriorityPoolArgs = {
  queueDepositMin: toEther(1000), // min amount of tokens neede to execute deposit
  queueDepositMax: toEther(200000), // max amount of tokens in a single deposit tx}
}

export async function deployLINKStaking() {
  const { accounts } = await getAccounts()
  const linkToken = (await getContract('LINKToken')) as ERC677
  const sdlPoolPrimary = (await getContract('SDLPool')) as SDLPoolPrimary

  const stakingPool = (await deployUpgradeable('StakingPool', [
    linkToken.address,
    StakingPoolArgs.derivativeTokenName,
    StakingPoolArgs.derivativeTokenSymbol,
    StakingPoolArgs.fees,
  ])) as StakingPool
  console.log('LINK_StakingPool deployed: ', stakingPool.address)

  const priorityPool = (await deployUpgradeable('PriorityPool', [
    linkToken.address,
    stakingPool.address,
    sdlPoolPrimary.address,
    PriorityPoolArgs.queueDepositMin,
    PriorityPoolArgs.queueDepositMax,
  ])) as PriorityPool
  console.log('LINK_PriorityPool deployed: ', priorityPool.address)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.address,
    WrappedSDTokenArgs.name,
    WrappedSDTokenArgs.symbol,
  ])
  console.log('LINK_WrappedSDToken token deployed: ', wsdToken.address)

  const stLinkSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPoolPrimary.address,
    stakingPool.address,
    wsdToken.address,
  ])
  console.log('stLINK_SDLRewardsPool deployed: ', stLinkSDLRewardsPool.address)

  await (await sdlPoolPrimary.addToken(stakingPool.address, stLinkSDLRewardsPool.address)).wait()
  await (await stakingPool.setPriorityPool(priorityPool.address)).wait()
  await (await priorityPool.setDistributionOracle(accounts[0])).wait()

  updateDeployments(
    {
      LINK_StakingPool: stakingPool.address,
      LINK_PriorityPool: priorityPool.address,
      LINK_WrappedSDToken: wsdToken.address,
      stLINK_SDLRewardsPool: stLinkSDLRewardsPool.address,
    },
    {
      LINK_StakingPool: 'StakingPool',
      LINK_PriorityPool: 'PriorityPool',
      LINK_WrappedSDToken: 'WrappedSDToken',
      stLINK_SDLRewardsPool: 'RewardsPoolWSD',
    }
  )

  await deployOperatorVCS()
  await deployCommunityVCS()
}
