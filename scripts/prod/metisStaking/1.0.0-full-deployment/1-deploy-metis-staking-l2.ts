import { ethers } from 'hardhat'
import { ERC20, PriorityPool, StakingPool } from '../../../../typechain-types'
import {
  updateDeployments,
  deploy,
  getContract,
  deployUpgradeable,
} from '../../../utils/deployment'
import { toEther } from '../../../utils/helpers'
import { L2Strategy } from '../../../../typechain-types/contracts/metisStaking/L2Strategy'

// Wrapped stMETIS
const WrappedSDTokenArgs = {
  name: 'Wrapped stMETIS', // wrapped token name
  symbol: 'wstMETIS', // wrapped token symbol
}
// METIS Staking Pool
const StakingPoolArgs = {
  derivativeTokenName: 'Staked METIS', // METIS liquid staking token name
  derivativeTokenSymbol: 'stMETIS', // METIS liquid staking token symbol
  fees: [
    ['0x23c4602e63ACfe29b930c530B19d44a84AF0d767', 300],
    ['0x23c4602e63ACfe29b930c530B19d44a84AF0d767', 600],
    ['0x04a0CF74fa31d75CFf4b87823cC44353c7be4dE4', 300],
  ], // fee receivers & percentage amounts in basis points
  unusedDepositLimit: toEther(1000), // max number of tokens that can sit in the pool outside of a strategy
}
// L2 Strategy
const L2StrategyArgs = {
  fees: [], // list of fees to be paid on rewards
  maxDeposits: toEther(1), // maximum amount of deposits strategy can hold
}
// METIS Priority Pool
const PriorityPoolArgs = {
  queueDepositMin: toEther(500), // min amount of tokens needed to execute deposit
  queueDepositMax: toEther(100000), // max amount of tokens in a single deposit tx
  allowInstantWithdrawals: true, // whether instant withdrawals are enabled
}
// Withdrawal Pool
const WithdrawalPoolArgs = {
  minWithdrawalAmount: toEther(1), // minimum amount of LSTs that can be queued for withdrawal
  minTimeBetweenWithdrawals: 86400, // min amount of time between execution of withdrawals
}
// L2 Transmitter
const L2TransmitterArgs = {
  l2StandardBridge: '0x4200000000000000000000000000000000000010', // address of the L2 standard bridge
  l2StandardBridgeGasOracle: '0x420000000000000000000000000000000000000F', // address of OVM_GasPriceOracle
  minDepositThreshold: toEther(5000), // must exceed this amount of queued tokens to deposit to L1
  minTimeBetweenUpdates: 86400 * 7, // min amount of time between calls to executeUpdate
  ccipRouter: '0x7b9FB8717D306e2e08ce2e1Efa81F026bf9AD13c', // address of CCIP router
  l1ChainSelector: '5009297550715157269', // CCIP selector for L1
  extraArgs:
    '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [500000]).slice(2), // extra args for CCIP messaging
}

async function main() {
  const metisToken = (await getContract('METISToken', true)) as ERC20

  const stakingPool = (await deployUpgradeable(
    'StakingPool',
    [
      metisToken.target,
      StakingPoolArgs.derivativeTokenName,
      StakingPoolArgs.derivativeTokenSymbol,
      StakingPoolArgs.fees,
      StakingPoolArgs.unusedDepositLimit,
    ],
    true
  )) as StakingPool
  console.log('METIS_StakingPool deployed: ', stakingPool.target)

  const priorityPool = (await deployUpgradeable(
    'PriorityPool',
    [
      metisToken.target,
      stakingPool.target,
      ethers.ZeroAddress,
      PriorityPoolArgs.queueDepositMin,
      PriorityPoolArgs.queueDepositMax,
      PriorityPoolArgs.allowInstantWithdrawals,
    ],
    true
  )) as PriorityPool
  console.log('METIS_PriorityPool deployed: ', priorityPool.target)

  const withdrawalPool = await deployUpgradeable(
    'WithdrawalPool',
    [
      metisToken.target,
      stakingPool.target,
      priorityPool.target,
      WithdrawalPoolArgs.minWithdrawalAmount,
      WithdrawalPoolArgs.minTimeBetweenWithdrawals,
    ],
    true
  )
  console.log('METIS_WithdrawalPool deployed: ', withdrawalPool.target)

  const wsdToken = await deploy(
    'WrappedSDToken',
    [stakingPool.target, WrappedSDTokenArgs.name, WrappedSDTokenArgs.symbol],
    true
  )
  console.log('METIS_WrappedSDToken token deployed: ', wsdToken.target)

  const l2Strategy = (await deployUpgradeable(
    'L2Strategy',
    [metisToken.target, stakingPool.target, L2StrategyArgs.fees, L2StrategyArgs.maxDeposits],
    true
  )) as L2Strategy
  console.log('METIS_L2Strategy deployed: ', l2Strategy.target)

  const l2Transmitter = await deployUpgradeable(
    'L2Transmitter',
    [
      metisToken.target,
      l2Strategy.target,
      L2TransmitterArgs.l2StandardBridge,
      L2TransmitterArgs.l2StandardBridgeGasOracle,
      ethers.ZeroAddress,
      withdrawalPool.target,
      L2TransmitterArgs.minDepositThreshold,
      L2TransmitterArgs.minTimeBetweenUpdates,
      L2TransmitterArgs.ccipRouter,
      L2TransmitterArgs.l1ChainSelector,
      L2TransmitterArgs.extraArgs,
    ],
    true
  )
  console.log('METIS_L2Transmitter deployed: ', l2Transmitter.target)

  await (await stakingPool.setPriorityPool(priorityPool.target)).wait()
  await (await stakingPool.addStrategy(l2Strategy.target)).wait()
  await (await l2Strategy.setL2Transmitter(l2Transmitter.target)).wait()
  await (await priorityPool.setWithdrawalPool(withdrawalPool.target)).wait()

  updateDeployments(
    {
      METIS_StakingPool: stakingPool.target.toString(),
      METIS_L2Strategy: l2Strategy.target.toString(),
      METIS_L2Transmitter: l2Transmitter.target,
      METIS_PriorityPool: priorityPool.target.toString(),
      METIS_WithdrawalPool: withdrawalPool.target,
      METIS_WrappedSDToken: wsdToken.target,
    },
    {
      METIS_StakingPool: 'StakingPool',
      METIS_L2Strategy: 'L2Strategy',
      METIS_L2Transmitter: 'L2Transmitter',
      METIS_PriorityPool: 'PriorityPool',
      METIS_WithdrawalPool: 'WithdrawalPool',
      METIS_WrappedSDToken: 'WrappedSDToken',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
