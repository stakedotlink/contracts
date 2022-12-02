import { network } from 'hardhat'
import { updateDeployments, deploy } from '../utils/deployment'

async function main() {
  if (network.name != 'localhost' && network.name != 'testnet') {
    throw Error('Test contracts can only be deployed on test networks')
  }

  const lplToken = await deploy('ERC677', ['LinkPool', 'LPL', 100000000])
  console.log('LPLToken deployed: ', lplToken.address)

  const linkToken = await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])
  console.log('LINKToken deployed: ', linkToken.address)

  const multicall = await deploy('Multicall3', [])
  console.log('Multicall3 deployed: ', multicall.address)

  const poolOwners = await deploy('PoolOwnersV1', [lplToken.address])
  console.log('PoolOwners (v1) deployed: ', poolOwners.address)

  const ownersRewardsPoolV1 = await deploy('OwnersRewardsPoolV1', [
    poolOwners.address,
    linkToken.address,
    'LinkPool Owners LINK',
    'lpoLINK',
  ])
  console.log('LINK OwnersRewardsPool (v1) deployed: ', ownersRewardsPoolV1.address)

  const poolAllowance = await deploy('PoolAllowanceV1', [
    'LINK LinkPool Allowance',
    'linkLPLA',
    poolOwners.address,
  ])
  console.log('PoolAllowance (v1) deployed: ', multicall.address)

  let tx = await poolOwners.addRewardToken(
    linkToken.address,
    poolAllowance.address,
    ownersRewardsPoolV1.address
  )
  await tx.wait()

  updateDeployments(
    {
      LPLToken: lplToken.address,
      LINKToken: linkToken.address,
      PoolOwnersV1: poolOwners.address,
      LINK_OwnersRewardsPoolV1: ownersRewardsPoolV1.address,
      PoolAllowanceV1: poolAllowance.address,
      Multicall3: multicall.address,
    },
    { LPLToken: 'ERC677', LINKToken: 'ERC677', LINK_OwnersRewardsPoolV1: 'OwnersRewardsPoolV1' }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
