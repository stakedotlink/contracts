import { getAccounts, toEther, setupToken } from '../../../utils/helpers'
import { getContract } from '../../../utils/deployment'
import { StakingAllowance, ERC677, DelegatorPool } from '../../../../typechain-types'
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

  // Token Setup

  await (await sdlToken.mint(accounts[0], toEther(100000000))).wait()
  await setupToken(sdlToken, accounts)
  await (await lplToken.transfer(accounts[1], toEther(500))).wait()

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
