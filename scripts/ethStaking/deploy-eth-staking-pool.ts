import { DelegatorPool, PoolRouter } from '../../typechain-types'
import { updateDeployments, deploy, getContract, deployUpgradeable } from '../utils/deployment'

// ETH Wrapped Staking Derivative Token
const ETH_WrappedSDToken = {
  name: 'Wrapped sdlETH', // wrapped staking derivative token name
  symbol: 'wsdlETH', // wrapped staking derivative token symbol
}
// ETH Staking Pool
const ETH_StakingPool = {
  derivativeTokenName: 'stake.link ETH', // ETH staking derivative token name
  derivativeTokenSymbol: 'sdlETH', // ETH staking derivative token symbol
  fees: [], // fee receivers & percentage amounts in basis points
}

async function main() {
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const poolRouter = (await getContract('PoolRouter')) as PoolRouter

  const wETHToken = await deploy('WrappedETH')
  console.log('WrappedETH deployed: ', wETHToken.address)

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

  let tx = await poolRouter.addPool(stakingPool.address, 0, true)
  await tx.wait()

  tx = await delegatorPool.addToken(stakingPool.address, sdlETHDelegatorRewardsPool.address)
  await tx.wait()

  updateDeployments(
    {
      wETHToken: wETHToken.address,
      ETH_StakingPool: stakingPool.address,
      ETH_WrappedSDToken: wsdToken.address,
      sdlETH_DelegatorRewardsPool: sdlETHDelegatorRewardsPool.address,
    },
    {
      wETHToken: 'WrappedETH',
      ETH_StakingPool: 'StakingPool',
      ETH_WrappedSDToken: 'WrappedSDToken',
      sdlETH_DelegatorRewardsPool: 'RewardsPoolWSD',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
