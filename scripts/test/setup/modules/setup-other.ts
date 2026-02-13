import { toEther } from '../../../utils/helpers'
import { getContract } from '../../../utils/deployment'
import { StakingAllowance, ERC677 } from '../../../../typechain-types'

export async function setupOther() {
  const linkCurvePool = await getContract('LINK_CurvePool')
  const linkToken = (await getContract('LINKToken')) as ERC677
  const sdlToken = (await getContract('SDLToken')) as StakingAllowance
  const vesting0Deprecated = await getContract('SDL_Vesting_Deprecated_NOP_0')
  const vesting1Deprecated = await getContract('SDL_Vesting_Deprecated_NOP_1')
  const vesting0 = await getContract('SDL_Vesting_NOP_0')
  const vesting1 = await getContract('SDL_Vesting_NOP_1')

  await (await linkToken.transfer(linkCurvePool.target, toEther(1000))).wait()

  await (await sdlToken.mint(vesting0Deprecated.target, toEther(900000))).wait()
  await (await sdlToken.mint(vesting1Deprecated.target, toEther(900000))).wait()

  await (await vesting0Deprecated['release(address)'](sdlToken.target)).wait()
  await (await sdlToken.mint(vesting0Deprecated.target, toEther(400000))).wait()
  await (await vesting0Deprecated.terminateVesting([sdlToken.target])).wait()
  await (await vesting1Deprecated.terminateVesting([sdlToken.target])).wait()

  await (await sdlToken.mint(vesting0.target, toEther(400000))).wait()
  await (await sdlToken.mint(vesting1.target, toEther(400000))).wait()
}
