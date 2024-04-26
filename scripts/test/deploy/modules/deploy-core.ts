import { ERC677 } from '../../../../typechain-types'
import {
  updateDeployments,
  deploy,
  getContract,
  deployUpgradeable,
} from '../../../utils/deployment'

// SDL Token
const SDLTokenArgs = {
  name: 'stake.link', // SDL token name
  symbol: 'SDL', // SDL token symbol
}
// Linear Boost Controller
const LinearBoostControllerArgs = {
  minLockingDuration: 86400, // minimum locking duration
  maxLockingDuration: 4 * 365 * 86400, // maximum locking duration
  maxBoost: 8, // maximum boost amount
}
// SDL Pool Primary
const SDLPoolPrimaryArgs = {
  derivativeTokenName: 'Reward Escrowed SDL', // SDL staking derivative token name
  derivativeTokenSymbol: 'reSDL', // SDL staking derivative token symbol
}
// Delegator Pool (deprecated)
const DelegatorPool = {
  derivativeTokenName: 'Staked SDL', // SDL staking derivative token name
  derivativeTokenSymbol: 'stSDL', // SDL staking derivative token symbol
}

export async function deployCore() {
  const lplToken = (await getContract('LPLToken')) as ERC677

  const sdlToken = await deploy('StakingAllowance', [SDLTokenArgs.name, SDLTokenArgs.symbol])
  console.log('SDLToken deployed: ', sdlToken.address)

  const lplMigration = await deploy('LPLMigration', [lplToken.address, sdlToken.address])
  console.log('LPLMigration deployed: ', lplMigration.address)

  const delegatorPool = await deployUpgradeable('DelegatorPool', [
    sdlToken.address,
    DelegatorPool.derivativeTokenName,
    DelegatorPool.derivativeTokenSymbol,
    [],
  ])
  console.log('DelegatorPool deployed: ', delegatorPool.address)

  const lbc = await deploy('LinearBoostController', [
    LinearBoostControllerArgs.minLockingDuration,
    LinearBoostControllerArgs.maxLockingDuration,
    LinearBoostControllerArgs.maxBoost,
  ])
  console.log('LinearBoostController deployed: ', lbc.address)

  const sdlPoolPrimary = await deployUpgradeable('SDLPoolPrimary', [
    SDLPoolPrimaryArgs.derivativeTokenName,
    SDLPoolPrimaryArgs.derivativeTokenSymbol,
    sdlToken.address,
    lbc.address,
  ])
  console.log('SDLPoolPrimary deployed: ', sdlPoolPrimary.address)

  await (await sdlPoolPrimary.setDelegatorPool(delegatorPool.address)).wait()

  updateDeployments(
    {
      SDLToken: sdlToken.address,
      LPLMigration: lplMigration.address,
      LinearBoostController: lbc.address,
      SDLPoolPrimary: sdlPoolPrimary.address,
      DelegatorPool: delegatorPool.address,
    },
    { SDLToken: 'StakingAllowance' }
  )
}
