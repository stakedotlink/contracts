import { ethers } from 'hardhat'
import { getContract } from '../../utils/deployment'
import { fromEther, toEther } from '../../utils/helpers'
import type { CommunityVCS, PriorityPool, StakingMock } from '../../../typechain-types'

/** Matches the empty per-strategy data the setup scripts pass. */
export const strategyData = [
  ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[]]),
  ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[]]),
]

export const link = (wei: bigint) => `${Number(fromEther(wei)).toLocaleString('en-US')} LINK`

/** Vaults added before draining, so the queue has somewhere to go. */
const VAULTS_TO_ADD = 5
/** Each `depositQueuedTokens` call moves at most this much. */
const DRAIN_CHUNK = toEther(1_000_000)
/** Give up rather than spin, if the queue will not empty. */
const MAX_DRAIN_CALLS = 20

/**
 * Empties the LINK deposit queue, and leaves `extraRoom` open behind it.
 *
 * Both test scripts need this and for different reasons. `open-deposit-room`
 * needs `totalQueued` at zero because `PriorityPool._deposit` skips its
 * instant path entirely while anyone is waiting. `queue-withdrawal` needs it
 * because `_withdraw` pays out of the deposit queue first, so a withdrawal
 * never reaches the withdrawal pool while the queue holds more than it.
 *
 * Two limits bind and both have to be lifted: the number of vaults, and the
 * staking contract's own pool size. The setup leaves `maxPoolSize` exactly at
 * `getTotalPrincipal()`, so without raising it `getStrategyDepositRoom()`
 * stays zero however many vaults exist and `depositQueuedTokens` reverts with
 * InsufficientDepositRoom.
 */
export async function drainDepositQueue(extraRoom = toEther(1000)) {
  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS
  const communityMock = (await ethers.getContractAt(
    'StakingMock',
    await communityVCS.stakeController()
  )) as any as StakingMock

  const queued = await priorityPool.totalQueued()
  if (queued === 0n) return

  console.log(`adding ${VAULTS_TO_ADD} community vaults`)
  await (await communityVCS.addVaults(VAULTS_TO_ADD)).wait()

  const headroom = queued + extraRoom
  console.log(`lifting the community cap by ${link(headroom)} to drain into`)
  await (
    await communityMock.setMaxPoolSize((await communityMock.getTotalPrincipal()) + headroom)
  ).wait()

  for (let i = 0; i < MAX_DRAIN_CALLS; i++) {
    const left = await priorityPool.totalQueued()
    if (left === 0n) break
    console.log(`draining, ${link(left)} left`)
    await (await priorityPool.depositQueuedTokens(0, DRAIN_CHUNK, strategyData)).wait()
  }

  const left = await priorityPool.totalQueued()
  if (left !== 0n) {
    throw new Error(
      `queue did not empty, ${link(left)} still waiting. Raise VAULTS_TO_ADD and rerun.`
    )
  }
}
