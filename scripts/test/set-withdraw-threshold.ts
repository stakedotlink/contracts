import { ethers } from 'hardhat'
import { getContract } from '../utils/deployment'
import { toEther } from '../utils/helpers'
import { link, strategyData } from './utils/priority-queue'
import type { CommunityVCS, PriorityPool, StakingMock } from '../../typechain-types'

/*
Leaves the LINK pool able to pay a withdrawal of `THRESHOLD` on the spot, and
no more, so anything larger goes to the withdrawal queue.

  npx hardhat run --network localhost scripts/test/set-withdraw-threshold.ts

  THRESHOLD=100 npx hardhat run --network localhost scripts/test/set-withdraw-threshold.ts

How the threshold works
-----------------------
This env deploys the priority pool with instant withdrawals switched off:
`deploy-link-staking.ts` passes `false` for `allowInstantWithdrawals`. So
`PriorityPool._withdraw` never touches the staking pool's liquidity, and the
only thing standing between a withdrawal and the queue is `totalQueued`, the
deposits other people are waiting to have staked.

Which makes the threshold exactly `totalQueued`. Leaving 100 there means a 99
LINK withdrawal is paid from the queue and a 101 LINK one is not.

`depositQueuedTokens` moves the excess out into the strategies, capped by its
`_depositMax` argument, which is how the queue is lowered to a chosen figure
rather than emptied.

One consequence worth knowing
-----------------------------
Accounts that queued deposits keep their own balances until a distribution
clears them, so lowering the pool's queue below an account's own opens a gap:
the contract can then unqueue less than the account holds. `WithdrawForm`
accounts for that when it sizes its approval; the live page does not, and a
withdrawal from such an account fails there with "ERC20: insufficient
allowance". Run `distribute-queue.ts` first to close the gap.
*/

const VAULTS_TO_ADD = 5

async function main() {
  const threshold = toEther(Number(process.env.THRESHOLD ?? 100))

  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS
  const communityMock = (await ethers.getContractAt(
    'StakingMock',
    await communityVCS.stakeController()
  )) as any as StakingMock

  const instant = await priorityPool.allowInstantWithdrawals()
  const queued = await priorityPool.totalQueued()

  console.log('before')
  console.log('  totalQueued            ', link(queued))
  console.log('  allowInstantWithdrawals', instant)

  if (instant) {
    console.log(
      '\nInstant withdrawals are on, so the staking pool pays out as well and the\n' +
        'threshold is not `totalQueued` alone. This script assumes the deployed\n' +
        'default of off.'
    )
  }

  if (queued <= threshold) {
    console.log(
      `\nthe queue already holds ${link(queued)}, at or under the ${link(threshold)} asked for.` +
        '\nNothing to do: a larger withdrawal already reaches the withdrawal pool.'
    )
    return
  }

  const toMove = queued - threshold

  // Room to move it into. The setup pins `maxPoolSize` to the principal
  // already staked, so without lifting it the strategies report no room and
  // `depositQueuedTokens` reverts with InsufficientDepositRoom.
  console.log(`\nadding ${VAULTS_TO_ADD} community vaults`)
  await (await communityVCS.addVaults(VAULTS_TO_ADD)).wait()
  console.log(`lifting the community cap by ${link(toMove)}`)
  await (
    await communityMock.setMaxPoolSize((await communityMock.getTotalPrincipal()) + toMove)
  ).wait()

  // `_depositMax` is what keeps the rest in the queue.
  console.log(`moving ${link(toMove)} out of the queue`)
  await (await priorityPool.depositQueuedTokens(0, toMove, strategyData)).wait()

  const left = await priorityPool.totalQueued()
  console.log('\nafter')
  console.log('  totalQueued            ', link(left))
  console.log(
    `\nA withdrawal up to ${link(left)} is paid from the queue.` +
      `\nAnything larger goes to the withdrawal pool: try ${link(left + toEther(50))}` +
      '\non /v2/link/withdraw and the panel should report the remainder as settling.'
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
