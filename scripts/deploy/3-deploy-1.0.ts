import { DelegatorPool, ERC677, StakingAllowance } from '../../typechain-types'
import { updateDeployments, deploy, getContract, deployUpgradeable } from '../utils/deployment'

// LINK Wrapped Staking Derivative Token
const LINK_WrappedSDToken = {
  name: 'Wrapped stLINK', // wrapped staking derivative token name
  symbol: 'wstLINK', // wrapped staking derivative token symbol
}
// LINK Staking Pool
const LINK_StakingPool = {
  derivativeTokenName: 'Staked LINK', // LINK staking derivative token name
  derivativeTokenSymbol: 'stLINK', // LINK staking derivative token symbol
  fees: [['0x11187eff852069a33d102476b2E8A9cc9167dAde', 300]], // fee receivers & percentage amounts in basis points
}

async function main() {
  const linkToken = (await getContract('LINKToken')) as ERC677
  const stakingAllowance = (await getContract('SDLToken')) as StakingAllowance
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool

  const poolRouter = await deployUpgradeable('PoolRouter', [
    stakingAllowance.address,
    delegatorPool.address,
  ])
  console.log('PoolRouter deployed: ', poolRouter.address)

  const stakingPool = await deployUpgradeable('StakingPool', [
    linkToken.address,
    LINK_StakingPool.derivativeTokenName,
    LINK_StakingPool.derivativeTokenSymbol,
    LINK_StakingPool.fees,
    poolRouter.address,
    delegatorPool.address,
  ])
  console.log('LINK_StakingPool deployed: ', stakingPool.address)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.address,
    LINK_WrappedSDToken.name,
    LINK_WrappedSDToken.symbol,
  ])
  console.log('LINK_WrappedSDToken token deployed: ', wsdToken.address)

  const stLinkDelegatorRewardsPool = await deploy('RewardsPoolWSD', [
    delegatorPool.address,
    stakingPool.address,
    wsdToken.address,
  ])
  console.log('stLINK_DelegatorRewardsPool deployed: ', stLinkDelegatorRewardsPool.address)

  let tx = await poolRouter.addPool(linkToken.address, stakingPool.address, 0, true)
  await tx.wait()

  tx = await delegatorPool.addToken(stakingPool.address, stLinkDelegatorRewardsPool.address)
  await tx.wait()

  tx = await delegatorPool.setPoolRouter(poolRouter.address)
  await tx.wait()

  updateDeployments(
    {
      PoolRouter: poolRouter.address,
      LINK_StakingPool: stakingPool.address,
      LINK_WrappedSDToken: wsdToken.address,
      stLINK_DelegatorRewardsPool: stLinkDelegatorRewardsPool.address,
    },
    {
      LINK_StakingPool: 'StakingPool',
      LINK_WrappedSDToken: 'WrappedSDToken',
      stLINK_DelegatorRewardsPool: 'RewardsPoolWSD',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
