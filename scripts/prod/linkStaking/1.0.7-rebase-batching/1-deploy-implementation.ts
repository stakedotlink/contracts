import { ethers, upgrades } from 'hardhat'
import { getContract } from '../../../utils/deployment'

async function main() {
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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
