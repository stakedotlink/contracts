import {
  DelegatorPool,
  ERC677,
  PoolRouter,
  ETHWithdrawalStrategy as ETHWithdrawalStrategyInterface,
  ICurvePool,
} from '../../typechain-types'
import { updateDeployments, deploy, getContract, deployUpgradeable } from '../utils/deployment'
import { toEther } from '../utils/helpers'

// ETH Wrapped Staking Derivative Token
const ETH_WrappedSDToken = {
  name: 'Wrapped sdlETH', // wrapped staking derivative token name
  symbol: 'wsdlETH', // wrapped staking derivative token symbol
}
// ETH Staking Pool
const ETH_StakingPool = {
  derivativeTokenName: 'stake.link ETH', // ETH staking derivative token name
  derivativeTokenSymbol: 'sdlETH', // ETH staking derivative token symbol
  fees: [['0x6879826450e576B401c4dDeff2B7755B1e85d97c', 300]], // fee receivers & percentage amounts in basis points
}
// ETH Withdrawal Strategy
const ETHWithdrawalStrategy = {
  minMaxDeposits: toEther(500), // minimum value for dynamic max deposit limit
  targetUtilisation: 5000, // basis point target of total deposits that should be in use at any given time
}
// Lido Withdrawal Adapter
const LidoWithdrawalAdapter = {
  instantAmountBasisPoints: 9000, // basis point amount of ETH instantly received when initiating a withdrawal
  minWithdrawalAmount: toEther(0.1), // minimum ETH withdrawal amount
}
// CurveFee
const stETH_CurveFee = {
  fromIndex: 1, // index of stETH in curve pool
  toIndex: 0, // index of ETH in curve pool
  minFeeBasisPoints: 10, // minimum fee basis point fee to be paid on withdrawals
  maxFeeBasisPoints: 500, // maximum basis point fee to be paid on withdrawals
  feeUndercutBasisPoints: 1000, // basis point amount to be subtracted off the current curve fee when calculating a withdrawal fee
}

async function main() {
  const poolRouter = (await getContract('PoolRouter')) as PoolRouter
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const lidoWQERC721 = await getContract('LidoWQERC721')
  const stETHCurvePool = (await getContract('stETH_CurvePool')) as ICurvePool
  const stETHToken = await getContract('stETHToken')

  const wETHToken = (await deploy('WrappedETH')) as ERC677

  const stakingPool = await deployUpgradeable('StakingPool', [
    wETHToken.address,
    ETH_StakingPool.derivativeTokenName,
    ETH_StakingPool.derivativeTokenSymbol,
    ETH_StakingPool.fees,
    poolRouter.address,
    delegatorPool.address,
  ])
  console.log('ETH_StakingPool deployed: ', stakingPool.address)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.address,
    ETH_WrappedSDToken.name,
    ETH_WrappedSDToken.symbol,
  ])
  console.log('ETH_WrappedSDToken token deployed: ', wsdToken.address)

  const sdlETHDelegatorRewardsPool = await deploy('RewardsPoolWSD', [
    delegatorPool.address,
    stakingPool.address,
    wsdToken.address,
  ])
  console.log('sdlETH_DelegatorRewardsPool deployed: ', sdlETHDelegatorRewardsPool.address)

  const ethWithdrawalStrategy = (await deployUpgradeable('ETHWithdrawalStrategy', [
    wETHToken.address,
    stakingPool.address,
    ETHWithdrawalStrategy.minMaxDeposits,
    ETHWithdrawalStrategy.targetUtilisation,
  ])) as ETHWithdrawalStrategyInterface
  console.log('ETHWithdrawalStrategy deployed: ', ethWithdrawalStrategy.address)

  const curveFee = await deploy('CurveFee', [
    stETHCurvePool.address,
    stETH_CurveFee.fromIndex,
    stETH_CurveFee.toIndex,
    stETH_CurveFee.minFeeBasisPoints,
    stETH_CurveFee.maxFeeBasisPoints,
    stETH_CurveFee.feeUndercutBasisPoints,
  ])
  console.log('stETH_CurveFee deployed: ', curveFee.address)

  const lidoWithdrawalAdapter = await deployUpgradeable('LidoWithdrawalAdapter', [
    ethWithdrawalStrategy.address,
    curveFee.address,
    lidoWQERC721.address,
    stETHToken.address,
    LidoWithdrawalAdapter.instantAmountBasisPoints,
    LidoWithdrawalAdapter.minWithdrawalAmount,
  ])

  let tx = await ethWithdrawalStrategy.addAdapter(lidoWithdrawalAdapter.address)
  await tx.wait()

  tx = await stakingPool.addStrategy(ethWithdrawalStrategy.address)
  await tx.wait()

  tx = await poolRouter.addPool(stakingPool.address, 0, false)
  await tx.wait()

  tx = await delegatorPool.addToken(stakingPool.address, sdlETHDelegatorRewardsPool.address)
  await tx.wait()

  updateDeployments(
    {
      ETH_StakingPool: stakingPool.address,
      ETH_WrappedSDToken: wsdToken.address,
      sdlETH_DelegatorRewardsPool: sdlETHDelegatorRewardsPool.address,
      ETHWithdrawalStrategy: ethWithdrawalStrategy.address,
      LidoWithdrawalAdapter: lidoWithdrawalAdapter.address,
      stETH_CurveFee: curveFee.address,
    },
    {
      ETH_StakingPool: 'StakingPool',
      ETH_WrappedSDToken: 'WrappedSDToken',
      sdlETH_DelegatorRewardsPool: 'RewardsPoolWSD',
      stETH_CurveFee: 'CurveFee',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
