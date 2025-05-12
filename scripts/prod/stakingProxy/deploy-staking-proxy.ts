import { deployUpgradeable, getContract } from '../../utils/deployment'

const owner = ''
const staker = ''

async function main() {
  const linkToken = await getContract('LINKToken')
  const stakingPool = await getContract('LINK_StakingPool')
  const priorityPool = await getContract('LINK_PriorityPool')
  const withdrawalPool = await getContract('LINK_WithdrawalPool')
  const sdlPool = await getContract('SDLPool')

  const stakingProxy = await deployUpgradeable('StakingProxy', [
    linkToken.target,
    stakingPool.target,
    priorityPool.target,
    withdrawalPool.target,
    sdlPool.target,
    staker,
  ])

  console.log('StakingProxy deployed: ', stakingProxy.target)

  await (await stakingProxy.transferOwnership(owner)).wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
