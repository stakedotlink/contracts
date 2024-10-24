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

async function deployL2Strategy() {
  const metisToken = (await getContract('METISToken')) as ERC20
  const stakingPool = (await getContract('METIS_StakingPool')) as StakingPool

  const l2Strategy = await deployUpgradeable('StrategyMock', [
    metisToken.target,
    stakingPool.target,
    toEther(100000),
    toEther(20000),
  ])
  console.log('METIS_L2Strategy deployed: ', l2Strategy.target)

  await (await stakingPool.addStrategy(l2Strategy.target)).wait()

  updateDeployments({ METIS_L2Strategy: l2Strategy.target }, { METIS_L2Strategy: 'StrategyMock' })
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
  unusedDepositLimit: toEther(10000), // max number of tokens that can sit in the pool outside of a strategy
}
// METIS Priority Pool
const PriorityPoolArgs = {
  queueDepositMin: toEther(1000), // min amount of tokens neede to execute deposit
  queueDepositMax: toEther(200000), // max amount of tokens in a single deposit tx
}
// METIS Withdrawal Pool
const WithdrawalPoolArgs = {
  minWithdrawalAmount: toEther(1), // minimum amount of LSTs that can be queued for withdrawal
  minTimeBetweenWithdrawals: 86400, // min amount of time between execution of withdrawals
}

export async function deployMETISStaking() {
  const { accounts } = await getAccounts()
  const sdlPoolPrimary = (await getContract('SDLPool')) as SDLPoolPrimary

  const metisToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
    'Metis',
    'METIS',
    1000000,
  ])) as ERC677
  console.log('METISToken deployed: ', metisToken.target)

  const stakingPool = (await deployUpgradeable('StakingPool', [
    metisToken.target,
    StakingPoolArgs.derivativeTokenName,
    StakingPoolArgs.derivativeTokenSymbol,
    StakingPoolArgs.fees,
    StakingPoolArgs.unusedDepositLimit,
  ])) as StakingPool
  console.log('METIS_StakingPool deployed: ', stakingPool.target)

  const priorityPool = (await deployUpgradeable('PriorityPool', [
    metisToken.target,
    stakingPool.target,
    sdlPoolPrimary.target,
    PriorityPoolArgs.queueDepositMin,
    PriorityPoolArgs.queueDepositMax,
    true,
  ])) as PriorityPool
  console.log('METIS_PriorityPool deployed: ', priorityPool.target)

  const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
    metisToken.target,
    stakingPool.target,
    priorityPool.target,
    WithdrawalPoolArgs.minWithdrawalAmount,
    WithdrawalPoolArgs.minTimeBetweenWithdrawals,
  ])) as PriorityPool
  console.log('METIS_WithdrawalPool deployed: ', withdrawalPool.target)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.target,
    WrappedSDTokenArgs.name,
    WrappedSDTokenArgs.symbol,
  ])
  console.log('METIS_WrappedSDToken token deployed: ', wsdToken.target)

  const stMetisSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPoolPrimary.target,
    stakingPool.target,
    wsdToken.target,
  ])
  console.log('stMetis_SDLRewardsPool deployed: ', stMetisSDLRewardsPool.target)

  await (await sdlPoolPrimary.addToken(stakingPool.target, stMetisSDLRewardsPool.target)).wait()
  await (await stakingPool.setPriorityPool(priorityPool.target)).wait()
  await (await stakingPool.setRebaseController(accounts[0])).wait()
  await (await priorityPool.setDistributionOracle(accounts[0])).wait()
  await (await priorityPool.setWithdrawalPool(withdrawalPool.target)).wait()

  updateDeployments(
    {
      METISToken: metisToken.target.toString(),
      METIS_StakingPool: stakingPool.target.toString(),
      METIS_PriorityPool: priorityPool.target.toString(),
      METIS_WithdrawalPool: withdrawalPool.target.toString(),
      METIS_WrappedSDToken: wsdToken.target,
      stMETIS_SDLRewardsPool: stMetisSDLRewardsPool.target,
    },
    {
      METISToken: 'contracts/core/tokens/base/ERC677.sol:ERC677',
      METIS_StakingPool: 'StakingPool',
      METIS_PriorityPool: 'PriorityPool',
      METIS_WithdrawalPool: 'WithdrawalPool',
      METIS_WrappedSDToken: 'WrappedSDToken',
      stMETIS_SDLRewardsPool: 'RewardsPoolWSD',
    }
  )

  await deployL2Strategy()
}
