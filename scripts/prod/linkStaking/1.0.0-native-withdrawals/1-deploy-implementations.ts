import { ethers, upgrades } from 'hardhat'
import { deployImplementation, getContract } from '../../../utils/deployment'

async function main() {
  const priorityPool = await getContract('LINK_PriorityPool')
  const priorityPoolImp = (await upgrades.prepareUpgrade(
    priorityPool.target,
    await ethers.getContractFactory('PriorityPool'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('PriorityPool implementation deployed at: ', priorityPoolImp)

  const stakingPool = await getContract('LINK_StakingPool')
  const stakingPoolImp = (await upgrades.prepareUpgrade(
    stakingPool.target,
    await ethers.getContractFactory('StakingPool'),
    {
      kind: 'uups',
      unsafeAllowRenames: true,
    }
  )) as string
  console.log('StakingPool implementation deployed at: ', stakingPoolImp)

  const operatorVCS = await getContract('LINK_OperatorVCS')
  const operatorVCSImp = (await upgrades.prepareUpgrade(
    operatorVCS.target,
    await ethers.getContractFactory('OperatorVCS'),
    {
      kind: 'uups',
      unsafeAllow: ['delegatecall'],
      unsafeSkipStorageCheck: true,
    }
  )) as string
  console.log('OperatorVCS implementation deployed at: ', operatorVCSImp)

  const communityVCS = await getContract('LINK_CommunityVCS')
  const communityVCSImp = (await upgrades.prepareUpgrade(
    communityVCS.target,
    await ethers.getContractFactory('CommunityVCS'),
    {
      kind: 'uups',
      unsafeAllow: ['delegatecall'],
      unsafeSkipStorageCheck: true,
    }
  )) as string
  console.log('CommunityVCS implementation deployed at: ', communityVCSImp)

  const operatorVaultImp = (await deployImplementation('OperatorVault')) as string
  console.log('OperatorVault implementation deployed at: ', operatorVaultImp)

  const communityVaultImp = (await deployImplementation('CommunityVault')) as string
  console.log('CommunityVault implementation deployed at: ', communityVaultImp)

  const vaultDepositController = (await deployImplementation('VaultDepositController')) as string
  console.log('VaultDepositController deployed at: ', vaultDepositController)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
