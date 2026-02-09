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

// Espresso Strategy
const EspressoStrategyArgs = {
  maxRewardChangeBPS: 300, // max reward change allowed per update in basis points (100% = 10000)
  fees: [],
}
// Wrapped stESP
const WrappedSDTokenArgs = {
  name: 'Wrapped stESP', // wrapped token name
  symbol: 'wstESP', // wrapped token symbol
}
// Espresso Staking Pool
const StakingPoolArgs = {
  derivativeTokenName: 'Staked ESP', // Espresso staking derivative token name
  derivativeTokenSymbol: 'stESP', // Espresso staking derivative token symbol
  fees: [], // fee receivers & percentage amounts in basis points
  unusedDepositLimit: ethers.MaxUint256, // max number of tokens that can sit in the pool outside of a strategy
}
// Espresso Priority Pool
const PriorityPoolArgs = {
  queueDepositMin: 0, // min amount of tokens needed to execute deposit
  queueDepositMax: toEther(100000000000), // max amount of tokens in a single deposit tx
}
// Espresso Withdrawal Pool
const WithdrawalPoolArgs = {
  minWithdrawalAmount: toEther(100), // minimum amount of LSTs that can be queued for withdrawal
  minTimeBetweenWithdrawals: 0, // min amount of time between execution of withdrawals
}
// Fund Flow Controller
const FundFlowControllerArgs = {
  minTimeBetweenUnbonding: 7 * 86400, // min amount of time between unbonding (7 days)
}

const exitEscrowPeriod = 86400 // 1 day

export async function deployESPStaking() {
  const { accounts } = await getAccounts()
  const sdlPool = (await getContract('SDLPool')) as SDLPool

  const espressoToken = await deploy('ERC20Mintable', ['Espresso', 'ESP', 10000000])
  console.log('ESPToken deployed: ', espressoToken.target)

  const stakingPool = (await deployUpgradeable('StakingPool', [
    espressoToken.target,
    StakingPoolArgs.derivativeTokenName,
    StakingPoolArgs.derivativeTokenSymbol,
    StakingPoolArgs.fees,
    StakingPoolArgs.unusedDepositLimit,
  ])) as StakingPool
  console.log('ESP_StakingPool deployed: ', stakingPool.target)

  const priorityPool = (await deployUpgradeable('PriorityPool', [
    espressoToken.target,
    stakingPool.target,
    sdlPool.target,
    PriorityPoolArgs.queueDepositMin,
    PriorityPoolArgs.queueDepositMax,
    true,
  ])) as PriorityPool
  console.log('ESP_PriorityPool deployed: ', priorityPool.target)

  const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
    espressoToken.target,
    stakingPool.target,
    priorityPool.target,
    WithdrawalPoolArgs.minWithdrawalAmount,
    WithdrawalPoolArgs.minTimeBetweenWithdrawals,
  ])) as PriorityPool
  console.log('ESP_WithdrawalPool deployed: ', withdrawalPool.target)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.target,
    WrappedSDTokenArgs.name,
    WrappedSDTokenArgs.symbol,
  ])
  console.log('ESP_WrappedSDToken deployed: ', wsdToken.target)

  const stEspressoSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPool.target,
    stakingPool.target,
    wsdToken.target,
  ])
  console.log('stESP_SDLRewardsPool deployed: ', stEspressoSDLRewardsPool.target)

  const espressoStaking = await deploy('EspressoStakingMock', [
    espressoToken.target,
    exitEscrowPeriod,
  ])
  console.log('EspressoStakingMock deployed: ', espressoStaking.target)

  const espressoRewards = await deploy('EspressoRewardsMock', [espressoToken.target, 0])
  console.log('EspressoRewardsMock deployed: ', espressoRewards.target)

  const vaultImp = await deployImplementation('EspressoVault')
  console.log('EspressoVault implementation deployed: ', vaultImp)

  const strategy = await deployUpgradeable('EspressoStrategy', [
    espressoToken.target,
    stakingPool.target,
    espressoStaking.target,
    espressoRewards.target,
    vaultImp,
    EspressoStrategyArgs.maxRewardChangeBPS,
    EspressoStrategyArgs.fees,
  ])
  console.log('ESP_EspressoStrategy deployed at', strategy.target)

  const fundFlowController = await deployUpgradeable('EspressoFundFlowController', [
    strategy.target,
    withdrawalPool.target,
    accounts[0],
    FundFlowControllerArgs.minTimeBetweenUnbonding,
  ])
  console.log('ESP_EspressoFundFlowController deployed at', fundFlowController.target)

  updateDeployments(
    {
      ESPToken: espressoToken.target,
      ESP_StakingPool: stakingPool.target.toString(),
      ESP_PriorityPool: priorityPool.target.toString(),
      ESP_WithdrawalPool: withdrawalPool.target.toString(),
      ESP_WrappedSDToken: wsdToken.target,
      stESP_SDLRewardsPool: stEspressoSDLRewardsPool.target,
      ESP_EspressoStrategy: strategy.target,
      ESP_EspressoFundFlowController: fundFlowController.target,
      EspressoStakingMock: espressoStaking.target,
      EspressoRewardsMock: espressoRewards.target,
    },
    {
      ESPToken: 'ERC20Mintable',
      ESP_StakingPool: 'StakingPool',
      ESP_PriorityPool: 'PriorityPool',
      ESP_WithdrawalPool: 'WithdrawalPool',
      ESP_WrappedSDToken: 'WrappedSDToken',
      stESP_SDLRewardsPool: 'RewardsPoolWSD',
      ESP_EspressoStrategy: 'EspressoStrategy',
      ESP_EspressoFundFlowController: 'EspressoFundFlowController',
      EspressoStakingMock: 'EspressoStakingMock',
      EspressoRewardsMock: 'EspressoRewardsMock',
    }
  )

  await (await sdlPool.addToken(stakingPool.target, stEspressoSDLRewardsPool.target)).wait()
  await (await stakingPool.setPriorityPool(priorityPool.target)).wait()
  await (await stakingPool.setRebaseController(accounts[0])).wait()
  await (await stakingPool.addStrategy(strategy.target)).wait()
  await (await priorityPool.setDistributionOracle(accounts[0])).wait()
  await (await priorityPool.setWithdrawalPool(withdrawalPool.target)).wait()
  await (await strategy.setFundFlowController(fundFlowController.target)).wait()
  await (await strategy.setRewardsOracle(accounts[0])).wait()
}
