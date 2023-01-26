import { updateDeployments, deployUpgradeable, deploy, getContract } from '../utils/deployment'
import { toEther } from '../utils/helpers'
import { DelegatorPool, LiquidSDIndexPool } from "../../typechain-types";

// ETH LSD Index
const ETH_LSDIndexPool = {
  name: 'Index ETH', // wrapped staking derivative token name
  symbol: 'iETH', // wrapped staking derivative token symbol
  compositionTolerance: 5000, // pool composition tolerance
  compositionEnforcementThreshold: 10000, // ETH intervals in which composition is enforced
  fee: 25 // delegator pool fee basis points
}
// Wrapped iETH
const iETH_WrappedSDToken = {
  derivativeTokenName: 'Wrapped iETH', // Wrapped iETH token name
  derivativeTokenSymbol: 'wiETH', // Wrapped iETH token symbol
}

async function main() {
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool

  const indexPool = await deployUpgradeable('LiquidSDIndexPool', [
    ETH_LSDIndexPool.name,
    ETH_LSDIndexPool.symbol,
    ETH_LSDIndexPool.compositionTolerance,
    toEther(ETH_LSDIndexPool.compositionEnforcementThreshold),
  ]) as LiquidSDIndexPool
  console.log('LiquidSDIndexPool deployed: ', indexPool.address)

  await indexPool.addFee(delegatorPool.address, ETH_LSDIndexPool.fee)

  const wsdToken = await deploy('WrappedSDToken', [
    indexPool.address,
    iETH_WrappedSDToken.derivativeTokenName,
    iETH_WrappedSDToken.derivativeTokenSymbol,
  ])
  console.log('iETH_WrappedSDToken token deployed: ', wsdToken.address)

  const iETHDelegatorRewardsPool = await deploy('RewardsPoolWSD', [
    delegatorPool.address,
    indexPool.address,
    wsdToken.address,
  ])
  await delegatorPool.addToken(indexPool.address, iETHDelegatorRewardsPool.address)
  console.log('iETH_DelegatorRewardsPool deployed: ', iETHDelegatorRewardsPool.address)

  updateDeployments(
    {
      iETH_WrappedSDToken: wsdToken.address,
      iETHDelegatorRewardsPool: iETHDelegatorRewardsPool.address,
      LiquidSDIndexPool: indexPool.address,
    },
    {
      iETH_WrappedSDToken: 'WrappedSDToken',
      iETH_DelegatorRewardsPool: 'RewardsPoolWSD',
    }
  )

  console.log('deploy-status-ready')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
