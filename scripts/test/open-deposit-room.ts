import { ethers } from 'hardhat'
import { getContract } from '../utils/deployment'
import { fromEther, toEther } from '../utils/helpers'
import type {
  CommunityVCS,
  OperatorVCS,
  PriorityPool,
  StakingMock,
  StakingPool,
  WithdrawalPool,
} from '../../typechain-types'

/*
Opens a fixed amount of instant deposit room in the LINK pool, so a stake can
be seen splitting between the staking pool and the priority queue.

Run against an already-running test env:

  npx hardhat run --network localhost scripts/test/open-deposit-room.ts

The target defaults to 100 LINK and can be overridden:

  DEPOSIT_ROOM=250 npx hardhat run --network localhost scripts/test/open-deposit-room.ts

Why this is needed at all
-------------------------
`PriorityPool._deposit` only reaches the instant path while `totalQueued` is
zero. `setup-link-staking.ts` deliberately leaves LINK in the queue, because
accounts 3 and 4 are fixtures for the claim card, so every later deposit queues
in full no matter how much room the pool has. On top of that the setup fills
the strategies, so `canDeposit()` is around zero anyway.

This script fixes both: it drains the queue, closes the room OperatorVCS would
otherwise contribute, and caps CommunityVCS so exactly the target is left.

One thing it works around rather than controls: a deposit is matched against
pending withdrawals before it ever reaches the strategies, and
`depositQueuedTokens` does not clear those. So whatever the withdrawal pool has
queued is already instant capacity, and the strategy room is set to the
remainder of the target rather than to the whole of it.
*/

/** Matches the empty per-strategy deposit data the setup scripts pass. */
const depositData = [
  ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[]]),
  ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[]]),
]

/** Vaults added before draining, so the queue has somewhere to go. */
const VAULTS_TO_ADD = 5
/** Each `depositQueuedTokens` call moves at most this much. */
const DRAIN_CHUNK = toEther(1_000_000)
/** Give up rather than spin, if the queue will not empty. */
const MAX_DRAIN_CALLS = 20

const link = (wei: bigint) => `${Number(fromEther(wei)).toLocaleString('en-US')} LINK`

/**
 * `getMaxDeposits` scales the headroom the staking contract reports by
 * `maxDepositSizeBP`, so the cap has to be grossed up to land on the room we
 * actually want.
 */
function poolSizeForRoom(totalPrincipal: bigint, room: bigint, maxDepositSizeBP: bigint) {
  return totalPrincipal + (room * 10000n) / maxDepositSizeBP
}

async function main() {
  const target = toEther(Number(process.env.DEPOSIT_ROOM ?? 100))

  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS
  const withdrawalPool = (await getContract('LINK_WithdrawalPool')) as WithdrawalPool

  const communityMock = (await ethers.getContractAt(
    'StakingMock',
    await communityVCS.stakeController()
  )) as any as StakingMock
  const operatorMock = (await ethers.getContractAt(
    'StakingMock',
    await operatorVCS.stakeController()
  )) as any as StakingMock

  console.log('before')
  console.log('  totalQueued        ', link(await priorityPool.totalQueued()))
  console.log('  canDeposit         ', link(await stakingPool.canDeposit()))
  console.log('  queuedWithdrawals  ', link(await withdrawalPool.getTotalQueuedWithdrawals()))

  // 1. Room to drain into. Two separate limits bind here and both have to be
  //    lifted: the number of vaults, and the staking contract's own pool size.
  //    The setup leaves `maxPoolSize` exactly at `getTotalPrincipal()`, so
  //    without this `getStrategyDepositRoom()` stays zero however many vaults
  //    exist, and `depositQueuedTokens` reverts with InsufficientDepositRoom.
  console.log(`\nadding ${VAULTS_TO_ADD} community vaults`)
  await (await communityVCS.addVaults(VAULTS_TO_ADD)).wait()

  const headroom = (await priorityPool.totalQueued()) + target + toEther(1000)
  console.log(`lifting the community cap by ${link(headroom)} to drain into`)
  await (
    await communityMock.setMaxPoolSize((await communityMock.getTotalPrincipal()) + headroom)
  ).wait()

  // 2. Empty the deposit queue. This is the same call Chainlink Automation
  //    makes through `performUpkeep` in production, and it is permissionless.
  //    A single call is capped, so it may take a few.
  for (let i = 0; i < MAX_DRAIN_CALLS; i++) {
    const queued = await priorityPool.totalQueued()
    if (queued === 0n) break
    console.log(`draining queue, ${link(queued)} left`)
    await (await priorityPool.depositQueuedTokens(0, DRAIN_CHUNK, depositData)).wait()
  }

  const stillQueued = await priorityPool.totalQueued()
  if (stillQueued !== 0n) {
    throw new Error(
      `queue did not empty, ${link(stillQueued)} still waiting. Raise VAULTS_TO_ADD and rerun.`
    )
  }

  // 3. Close the room OperatorVCS contributes, so the total is the one number
  //    this script controls. Draining does not touch it, so whatever it had
  //    stays open otherwise.
  console.log('\nclosing operator strategy room')
  await (await operatorMock.setMaxPoolSize(await operatorMock.getTotalPrincipal())).wait()

  // 4. Bring the community cap back down to the target. Its principal has
  //    grown by whatever was drained, so this re-reads rather than adjusting
  //    the figure from step 1. Pending
  //    withdrawals are matched before the strategies are touched at all, so
  //    they already count towards what a depositor gets at once.
  const queuedWithdrawals = await withdrawalPool.getTotalQueuedWithdrawals()
  if (queuedWithdrawals >= target) {
    console.warn(
      `\n${link(queuedWithdrawals)} of withdrawals are already queued, which is at or above` +
        ` the ${link(target)} target. Instant capacity cannot go below that without` +
        ` finalising them, so the room is being closed instead.`
    )
  }
  const room = queuedWithdrawals >= target ? 0n : target - queuedWithdrawals
  console.log(`opening ${link(room)} of community strategy room`)
  await (
    await communityMock.setMaxPoolSize(
      poolSizeForRoom(
        await communityMock.getTotalPrincipal(),
        room,
        await communityVCS.maxDepositSizeBP()
      )
    )
  ).wait()

  // 5. Report the three figures the stake form reads, so a mismatch here is
  //    visible before anyone goes looking for it in the UI.
  const canDeposit = await stakingPool.canDeposit()
  const totalQueued = await priorityPool.totalQueued()
  const finalWithdrawals = await withdrawalPool.getTotalQueuedWithdrawals()
  const instant = canDeposit + finalWithdrawals

  console.log('\nafter')
  console.log('  totalQueued        ', link(totalQueued))
  console.log('  canDeposit         ', link(canDeposit))
  console.log('  queuedWithdrawals  ', link(finalWithdrawals))
  console.log('  instant capacity   ', link(instant))

  if (instant === 0n) {
    throw new Error('no room opened: the vault limit is binding below the target, add more vaults')
  }

  const sample = instant + toEther(400)
  console.log(
    `\nstaking ${link(sample)} should now give ${link(instant)} at once` +
      ` and queue ${link(sample - instant)}`
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
