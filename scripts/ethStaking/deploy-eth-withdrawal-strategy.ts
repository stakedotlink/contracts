import { ETHWithdrawalStrategy, StakingPool } from '../../typechain-types'
import { deployUpgradeable, getContract, updateDeployments, deploy } from '../utils/deployment'
import { toEther } from '../utils/helpers'

// Tokens
const stETHToken = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84'

// ETH Withdrawal Strategy
const ETH_WithdrawalStrategy = {
  minMaxDeposits: toEther(500), // minimum value for dynamic max deposit limit
  targetUtilization: 5000, // basis point target of total deposits that should be in use at any given time
}
// stETH Curve Fee Adapter
const CurveFee = {
  curvePool: '0xdc24316b9ae028f1497c275eb9192a3ea0f67022', // address of curve pool
  fromIndex: 1, // index of stETH in curve pool
  toIndex: 0, // index of ETH in curve pool
  minFeeBasisPoints: 10, // minimum fee basis point fee to be paid on withdrawals
  maxFeeBasisPoints: 500, // maximum basis point fee to be paid on withdrawals
  feeUndercutBasisPoints: 1000, // basis point amount to be subtracted off the current curve fee when calculating a withdrawal fee
}
// ETH Lido Withdrawal Adapter
const ETH_LidoWithdrawalAdapter = {
  lidoWithdrawalQueueERC721: '', // address of Lido withdrawal queue ERC721
  instantAmountBasisPoints: 9000, // basis point amount of ETH instantly received when initiating a withdrawal
  minWithdrawalAmount: toEther(0.1), // minimum ETH withdrawal amount
}

async function main() {
  const wETHToken = await getContract('wETHToken')
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool

  const ethWithdrawalStrategy = (await deployUpgradeable('ETHWithdrawalStrategy', [
    wETHToken.address,
    stakingPool.address,
    ETH_WithdrawalStrategy.minMaxDeposits,
    ETH_WithdrawalStrategy.targetUtilization,
  ])) as ETHWithdrawalStrategy
  console.log('ETH_WithdrawalStrategy deployed: ', ethWithdrawalStrategy.address)

  const curveFee = await deploy('CurveFee', [
    CurveFee.curvePool,
    CurveFee.fromIndex,
    CurveFee.toIndex,
    CurveFee.minFeeBasisPoints,
    CurveFee.maxFeeBasisPoints,
    CurveFee.feeUndercutBasisPoints,
  ])
  console.log('ETH_stETH_CurveFee deployed: ', curveFee.address)

  const lidoWithdrawalAdapter = await deployUpgradeable('LidoWithdrawalAdapter', [
    ethWithdrawalStrategy.address,
    curveFee.address,
    ETH_LidoWithdrawalAdapter.lidoWithdrawalQueueERC721,
    stETHToken,
    ETH_LidoWithdrawalAdapter.instantAmountBasisPoints,
    ETH_LidoWithdrawalAdapter.minWithdrawalAmount,
  ])
  console.log('ETH_LidoWithdrawalAdapter deployed: ', ethWithdrawalStrategy.address)

  let tx = await ethWithdrawalStrategy.addAdapter(lidoWithdrawalAdapter.address)
  await tx.wait()

  tx = await stakingPool.addStrategy(ethWithdrawalStrategy.address)
  await tx.wait()

  updateDeployments(
    {
      ETH_WithdrawalStrategy: ethWithdrawalStrategy.address,
      ETH_stETH_CurveFee: curveFee.address,
      ETH_LidoWithdrawalAdapter: lidoWithdrawalAdapter.address,
    },
    {
      ETH_WithdrawalStrategy: 'ETHWithdrawalStrategy',
      ETH_stETH_CurveFee: 'CurveFee',
      ETH_LidoWithdrawalAdapter: 'LidoWithdrawalAdapter',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
