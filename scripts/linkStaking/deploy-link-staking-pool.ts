import { ERC677, SDLPool } from '../../typechain-types'
import { updateDeployments, deploy, getContract, deployUpgradeable } from '../utils/deployment'
import { getAccounts } from '../utils/helpers'

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
  const { accounts } = await getAccounts()
  const linkToken = (await getContract('LINKToken')) as ERC677
  const sdlPool = (await getContract('SDLPool')) as SDLPool

  const stakingPool = await deployUpgradeable('StakingPool', [
    linkToken.address,
    LINK_StakingPool.derivativeTokenName,
    LINK_StakingPool.derivativeTokenSymbol,
    LINK_StakingPool.fees,
    accounts[0],
  ])
  console.log('LINK_StakingPool deployed: ', stakingPool.address)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.address,
    LINK_WrappedSDToken.name,
    LINK_WrappedSDToken.symbol,
  ])
  console.log('LINK_WrappedSDToken token deployed: ', wsdToken.address)

  const stLinkSDLRewardsPool = await deploy('RewardsPoolWSD', [
    sdlPool.address,
    stakingPool.address,
    wsdToken.address,
  ])
  console.log('stLINK_SDLRewardsPool deployed: ', stLinkSDLRewardsPool.address)

  let tx = await sdlPool.addToken(stakingPool.address, stLinkSDLRewardsPool.address)
  await tx.wait()

  updateDeployments(
    {
      LINK_StakingPool: stakingPool.address,
      LINK_WrappedSDToken: wsdToken.address,
      stLINK_SDLRewardsPool: stLinkSDLRewardsPool.address,
    },
    {
      LINK_StakingPool: 'StakingPool',
      LINK_WrappedSDToken: 'WrappedSDToken',
      stLINK_SDLRewardsPool: 'RewardsPoolWSD',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
