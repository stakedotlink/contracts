import { ethers } from 'hardhat'
import { PriorityPool, SDLPool, StakingPool } from '../../../../typechain-types'
import {
  updateDeployments,
  deploy,
  getContract,
  deployUpgradeable,
  deployImplementation,
} from '../../../utils/deployment'
import { getAccounts, toEther } from '../../../utils/helpers'

// Polygon Strategy
const PolygonStrategyArgs = {
  validatorMEVRewardsPercentage: 1000,
  fees: [],
}
// Wrapped stPOL
const WrappedSDTokenArgs = {
  name: 'Wrapped stPOL', // wrapped token name
  symbol: 'wstPOL', // wrapped token symbol
}
// POL Staking Pool
const StakingPoolArgs = {
  derivativeTokenName: 'Staked POL', // POL staking derivative token name
  derivativeTokenSymbol: 'stPOL', // POL staking derivative token symbol
  fees: [], // fee receivers & percentage amounts in basis points
  unusedDepositLimit: toEther(10000), // max number of tokens that can sit in the pool outside of a strategy
}
// POL Priority Pool
const PriorityPoolArgs = {
  queueDepositMin: 0, // min amount of tokens needed to execute deposit
  queueDepositMax: 100000000000, // max amount of tokens in a single deposit tx
}
// POL Withdrawal Pool
const WithdrawalPoolArgs = {
  minWithdrawalAmount: toEther(100), // minimum amount of LSTs that can be queued for withdrawal
  minTimeBetweenWithdrawals: 86400, // min amount of time between execution of withdrawals
}

export async function deployPOLStaking() {
  const { accounts } = await getAccounts()
  const sdlPool = (await getContract('SDLPool')) as SDLPool

  const polToken = await deploy('ERC20Mintable', ['Polygon', 'POL', 10000000])
  console.log('POLToken deployed: ', polToken.target)

  const stakingPool = (await deployUpgradeable('StakingPool', [
    polToken.target,
    StakingPoolArgs.derivativeTokenName,
    StakingPoolArgs.derivativeTokenSymbol,
    StakingPoolArgs.fees,
    StakingPoolArgs.unusedDepositLimit,
  ])) as StakingPool
  console.log('POL_StakingPool deployed: ', stakingPool.target)

  const priorityPool = (await deployUpgradeable('PriorityPool', [
    polToken.target,
    stakingPool.target,
    sdlPool.target,
    PriorityPoolArgs.queueDepositMin,
    PriorityPoolArgs.queueDepositMax,
    true,
  ])) as PriorityPool
  console.log('POL_PriorityPool deployed: ', priorityPool.target)

  const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
    polToken.target,
    stakingPool.target,
    priorityPool.target,
    WithdrawalPoolArgs.minWithdrawalAmount,
    WithdrawalPoolArgs.minTimeBetweenWithdrawals,
  ])) as PriorityPool
  console.log('POL_WithdrawalPool deployed: ', withdrawalPool.target)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.target,
    WrappedSDTokenArgs.name,
    WrappedSDTokenArgs.symbol,
  ])
  console.log('POL_WrappedSDToken token deployed: ', wsdToken.target)

  const stPolSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPool.target,
    stakingPool.target,
    wsdToken.target,
  ])
  console.log('stPOL_SDLRewardsPool deployed: ', stPolSDLRewardsPool.target)

  const stakeManager = await deploy('PolygonStakeManagerMock', [polToken.target, 86400])
  const vaultImp = await deployImplementation('PolygonVault')

  const strategy = await deployUpgradeable('PolygonStrategy', [
    polToken.target,
    stakingPool.target,
    stakeManager.target,
    vaultImp,
    PolygonStrategyArgs.validatorMEVRewardsPercentage,
    PolygonStrategyArgs.fees,
  ])

  const mevRewardsPool = await deploy('RewardsPoolWSD', [
    strategy.target,
    stakingPool.target,
    wsdToken.target,
  ])
  console.log('POL_MEVRewardsPool deployed at', mevRewardsPool.target)

  const fundFlowController = await deployUpgradeable('PolygonFundFlowController', [
    strategy.target,
    withdrawalPool.target,
    accounts[0],
    7 * 86400,
  ])
  console.log('POL_PolygonFundFlowController deployed at', fundFlowController.target)

  updateDeployments(
    {
      POLToken: polToken.target,
      POL_StakingPool: stakingPool.target.toString(),
      POL_PriorityPool: priorityPool.target.toString(),
      POL_WithdrawalPool: withdrawalPool.target.toString(),
      POL_WrappedSDToken: wsdToken.target,
      stPOL_SDLRewardsPool: stPolSDLRewardsPool.target,
      POL_PolygonStrategy: strategy.target,
      POL_PolygonFundFlowController: fundFlowController.target,
      POL_MEVRewardsPool: mevRewardsPool.target,
    },
    {
      POLToken: 'ERC20Mintable',
      POL_StakingPool: 'StakingPool',
      POL_PriorityPool: 'PriorityPool',
      POL_WithdrawalPool: 'WithdrawalPool',
      POL_WrappedSDToken: 'WrappedSDToken',
      stPOL_SDLRewardsPool: 'RewardsPoolWSD',
      POL_PolygonStrategy: 'PolygonStrategy',
      POL_PolygonFundFlowController: 'PolygonFundFlowController',
      POL_MEVRewardsPool: 'RewardsPoolWSD',
    }
  )

  await (await sdlPool.addToken(stakingPool.target, stPolSDLRewardsPool.target)).wait()
  await (await stakingPool.setPriorityPool(priorityPool.target)).wait()
  await (await stakingPool.setRebaseController(accounts[0])).wait()
  await (await stakingPool.addStrategy(strategy.target)).wait()
  await (await priorityPool.setDistributionOracle(accounts[0])).wait()
  await (await priorityPool.setWithdrawalPool(withdrawalPool.target)).wait()
  await (await strategy.setFundFlowController(fundFlowController.target)).wait()
  await (await strategy.setValidatorMEVRewardsPool(mevRewardsPool.target)).wait()
}
