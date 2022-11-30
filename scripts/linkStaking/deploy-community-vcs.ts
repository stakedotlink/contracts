import { ethers } from 'hardhat'
import { config } from '../../config/deploy'
import { ERC677, StakingPool } from '../../typechain-types'
import { deployUpgradeable, deployImplementation } from '../utils/helpers'

async function main() {
  const { CommunityVCS } = config

  const linkToken = (await ethers.getContract('LinkToken')) as ERC677
  const stakingPool = (await ethers.getContract('LINK_StakingPool')) as StakingPool

  const vaultImpAddress = await deployImplementation('CommunityVault')

  console.log('CommunityVault implementation deployed at: ', vaultImpAddress)

  const communityVCS = await deployUpgradeable('CommunityVCS', [
    linkToken.address,
    stakingPool.address,
    CommunityVCS.stakeController,
    vaultImpAddress,
    CommunityVCS.minDepositThreshold,
    CommunityVCS.fees,
    CommunityVCS.maxDeposits,
    CommunityVCS.maxVaultDeployments,
  ])
  await communityVCS.deployed()

  console.log('CommunityVCS deployed at: ', communityVCS.address)

  await stakingPool.addStrategy(communityVCS.address)

  console.log('CommunityVCS added to StakingPool')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
