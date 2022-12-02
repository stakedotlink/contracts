import { updateDeployments, deploy } from '../utils/deployment'

async function main() {
  const merkleDistributor = await deploy('MerkleDistributor')
  console.log('MerkleDistributor deployed: ', merkleDistributor.address)

  updateDeployments({
    MerkleDistributor: merkleDistributor.address,
  })

  console.log('deploy-status-ready')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
