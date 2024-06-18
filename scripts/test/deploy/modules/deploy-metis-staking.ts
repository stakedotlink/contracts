import {
  ERC20,
  ERC677,
  PriorityPool,
  SDLPoolPrimary,
  StakingPool,
} from '../../../../typechain-types'
import {
  updateDeployments,
  deploy,
  getContract,
  deployUpgradeable,
} from '../../../utils/deployment'
import { getAccounts, toEther } from '../../../utils/helpers'

async function deploySequencerVCS() {
  const metisToken = (await getContract('METISToken')) as ERC20
  const stakingPool = (await getContract('METIS_StakingPool')) as StakingPool

  const sequencerVCS = await deployUpgradeable('StrategyMock', [
    metisToken.address,
    stakingPool.address,
    toEther(1000),
    toEther(10),
  ])
  console.log('SequencerVCS deployed: ', sequencerVCS.address)

  await (await stakingPool.addStrategy(sequencerVCS.address)).wait()

  updateDeployments(
    { METIS_SequencerVCS: sequencerVCS.address },
    { METIS_SequencerVCS: 'SequencerVCS' }
  )
}

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
// LINK Priority Pool
const PriorityPoolArgs = {
  queueDepositMin: toEther(1000), // min amount of tokens neede to execute deposit
  queueDepositMax: toEther(200000), // max amount of tokens in a single deposit tx
}

export async function deployMETISStaking() {
  const { accounts } = await getAccounts()
  const sdlPoolPrimary = (await getContract('SDLPoolPrimary')) as SDLPoolPrimary

  const metisToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
    'Metis',
    'METIS',
    1000000,
  ])) as ERC677
  console.log('METISToken deployed: ', metisToken.address)

  const stakingPool = (await deployUpgradeable('StakingPool', [
    metisToken.address,
    StakingPoolArgs.derivativeTokenName,
    StakingPoolArgs.derivativeTokenSymbol,
    StakingPoolArgs.fees,
  ])) as StakingPool
  console.log('METIS_StakingPool deployed: ', stakingPool.address)

  const priorityPool = (await deployUpgradeable('PriorityPool', [
    metisToken.address,
    stakingPool.address,
    sdlPoolPrimary.address,
    PriorityPoolArgs.queueDepositMin,
    PriorityPoolArgs.queueDepositMax,
  ])) as PriorityPool
  console.log('METIS_PriorityPool deployed: ', priorityPool.address)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.address,
    WrappedSDTokenArgs.name,
    WrappedSDTokenArgs.symbol,
  ])
  console.log('METIS_WrappedSDToken token deployed: ', wsdToken.address)

  const stMetisSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPoolPrimary.address,
    stakingPool.address,
    wsdToken.address,
  ])
  console.log('stMetis_SDLRewardsPool deployed: ', stMetisSDLRewardsPool.address)

  await (await stakingPool.addFee(stMetisSDLRewardsPool.address, 1000)).wait()
  await (await sdlPoolPrimary.addToken(stakingPool.address, stMetisSDLRewardsPool.address)).wait()
  await (await stakingPool.setPriorityPool(priorityPool.address)).wait()
  await (await priorityPool.setDistributionOracle(accounts[0])).wait()

  updateDeployments(
    {
      METISToken: metisToken.address,
      METIS_StakingPool: stakingPool.address,
      METIS_PriorityPool: priorityPool.address,
      METIS_WrappedSDToken: wsdToken.address,
      stMETIS_SDLRewardsPool: stMetisSDLRewardsPool.address,
    },
    {
      METISToken: 'contracts/core/tokens/base/ERC677.sol:ERC677',
      METIS_StakingPool: 'StakingPool',
      METIS_PriorityPool: 'PriorityPool',
      METIS_WrappedSDToken: 'WrappedSDToken',
      stMETIS_SDLRewardsPool: 'RewardsPoolWSD',
    }
  )

  await deploySequencerVCS()
}
