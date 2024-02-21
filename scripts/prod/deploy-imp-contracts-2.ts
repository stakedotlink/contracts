import { ethers, upgrades, run } from 'hardhat'
import { getContract } from '../utils/deployment'
import { StakingPool, PriorityPool, CommunityVCS } from '../../typechain-types'

async function main() {
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS

  const stakingPoolImp = (await upgrades.prepareUpgrade(
    stakingPool.address,
    await ethers.getContractFactory('StakingPool'),
    {
      kind: 'uups',
      unsafeAllowRenames: false,
    }
  )) as string
  console.log('StakingPool implementation deployed at: ', stakingPoolImp)

  await verifyContract(stakingPoolImp, [])

  const priorityPoolImp = (await upgrades.prepareUpgrade(
    priorityPool.address,
    await ethers.getContractFactory('PriorityPool'),
    {
      kind: 'uups',
      unsafeAllowRenames: false,
    }
  )) as string
  console.log('PriorityPool implementation deployed at: ', priorityPoolImp)

  await verifyContract(priorityPoolImp, [])

  const communityVCSImp = (await upgrades.prepareUpgrade(
    communityVCS.address,
    await ethers.getContractFactory('CommunityVCS'),
    {
      kind: 'uups',
      unsafeAllowRenames: false,
    }
  )) as string
  console.log('CommunityVCS implementation deployed at: ', communityVCSImp)
  await verifyContract(communityVCSImp, [])
}

async function verifyContract(contractAddress: string, constructorArguments: any[]) {
  try {
    await run('verify:verify', {
      address: contractAddress,
      constructorArguments: constructorArguments,
    })
    console.log(`Contract verified: ${contractAddress}`)
  } catch (error: any) {
    console.error(`Verification failed for ${contractAddress}: ${error.message}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
