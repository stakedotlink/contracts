import { ethers, upgrades } from 'hardhat'
import { CommunityVCS, ERC677, RewardsPoolWSD, StakingPool } from '../../../typechain-types'
import { deployUpgradeable, getContract, updateDeployments } from '../../utils/deployment'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const clCommunityStakingPool = '0xBc10f2E862ED4502144c7d632a3459F49DFCDB5e'

const communityStrategySDLPoolFee = 500 // basis point amount of rewards paid to SDL pool
const maxDepositSizeBP = 9000 // basis point amount of the remaing deposit room in the Chainlink staking contract that can be deposited at once
const vaultDeploymentThreshold = 6 // the min number of non-full vaults before a new batch is deployed
const vaultDeploymentAmount = 10 // amount of vaults to deploy when threshold is met

async function main() {
  const linkToken = (await getContract('LINKToken')) as ERC677
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const stLINKRewardsPool = (await getContract('stLINK_SDLRewardsPool')) as RewardsPoolWSD

  const communityVaultImp = (await upgrades.deployImplementation(
    await ethers.getContractFactory('CommunityVault'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('CommunityVault implementation deployed at: ', communityVaultImp)

  const communityVCS = (await deployUpgradeable('CommunityVCS', [
    linkToken.address,
    stakingPool.address,
    clCommunityStakingPool,
    communityVaultImp,
    [[stLINKRewardsPool.address, communityStrategySDLPoolFee]],
    maxDepositSizeBP,
    vaultDeploymentThreshold,
    vaultDeploymentAmount,
  ])) as CommunityVCS
  console.log('CommunityVCS deployed: ', communityVCS.address)

  let tx = await communityVCS.transferOwnership(multisigAddress)
  await tx.wait()

  updateDeployments(
    { LINK_CommunityVCS: communityVCS.address },
    { LINK_CommunityVCS: 'CommunityVCS' }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
