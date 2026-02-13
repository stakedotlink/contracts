import { updateDeployments, getContract, deploy } from '../../../utils/deployment'

const chainlinkCommunityPool = '0xBc10f2E862ED4502144c7d632a3459F49DFCDB5e'

async function main() {
  const linkToken = await getContract('LINKToken')
  const priorityPool = await getContract('LINK_PriorityPool')

  const migrator = await deploy('LINKMigrator', [
    linkToken.target,
    chainlinkCommunityPool,
    priorityPool.target,
  ])
  console.log('LINK_Migrator deployed: ', migrator.target)

  updateDeployments({
    LINKMigrator: migrator.target,
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
