import { ERC677 } from '../../../../typechain-types'
import { updateDeployments, deploy, getContract } from '../../../utils/deployment'
import { getAccounts } from '../../../utils/helpers'

// SDL Vesting
const vestingEnd = 1821456000
const vestingStart = 1760464265
const vestingDuration = vestingEnd - vestingStart
const lockTime = 0
const staker = '0xf5c08D55a77063ac4E5E18F1a470804088BE1ad4'

export async function deployOther() {
  const { accounts } = await getAccounts()
  const linkToken = (await getContract('LINKToken')) as ERC677
  const stakingPool = await getContract('LINK_StakingPool')

  // Multicall

  const multicall = await deploy('Multicall3', [])
  console.log('Multicall3 deployed: ', multicall.target)

  // stLINK/LINK Curve Mock

  const curveMock = await deploy('CurveMock', [stakingPool.target, linkToken.target])
  console.log('LINK_CurvePool deployed: ', curveMock.target)

  // Node Operator SDL Vesting

  const sdlToken = await getContract('SDLToken')
  const sdlPool = await getContract('SDLPool')

  let vesting0 = await deploy('SDLVesting', [
    sdlToken.target,
    sdlPool.target,
    accounts[0],
    accounts[12],
    vestingStart,
    vestingDuration,
    lockTime,
    staker,
  ])
  console.log('SDL_Vesting_NOP_0 deployed: ', vesting0.target)

  let vesting1 = await deploy('SDLVesting', [
    sdlToken.target,
    sdlPool.target,
    accounts[0],
    accounts[13],
    vestingStart,
    vestingDuration,
    lockTime,
    staker,
  ])
  console.log('SDL_Vesting_NOP_1 deployed: ', vesting1.target)

  updateDeployments(
    {
      SDL_Vesting_NOP_0: vesting0.target,
      SDL_Vesting_NOP_1: vesting1.target,
      LINK_CurvePool: curveMock.target,
      Multicall3: multicall.target,
    },
    {
      SDL_Vesting_NOP_0: 'SDLVesting',
      SDL_Vesting_NOP_1: 'SDLVesting',
      LINK_CurvePool: 'CurveMock',
    }
  )
}
