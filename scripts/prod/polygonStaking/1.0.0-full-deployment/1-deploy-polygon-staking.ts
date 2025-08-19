import { ethers } from 'hardhat'
import { PolygonStrategy, PriorityPool, StakingPool } from '../../../../typechain-types'
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
  stakeManager: '0x5e3Ef299fDDf15eAa0432E6e66473ace8c13D908', // address of the Polygon stake manager contract
  validatorMEVRewardsPercentage: 0, // percentage of validator MEV rewards to be paid to validators in basis points
  fees: [], // fee receivers & percentage amounts in basis points
}
// Wrapped stPOL
const WrappedSDTokenArgs = {
  name: 'Wrapped stPOL', // wrapped token name
  symbol: 'wstPOL', // wrapped token symbol
}
// Rebase Controller
const RebaseControllerArgs = {
  emergencyPauser: '0x785a2de1cad17721b05d111bf087b1d87048f4a5', // address authorized to pause pool in case of emergency
  rewardsUpdater: '0xf5c08D55a77063ac4E5E18F1a470804088BE1ad4', // address authorized to update rewards
}
// Staking Pool
const StakingPoolArgs = {
  derivativeTokenName: 'Staked POL', // POL staking derivative token name
  derivativeTokenSymbol: 'stPOL', // POL staking derivative token symbol
  fees: [['0x23c4602e63ACfe29b930c530B19d44a84AF0d767', 300]], // fee receivers & percentage amounts in basis points
  unusedDepositLimit: ethers.MaxUint256, // max number of tokens that can sit in the pool outside of a strategy
}
// Priority Pool
const PriorityPoolArgs = {
  queueDepositMin: 0, // min amount of tokens needed to execute deposit
  queueDepositMax: toEther(10000000000), // max amount of tokens in a single deposit tx
}
// Withdrawal Pool
const WithdrawalPoolArgs = {
  minWithdrawalAmount: toEther(100), // minimum amount of LSTs that can be queued for withdrawal
  minTimeBetweenWithdrawals: 0, // min amount of time between execution of withdrawals
}
// Fund Flow Controller
const FundFlowControllerArgs = {
  minTimeBetweenUnbonding: 7 * 86400, // min amount of time between unbonding
}
// LinkPool validator params
const LinkPoolValidator = {
  validatorShare: '0xAA43C63c727014B9E14fce0AFd32Ced157E7085e', // address of the validator share contract
  rewardsReceiver: '0x23c4602e63ACfe29b930c530B19d44a84AF0d767', // address to recieve MEV rewards
}

async function main() {
  const { accounts } = await getAccounts()
  const polToken = await getContract('POLToken')
  const sdlPool = await getContract('SDLPool')

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

  const rebaseController = await deploy('RebaseController', [
    stakingPool.target,
    priorityPool.target,
    ethers.ZeroAddress,
    RebaseControllerArgs.emergencyPauser,
    RebaseControllerArgs.rewardsUpdater,
  ])
  console.log('POL_RebaseController deployed: ', rebaseController.target)

  const withdrawalPool = await deployUpgradeable('WithdrawalPool', [
    polToken.target,
    stakingPool.target,
    priorityPool.target,
    WithdrawalPoolArgs.minWithdrawalAmount,
    WithdrawalPoolArgs.minTimeBetweenWithdrawals,
  ])
  console.log('POL_WithdrawalPool deployed: ', withdrawalPool.target)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.target,
    WrappedSDTokenArgs.name,
    WrappedSDTokenArgs.symbol,
  ])
  console.log('POL_WrappedSDToken token deployed: ', wsdToken.target)

  const vaultImp = await deployImplementation('PolygonVault')

  const strategy = (await deployUpgradeable('PolygonStrategy', [
    polToken.target,
    stakingPool.target,
    PolygonStrategyArgs.stakeManager,
    vaultImp,
    PolygonStrategyArgs.validatorMEVRewardsPercentage,
    PolygonStrategyArgs.fees,
  ])) as PolygonStrategy
  console.log('POL_PolygonStrategy deployed at', strategy.target)

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
    FundFlowControllerArgs.minTimeBetweenUnbonding,
  ])
  console.log('POL_PolygonFundFlowController deployed at', fundFlowController.target)

  const stPolSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPool.target,
    stakingPool.target,
    wsdToken.target,
  ])
  console.log('stPOL_SDLRewardsPool deployed: ', stPolSDLRewardsPool.target)

  updateDeployments(
    {
      POL_StakingPool: stakingPool.target.toString(),
      POL_PriorityPool: priorityPool.target.toString(),
      POL_RebaseController: rebaseController.target,
      POL_WithdrawalPool: withdrawalPool.target.toString(),
      POL_WrappedSDToken: wsdToken.target,
      POL_PolygonStrategy: strategy.target.toString(),
      POL_PolygonFundFlowController: fundFlowController.target,
      POL_MEVRewardsPool: mevRewardsPool.target,
      stPOL_SDLRewardsPool: stPolSDLRewardsPool.target,
    },
    {
      POL_StakingPool: 'StakingPool',
      POL_PriorityPool: 'PriorityPool',
      POL_RebaseController: 'RebaseController',
      POL_WithdrawalPool: 'WithdrawalPool',
      POL_WrappedSDToken: 'WrappedSDToken',
      POL_PolygonStrategy: 'PolygonStrategy',
      POL_PolygonFundFlowController: 'PolygonFundFlowController',
      POL_MEVRewardsPool: 'RewardsPoolWSD',
      stPOL_SDLRewardsPool: 'RewardsPoolWSD',
    }
  )

  await (await stakingPool.setPriorityPool(priorityPool.target)).wait()
  await (await stakingPool.setRebaseController(rebaseController.target)).wait()
  await (await stakingPool.addStrategy(strategy.target)).wait()
  await (await priorityPool.setWithdrawalPool(withdrawalPool.target)).wait()
  await (await priorityPool.setRebaseController(rebaseController.target)).wait()
  await (await strategy.setFundFlowController(fundFlowController.target)).wait()
  await (await strategy.setValidatorMEVRewardsPool(mevRewardsPool.target)).wait()
  await (
    await strategy.addValidator(LinkPoolValidator.validatorShare, LinkPoolValidator.rewardsReceiver)
  ).wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
