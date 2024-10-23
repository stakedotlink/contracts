import { ERC677 } from '../../../../typechain-types'
import { updateDeployments, deploy, getContract } from '../../../utils/deployment'
import { getAccounts } from '../../../utils/helpers'

const vestingStart = 1695312000 // Sep 21 2023 12pm EDT
const vestingDuration = 4 * 365 * 86400 // 4 years

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

  let vesting0 = await deploy('Vesting', [accounts[0], accounts[12], vestingStart, vestingDuration])
  console.log('SDL_Vesting_NOP_0 deployed: ', vesting0.target)

  let vesting1 = await deploy('Vesting', [accounts[0], accounts[13], vestingStart, vestingDuration])
  console.log('SDL_Vesting_NOP_1 deployed: ', vesting1.target)

  updateDeployments(
    {
      SDL_Vesting_NOP_0: vesting0.target,
      SDL_Vesting_NOP_1: vesting1.target,
      LINK_CurvePool: curveMock.target,
      Multicall3: multicall.target,
    },
    {
      SDL_Vesting_NOP_0: 'Vesting',
      SDL_Vesting_NOP_1: 'Vesting',
      LINK_CurvePool: 'CurveMock',
    }
  )
}
