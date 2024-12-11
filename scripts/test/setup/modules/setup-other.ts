import { toEther } from '../../../utils/helpers'
import { getContract } from '../../../utils/deployment'
import { StakingAllowance, ERC677 } from '../../../../typechain-types'

export async function setupOther() {
  const linkCurvePool = await getContract('LINK_CurvePool')
  const linkToken = (await getContract('LINKToken')) as ERC677
  const sdlToken = (await getContract('SDLToken')) as StakingAllowance
  const vesting0 = await getContract('SDL_Vesting_NOP_0')
  const vesting1 = await getContract('SDL_Vesting_NOP_1')

  await (await linkToken.transfer(linkCurvePool.target, toEther(1000))).wait()

  await (await sdlToken.mint(vesting0.target, toEther(10000))).wait()
  await (await sdlToken.mint(vesting1.target, toEther(10000))).wait()
}
