import { ethers, upgrades } from 'hardhat'
import { getContract } from '../../utils/deployment'

// Deployment key in deployments/<network>.json (e.g. 'LINK_PriorityPool', 'LINK_CommunityVCS')
const deploymentKey = ''
// Name of the new implementation contract to deploy (e.g. 'PriorityPool')
const contractName = ''

async function main() {
  if (!deploymentKey) throw new Error('Set deploymentKey before running')
  if (!contractName) throw new Error('Set contractName before running')

  const proxy = await getContract(deploymentKey)
  const factory = (await ethers.getContractFactory(contractName)) as any
  const newImp = (await upgrades.prepareUpgrade(proxy.target, factory, {
    kind: 'uups',
  })) as string

  console.log(`${contractName} implementation deployed at: ${newImp}`)
  console.log(`Set this address as 'newImplementation' in 2-propose-upgrade.ts`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
