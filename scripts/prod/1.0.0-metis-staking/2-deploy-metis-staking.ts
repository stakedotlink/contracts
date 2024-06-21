import { ethers } from 'hardhat'
import { ERC20, PriorityPool, SDLPoolPrimary, StakingPool } from '../../../typechain-types'
import {
  updateDeployments,
  deploy,
  getContract,
  deployUpgradeable,
  deployImplementation,
} from '../../utils/deployment'
import { toEther } from '../../utils/helpers'

const sequencerRewardsCCIPSenderAddress = '' // address of contract deployed on Metis
const ccipRouterAddress = '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D' // ETH mainnet CCIP router

// Wrapped stMETIS
const WrappedSDTokenArgs = {
  name: 'Wrapped stMETIS', // wrapped token name
  symbol: 'wstMETIS', // wrapped token symbol
}
// METIS Staking Pool
const StakingPoolArgs = {
  derivativeTokenName: 'Staked METIS', // METIS liquid staking token name
  derivativeTokenSymbol: 'stMETIS', // METIS liquid staking token symbol
  fees: [], // fee receivers & percentage amounts in basis points
}
// Sequencer VCS
const SequencerVCSArgs = {
  lockingInfo: '0x0fe382b74C3894B65c10E5C12ae60Bbd8FAf5b48', // address of Metis locking info contract
  depositController: ethers.constants.AddressZero, // address authorized to deposit queued tokens into vaults
  fees: [], // list of fees to be paid on rewards
  operatorRewardPercentage: 0, // basis point amount of an operator's earned rewards that they receive
}
// METIS Priority Pool
const PriorityPoolArgs = {
  queueDepositMin: toEther(1000), // min amount of tokens neede to execute deposit
  queueDepositMax: toEther(200000), // max amount of tokens in a single deposit tx
}
// PP Distribution Oracle
const DistributionOracleArgs = {
  chainlinkOracle: '0x1152c76A0B3acC9856B1d8ee9EbDf2A2d0a01cC3', // address of Chainlink oracle contract
  jobId: ethers.constants.HashZero, // adapter job ID
  fee: 0, // LINK fee for adpapter job
  minTimeBetweenUpdates: 86400, // min time between updates in seconds
  minDepositsSinceLastUpdate: toEther(15000), // min amount of deposits required to execute update
  minBlockConfirmations: 75, // min number of block confirmations between initiating update and executing
}

async function main() {
  const sdlPoolPrimary = (await getContract('SDLPool', true)) as SDLPoolPrimary
  const metisToken = (await getContract('METISToken', true)) as ERC20
  const linkToken = (await getContract('LINKToken', true)) as ERC20

  const stakingPool = (await deployUpgradeable(
    'StakingPool',
    [
      metisToken.address,
      StakingPoolArgs.derivativeTokenName,
      StakingPoolArgs.derivativeTokenSymbol,
      StakingPoolArgs.fees,
    ],
    true
  )) as StakingPool
  console.log('METIS_StakingPool deployed: ', stakingPool.address)

  const vaultImpAddress = (await deployImplementation('SequencerVault', true)) as string
  console.log('SequencerVault implementation deployed: ', vaultImpAddress)

  const sequencerVCS = await deployUpgradeable(
    'SequencerVCS',
    [
      metisToken.address,
      stakingPool.address,
      SequencerVCSArgs.lockingInfo,
      SequencerVCSArgs.depositController,
      vaultImpAddress,
      sequencerRewardsCCIPSenderAddress,
      SequencerVCSArgs.fees,
      SequencerVCSArgs.operatorRewardPercentage,
    ],
    true
  )
  console.log('METIS_SequencerVCS deployed: ', sequencerVCS.address)

  const rewardsReceiver = await deploy(
    'SequencerRewardsCCIPReceiver',
    [
      ccipRouterAddress,
      metisToken.address,
      sequencerVCS.address,
      stakingPool.address,
      sequencerRewardsCCIPSenderAddress,
    ],
    true
  )
  console.log('METIS_SequencerRewardsCCIPReceiver deployed: ', rewardsReceiver.address)

  const priorityPool = (await deployUpgradeable(
    'PriorityPool',
    [
      metisToken.address,
      stakingPool.address,
      sdlPoolPrimary.address,
      PriorityPoolArgs.queueDepositMin,
      PriorityPoolArgs.queueDepositMax,
    ],
    true
  )) as PriorityPool
  console.log('METIS_PriorityPool deployed: ', priorityPool.address)

  const wsdToken = await deploy(
    'WrappedSDToken',
    [stakingPool.address, WrappedSDTokenArgs.name, WrappedSDTokenArgs.symbol],
    true
  )
  console.log('METIS_WrappedSDToken token deployed: ', wsdToken.address)

  const stMetisSDLRewardsPool = await deploy(
    'RewardsPoolWSD',
    [sdlPoolPrimary.address, stakingPool.address, wsdToken.address],
    true
  )
  console.log('stMetis_SDLRewardsPool deployed: ', stMetisSDLRewardsPool.address)

  const distributionOracle = await deploy(
    'DistributionOracle',
    [
      linkToken.address,
      DistributionOracleArgs.chainlinkOracle,
      DistributionOracleArgs.jobId,
      DistributionOracleArgs.fee,
      DistributionOracleArgs.minTimeBetweenUpdates,
      DistributionOracleArgs.minDepositsSinceLastUpdate,
      DistributionOracleArgs.minBlockConfirmations,
      priorityPool.address,
    ],
    true
  )
  console.log('METIS_PP_DistributionOracle deployed: ', stMetisSDLRewardsPool.address)

  await (await sdlPoolPrimary.addToken(stakingPool.address, stMetisSDLRewardsPool.address)).wait()
  await (await stakingPool.setPriorityPool(priorityPool.address)).wait()
  await (await stakingPool.addStrategy(sequencerVCS.address)).wait()
  await (await priorityPool.setDistributionOracle(distributionOracle.address)).wait()
  await (await sequencerVCS.setCCIPController(rewardsReceiver.address)).wait()

  updateDeployments(
    {
      METIS_StakingPool: stakingPool.address,
      METIS_SequencerVCS: sequencerVCS.address,
      METIS_SequencerRewardsCCIPReceiver: rewardsReceiver.address,
      METIS_PriorityPool: priorityPool.address,
      METIS_WrappedSDToken: wsdToken.address,
      stMETIS_SDLRewardsPool: stMetisSDLRewardsPool.address,
      METIS_PP_DistributionOracle: distributionOracle.address,
    },
    {
      METIS_StakingPool: 'StakingPool',
      METIS_SequencerVCS: 'SequencerVCS',
      METIS_SequencerRewardsCCIPReceiver: 'SequencerRewardsCCIPReceiver',
      METIS_PriorityPool: 'PriorityPool',
      METIS_WrappedSDToken: 'WrappedSDToken',
      stMETIS_SDLRewardsPool: 'RewardsPoolWSD',
      METIS_PP_DistributionOracle: 'DistributionOracle',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
