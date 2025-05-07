import { ethers, upgrades } from 'hardhat'
import { deployImplementation, getContract } from '../../../utils/deployment'

async function main() {
  const fundFlowController = await getContract('LINK_FundFlowController')
  const fundFlowControllerImp = (await upgrades.prepareUpgrade(
    fundFlowController.target,
    await ethers.getContractFactory('FundFlowController'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('FundFlowController implementation deployed at: ', fundFlowControllerImp)

  const operatorVCS = await getContract('LINK_OperatorVCS')
  const operatorVCSImp = (await upgrades.prepareUpgrade(
    operatorVCS.target,
    await ethers.getContractFactory('OperatorVCS'),
    {
      kind: 'uups',
      unsafeAllow: ['delegatecall'],
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
    }
  )) as string
  console.log('CommunityVCS implementation deployed at: ', communityVCSImp)

  const operatorVaultImp = (await deployImplementation('OperatorVault')) as string
  console.log('OperatorVault implementation deployed at: ', operatorVaultImp)

  const communityVaultImp = (await deployImplementation('CommunityVault')) as string
  console.log('CommunityVault implementation deployed at: ', communityVaultImp)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
