import { updateDeployments, getContract, deploy } from '../../../utils/deployment'

async function main() {
  const linkToken = await getContract('LINKToken')
  const communityPool = await getContract('LINK_CommunityVCS')
  const priorityPool = await getContract('LINK_PriorityPool')

  const migrator = await deploy('LINKMigrator', [
    linkToken.target,
    communityPool.target,
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
