import { ethers, upgrades } from 'hardhat'
import { getContract } from '../utils/deployment'
import { CommunityVCS } from '../../typechain-types/CommunityVCS'

async function main() {
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS

  const communityVCSImp = (await upgrades.prepareUpgrade(
    communityVCS.address,
    await ethers.getContractFactory('CommunityVCS'),
    {
      kind: 'uups',
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
