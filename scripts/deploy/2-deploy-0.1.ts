import { ERC677 } from '../../typechain-types'
import { updateDeployments, deploy, getContract, deployUpgradeable } from '../utils/deployment'

// SDL Token
const StakingAllowance = {
  name: 'stake.link', // SDL token name
  symbol: 'SDL', // SDL token symbol
}
// Delegator Pool (SDL staking)
const DelegatorPool = {
  derivativeTokenName: 'Staked SDL', // SDL staking derivative token name
  derivativeTokenSymbol: 'stSDL', // SDL staking derivative token symbol
}

async function main() {
  const lplToken = (await getContract('LPLToken')) as ERC677

  const sdlToken = await deploy('StakingAllowance', [
    StakingAllowance.name,
    StakingAllowance.symbol,
  ])
  console.log('SDLToken deployed: ', sdlToken.address)

  const lplMigration = await deploy('LPLMigration', [lplToken.address, sdlToken.address])
  console.log('LPLMigration deployed: ', lplMigration.address)

  const delegatorPool = await deployUpgradeable('DelegatorPool', [
    sdlToken.address,
    DelegatorPool.derivativeTokenName,
    DelegatorPool.derivativeTokenSymbol,
  ])
  console.log('DelegatorPool deployed: ', delegatorPool.address)

  updateDeployments(
    {
      SDLToken: sdlToken.address,
      LPLMigration: lplMigration.address,
      DelegatorPool: delegatorPool.address,
    },
    { SDLToken: 'StakingAllowance' }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
