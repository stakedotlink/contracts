import { config } from '../../config/deploy'
import { updateDeployments, deploy, getContract, deployUpgradeable } from '../utils/deployment'

async function main() {
  const { StakingAllowance, DelegatorPool, FlatFee } = config

  const lplToken = await getContract('LPLToken')

  const sdlToken = await deploy('StakingAllowance', [
    StakingAllowance.name,
    StakingAllowance.symbol,
  ])
  console.log('SDLToken deployed: ', sdlToken.address)

  const lplMigration = await deploy('LPLMigration', [lplToken.address, sdlToken.address])
  console.log('LPLMigration deployed: ', lplMigration.address)

  const feeCurve = await deploy('FlatFee', [FlatFee.feeBasisPoints])
  console.log('FeeCurve deployed: ', feeCurve.address)

  const delegatorPool = await deployUpgradeable('DelegatorPool', [
    sdlToken.address,
    DelegatorPool.derivativeTokenName,
    DelegatorPool.derivativeTokenSymbol,
    feeCurve.address,
  ])
  console.log('DelegatorPool deployed: ', delegatorPool.address)

  updateDeployments(
    {
      SDLToken: sdlToken.address,
      LPLMigration: lplMigration.address,
      FeeCurve: feeCurve.address,
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
