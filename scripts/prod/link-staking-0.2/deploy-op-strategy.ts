import { ethers, upgrades } from 'hardhat'
import { OperatorVCS, StakingPool } from '../../../typechain-types'
import { getContract } from '../../utils/deployment'
import { PriorityPool } from '../../../typechain-types'

async function main() {
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS

  const stakingPoolImp = (await upgrades.prepareUpgrade(
    stakingPool.address,
    await ethers.getContractFactory('StakingPool'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('StakingPool implementation deployed at: ', stakingPoolImp)

  const priorityPoolImp = (await upgrades.prepareUpgrade(
    priorityPool.address,
    await ethers.getContractFactory('PriorityPool'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('PriorityPool implementation deployed at: ', priorityPoolImp)

  const operatorVCSImp = (await upgrades.prepareUpgrade(
    operatorVCS.address,
    await ethers.getContractFactory('OperatorVCS'),
    {
      kind: 'uups',
      unsafeSkipStorageCheck: true,
      unsafeAllowRenames: true,
    }
  )) as string
  console.log('OperatorVCS implementation deployed at: ', operatorVCSImp)

  const operatorVaultImp = (await upgrades.deployImplementation(
    await ethers.getContractFactory('OperatorVault'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('OperatorVault implementation deployed at: ', operatorVaultImp)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
