import { getAccounts, toEther } from '../utils/helpers'
import { getContract, 
   deploy, updateDeployments
 } from '../utils/deployment'
import {
  ERC677,
  LPLMigration,
  SDLPool,
  StakingAllowance,
} from '../../typechain-types'
import { ethers } from 'hardhat'

async function main() {
  const { signers, accounts } = await getAccounts()
  const lplToken = (await getContract('LPLToken')) as ERC677
  const lplMigration = (await getContract('LPLMigration')) as LPLMigration
  const sdlToken = (await getContract('SDLToken')) as StakingAllowance
  const poolOwnersV1 = (await getContract('PoolOwnersV1')) as any
  const ownersRewardsPoolV1 = (await getContract('LINK_OwnersRewardsPoolV1')) as any
  const linkToken = (await getContract('LINKToken')) as ERC677
  const delegatorPool = (await getContract('DelegatorPool')) as any 
  const LINK_StakingPool = (await getContract('LINK_StakingPool')) as any
  const LINK_StakingQueue = (await getContract('LINK_StakingQueue')) as any
  const sdlPool = (await getContract('SDLPool')) as SDLPool

  // LPL Migration

  await sdlToken.mint(lplMigration.address, toEther(100))
  await lplToken.transfer(accounts[2], toEther(100))
  await lplToken.connect(signers[2]).transferAndCall(poolOwnersV1.address, toEther(1), '0x00')
  await linkToken.transfer(ownersRewardsPoolV1.address, toEther(1))
  await ownersRewardsPoolV1.distributeRewards()

  // stSDL to reSDL Migrations

  await sdlToken.mint(accounts[2], toEther(100000))
  await sdlToken.connect(signers[2]).transferAndCall(delegatorPool.address, toEther(90000), '0x')

  let stLINK_DelegatorRewardsPool = (await deploy('RewardsPool', [
    delegatorPool.address,
    LINK_StakingPool.address,
  ])) 
  await delegatorPool.addToken(LINK_StakingPool.address, stLINK_DelegatorRewardsPool.address)        
  
  // stake LINK in LINK POOL
  
  await linkToken.transfer(accounts[3], toEther(100))
  await linkToken.connect(signers[3]).transferAndCall(LINK_StakingQueue.address, toEther(100), ethers.utils.defaultAbiCoder.encode(['bool'], [false]))

  // send LINK rewards to LINK POOL

  await LINK_StakingPool.connect(signers[3]).transferAndCall(
    stLINK_DelegatorRewardsPool.address,
    toEther(1),
    '0x00'
  )

  // Retire Delegator Pool

  await delegatorPool.retireDelegatorPool([], sdlPool.address)

  updateDeployments(
    {
      stLINK_DelegatorRewardsPool: stLINK_DelegatorRewardsPool.address,
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
