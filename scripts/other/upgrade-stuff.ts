import { DelegatorPool, PoolRouter } from '../../typechain-types'
import { getContract, upgradeProxy } from '../utils/deployment'

async function main() {
  const poolRouter = (await getContract('PoolRouter')) as PoolRouter
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool

  await upgradeProxy(poolRouter.address, 'PoolRouter')
  await upgradeProxy(delegatorPool.address, 'DelegatorPool')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
