import { updateDeployments, deploy, getContract } from '../../../utils/deployment'
import { getAccounts, toEther } from '../../../utils/helpers'

export async function deployDeprecated() {
  const { accounts } = await getAccounts()

  const lplToken = await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
    'LinkPool',
    'LPL',
    100000000,
  ])
  console.log('LPLToken deployed: ', lplToken.target)

  const linkToken = await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
    'Chainlink',
    'LINK',
    1000000000,
  ])
  console.log('LINKToken deployed: ', linkToken.target)

  const poolOwners = await deploy('PoolOwnersV1', [lplToken.target])
  console.log('PoolOwners (v1) deployed: ', poolOwners.target)

  const ownersRewardsPoolV1 = await deploy('OwnersRewardsPoolV1', [
    poolOwners.target,
    linkToken.target,
    'LinkPool Owners LINK',
    'lpoLINK',
  ])
  console.log('LINK OwnersRewardsPool (v1) deployed: ', ownersRewardsPoolV1.target)

  const poolAllowance = await deploy('PoolAllowanceV1', [
    'LINK LinkPool Allowance',
    'linkLPLA',
    poolOwners.target,
  ])
  console.log('PoolAllowance (v1) deployed: ', poolAllowance.target)

  let tx = await poolOwners.addRewardToken(
    linkToken.target,
    poolAllowance.target,
    ownersRewardsPoolV1.target
  )
  await tx.wait()

  const vestingStart = 1695312000 // Sep 21 2023 12pm EDT
  const vestingDuration = 4 * 365 * 86400 // 4 years

  let vesting0 = await deploy('Vesting', [accounts[0], accounts[12], vestingStart, vestingDuration])
  console.log('SDL_Vesting_Deprecated_NOP_0 deployed: ', vesting0.target)

  let vesting1 = await deploy('Vesting', [accounts[0], accounts[13], vestingStart, vestingDuration])
  console.log('SDL_Vesting_Deprecated_NOP_1 deployed: ', vesting1.target)

  updateDeployments(
    {
      LPLToken: lplToken.target,
      LINKToken: linkToken.target,
      PoolOwnersV1: poolOwners.target,
      LINK_OwnersRewardsPoolV1: ownersRewardsPoolV1.target,
      PoolAllowanceV1: poolAllowance.target,
      SDL_Vesting_Deprecated_NOP_0: vesting0.target,
      SDL_Vesting_Deprecated_NOP_1: vesting1.target,
    },
    {
      LPLToken: 'contracts/core/tokens/base/ERC677.sol:ERC677',
      LINKToken: 'contracts/core/tokens/base/ERC677.sol:ERC677',
      LINK_OwnersRewardsPoolV1: 'OwnersRewardsPoolV1',
      SDL_Vesting_Deprecated_NOP_0: 'Vesting',
      SDL_Vesting_Deprecated_NOP_1: 'Vesting',
    }
  )
}
