import { DelegatorPool, PoolRouter } from '../../typechain-types'
import { updateDeployments, deploy, getContract, deployUpgradeable } from '../utils/deployment'

// Tokens
const linkToken = '0x514910771af9ca656af840dff83e8264ecf986ca'

// LINK Wrapped Staking Derivative Token
const LINK_WrappedSDToken = {
  name: 'Wrapped stLINK', // wrapped staking derivative token name
  symbol: 'wstLINK', // wrapped staking derivative token symbol
}
// LINK Staking Pool
const LINK_StakingPool = {
  derivativeTokenName: 'Staked LINK', // LINK staking derivative token name
  derivativeTokenSymbol: 'stLINK', // LINK staking derivative token symbol
  fees: [['0x6879826450e576B401c4dDeff2B7755B1e85d97c', 300]], // fee receivers & percentage amounts in basis points
}

async function main() {
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const poolRouter = (await getContract('PoolRouter')) as PoolRouter

  const stakingPool = await deployUpgradeable('StakingPool', [
    linkToken,
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

  let tx = await poolRouter.addPool(stakingPool.address, 0, true)
  await tx.wait()

  tx = await delegatorPool.addToken(stakingPool.address, stLinkDelegatorRewardsPool.address)
  await tx.wait()

  updateDeployments(
    {
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
