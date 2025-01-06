import { ethers } from 'hardhat'
import { deploy, getContract, updateDeployments } from '../../utils/deployment'

const emergencyPauser = '' // address authorized to pause pool in case of emergency

async function main() {
  const priorityPool = await getContract('METIS_PriorityPool')
  const stakingPool = await getContract('METIS_StakingPool')

  const rebaseController = await deploy('RebaseController', [
    stakingPool.target,
    priorityPool.target,
    ethers.ZeroAddress,
    emergencyPauser,
  ])
  console.log('METIS_RebaseController deployed: ', rebaseController.target)

  updateDeployments(
    {
      METIS_RebaseController: rebaseController.target,
    },
    {
      METIS_RebaseController: 'RebaseController',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
