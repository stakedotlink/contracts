import { ethers } from 'hardhat'
import { EspressoStrategy, PriorityPool, StakingPool } from '../../../../typechain-types'
import {
  updateDeployments,
  deploy,
  getContract,
  deployUpgradeable,
  deployImplementation,
} from '../../../utils/deployment'
import { toEther } from '../../../utils/helpers'

// Espresso Strategy
const EspressoStrategyArgs = {
  espressoStaking: '0xCeF474D372B5b09dEfe2aF187bf17338Dc704451', // address of the Espresso delegation contract
  espressoRewards: '0x67c966a0ecdd5c33608bE7810414e5b54DA878D8', // address of the Espresso rewards contract
  maxRewardChangeBPS: 300, // max reward change allowed per update in basis points
  fees: [], // fee receivers & percentage amounts in basis points
}
// Wrapped stESP
const WrappedSDTokenArgs = {
  name: 'Wrapped stESP', // wrapped token name
  symbol: 'wstESP', // wrapped token symbol
}
// Rebase Controller
const RebaseControllerArgs = {
  emergencyPauser: '0x785a2de1cad17721b05d111bf087b1d87048f4a5', // address authorized to pause pool in case of emergency
  rewardsUpdater: '0xf5c08D55a77063ac4E5E18F1a470804088BE1ad4', // address authorized to update rewards
}
// Staking Pool
const StakingPoolArgs = {
  derivativeTokenName: 'Staked ESP', // Espresso staking derivative token name
  derivativeTokenSymbol: 'stESP', // Espresso staking derivative token symbol
  fees: [['0x23c4602e63ACfe29b930c530B19d44a84AF0d767', 300]], // fee receivers & percentage amounts in basis points (3%)
  sdlFee: 1000, // basis point fee to be sent to SDL Pool
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
  depositController: '0xf5c08D55a77063ac4E5E18F1a470804088BE1ad4', // account authorized to deposit queued tokens
  minTimeBetweenUnbonding: 7 * 86400, // min amount of time between unbonding (7 days)
}

async function main() {
  const espressoToken = await getContract('ESPToken')
  const sdlPool = await getContract('SDLPool')

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

  const rebaseController = await deploy('RebaseController', [
    stakingPool.target,
    priorityPool.target,
    ethers.ZeroAddress,
    RebaseControllerArgs.emergencyPauser,
    RebaseControllerArgs.rewardsUpdater,
  ])
  console.log('ESP_RebaseController deployed: ', rebaseController.target)

  const withdrawalPool = await deployUpgradeable('WithdrawalPool', [
    espressoToken.target,
    stakingPool.target,
    priorityPool.target,
    WithdrawalPoolArgs.minWithdrawalAmount,
    WithdrawalPoolArgs.minTimeBetweenWithdrawals,
  ])
  console.log('ESP_WithdrawalPool deployed: ', withdrawalPool.target)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.target,
    WrappedSDTokenArgs.name,
    WrappedSDTokenArgs.symbol,
  ])
  console.log('ESP_WrappedSDToken deployed: ', wsdToken.target)

  const vaultImp = await deployImplementation('EspressoVault')
  console.log('Vault implementation deployed: ', vaultImp)

  const strategy = (await deployUpgradeable('EspressoStrategy', [
    espressoToken.target,
    stakingPool.target,
    EspressoStrategyArgs.espressoStaking,
    EspressoStrategyArgs.espressoRewards,
    vaultImp,
    EspressoStrategyArgs.maxRewardChangeBPS,
    EspressoStrategyArgs.fees,
  ])) as EspressoStrategy
  console.log('ESP_EspressoStrategy deployed at', strategy.target)

  const fundFlowController = await deployUpgradeable('EspressoFundFlowController', [
    strategy.target,
    withdrawalPool.target,
    FundFlowControllerArgs.depositController,
    FundFlowControllerArgs.minTimeBetweenUnbonding,
  ])
  console.log('ESP_EspressoFundFlowController deployed at', fundFlowController.target)

  const stEspSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPool.target,
    stakingPool.target,
    wsdToken.target,
  ])
  console.log('stESP_SDLRewardsPool deployed: ', stEspSDLRewardsPool.target)

  updateDeployments(
    {
      ESP_StakingPool: stakingPool.target.toString(),
      ESP_PriorityPool: priorityPool.target.toString(),
      ESP_RebaseController: rebaseController.target,
      ESP_WithdrawalPool: withdrawalPool.target.toString(),
      ESP_WrappedSDToken: wsdToken.target,
      ESP_EspressoStrategy: strategy.target.toString(),
      ESP_EspressoFundFlowController: fundFlowController.target,
      stESP_SDLRewardsPool: stEspSDLRewardsPool.target,
    },
    {
      ESP_StakingPool: 'StakingPool',
      ESP_PriorityPool: 'PriorityPool',
      ESP_RebaseController: 'RebaseController',
      ESP_WithdrawalPool: 'WithdrawalPool',
      ESP_WrappedSDToken: 'WrappedSDToken',
      ESP_EspressoStrategy: 'EspressoStrategy',
      ESP_EspressoFundFlowController: 'EspressoFundFlowController',
      stESP_SDLRewardsPool: 'RewardsPoolWSD',
    }
  )

  console.log('\n--- Setting up contract relationships ---')

  await (await stakingPool.setPriorityPool(priorityPool.target)).wait()
  await (await stakingPool.setRebaseController(rebaseController.target)).wait()
  await (await stakingPool.addStrategy(strategy.target)).wait()
  await (await priorityPool.setWithdrawalPool(withdrawalPool.target)).wait()
  await (await priorityPool.setRebaseController(rebaseController.target)).wait()
  await (await strategy.setFundFlowController(fundFlowController.target)).wait()

  console.log('Done!')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
