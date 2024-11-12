import { getAccounts, toEther, setupToken } from '../../../utils/helpers'
import { getContract } from '../../../utils/deployment'
import { StakingAllowance, ERC677, DelegatorPool, LPLMigration } from '../../../../typechain-types'
import { ethers } from 'hardhat'

/*
Accounts:
0 - main account that holds most of the tokens
1 - holds SDL + LPL
2 - holds SDL + reSDL
3 - holds SDL + reSDL 
4 - holds SDL + reSDL + stSDL
*/

export async function setupCore() {
  const { signers, accounts } = await getAccounts()
  const sdlToken = (await getContract('SDLToken')) as StakingAllowance
  const sdlPool = await getContract('SDLPool')
  const lplToken = (await getContract('LPLToken')) as ERC677
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const poolOwnersV1 = (await getContract('PoolOwnersV1')) as any
  const ownersRewardsPoolV1 = (await getContract('LINK_OwnersRewardsPoolV1')) as any
  const linkToken = (await getContract('LINKToken')) as ERC677
  const lplMigration = (await getContract('LPLMigration')) as LPLMigration

  // Account 1
  // LPL migration

  await sdlToken.mint(lplMigration.target, toEther(100000))
  await (await lplToken.transfer(accounts[1], toEther(500))).wait()
  await lplToken.connect(signers[1]).transferAndCall(poolOwnersV1.target, toEther(10), '0x')
  await linkToken.transfer(ownersRewardsPoolV1.target, toEther(10))
  await ownersRewardsPoolV1.distributeRewards()

  // Token Setup

  await (await sdlToken.mint(accounts[0], toEther(100000000))).wait()
  await setupToken(sdlToken, accounts)

  // Account 2

  await sdlToken
    .connect(signers[2])
    .transferAndCall(
      sdlPool.target,
      toEther(2000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )

  // Account 3

  await sdlToken
    .connect(signers[3])
    .transferAndCall(
      sdlPool.target,
      toEther(3000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 365 * 86400])
    )

  // Account 4

  await (
    await sdlToken.connect(signers[4]).transferAndCall(delegatorPool.target, toEther(1000), '0x')
  ).wait()

  await sdlToken
    .connect(signers[4])
    .transferAndCall(
      sdlPool.target,
      toEther(4000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )

  await sdlToken
    .connect(signers[4])
    .transferAndCall(
      sdlPool.target,
      toEther(5000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 4 * 365 * 86400])
    )
}
