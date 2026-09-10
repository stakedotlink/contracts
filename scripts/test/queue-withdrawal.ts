import { ethers } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { getContract } from '../utils/deployment'
import { toEther } from '../utils/helpers'
import { drainDepositQueue, link, strategyData } from './utils/priority-queue'
import type { PriorityPool, StakingPool, WithdrawalPool } from '../../typechain-types'

/*
Puts a real withdrawal through the withdrawal pool, so the queue card and its
Withdraw button have something to act on.

  npx hardhat run --network localhost scripts/test/queue-withdrawal.ts

  ACCOUNT=3 AMOUNT=250 npx hardhat run --network localhost scripts/test/queue-withdrawal.ts

Why it is needed
----------------
`PriorityPool._withdraw` only reaches the withdrawal pool with what it cannot
pay on the spot, and the local pool can pay everything: a Max withdrawal of
6,945 LINK from the fixture's largest holder still comes out instantly. So
nothing is ever queued, `getAccountTotalQueuedWithdrawals` is zero for every
account, and the card that shows them never appears.

What it does
------------
Empties the deposit queue, because `_withdraw` pays out of that before it
touches anything else. Then turns off instant withdrawals for the length of
one withdrawal, which forces that withdrawal into the queue, and turns them
back on. Then rolls time past
the pool's batch interval and runs the upkeep Chainlink Automation would run,
which settles the batch and leaves the amount collectable.

Both halves are worth having on their own: stop after the first and the card
reads "Waiting to settle" with a live batch countdown; run both and it reads
"Ready to withdraw" with a button that works.
*/

async function main() {
  // Account 1 by default because it has never queued a deposit. See the
  // guard below for why that matters.
  const accountIndex = Number(process.env.ACCOUNT ?? 1)
  const amount = toEther(Number(process.env.AMOUNT ?? 500))

  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const withdrawalPool = (await getContract('LINK_WithdrawalPool')) as WithdrawalPool

  const signers = await ethers.getSigners()
  const account = signers[accountIndex]

  const balance = await stakingPool.balanceOf(account.address)
  console.log(`account ${accountIndex} ${account.address}`)
  console.log(`  stLINK balance   ${link(balance)}`)
  console.log(`  withdrawing      ${link(amount)}`)

  if (balance < amount) {
    throw new Error(
      `account ${accountIndex} holds ${link(balance)}, which is less than the ${link(
        amount
      )} requested`
    )
  }

  /**
   * Draining the deposit queue leaves the pool's `totalQueued` at zero while
   * accounts that queued deposits still carry their own balances: those are
   * only cleared by a distribution, which `distribute-queue.ts` publishes.
   *
   * A withdrawal from such an account then fails at the wallet with "ERC20:
   * insufficient allowance". `useWithdrawForm` approves
   * `amount - priorityBalance`, assuming the whole balance unqueues, but
   * `PriorityPool.withdraw` unqueues `min(accountQueued, totalQueued)`, which
   * is zero here, so the transfer needs the full amount.
   *
   * Production never sees the gap: `depositQueuedTokens` and
   * `updateDistribution` bracket it, and the pool is paused in between. This
   * script opens it deliberately, so it refuses to hand anyone a withdrawal
   * that cannot be signed.
   */
  const accountQueued = await priorityPool.getQueuedTokens(account.address, 0)
  if (accountQueued > 0n) {
    throw new Error(
      `account ${accountIndex} has ${link(accountQueued)} of queued deposits.\n` +
        'Emptying the deposit queue would leave it unable to unqueue them, and the\n' +
        'withdrawal would revert with "ERC20: insufficient allowance".\n' +
        'Use an account that has never queued a deposit, such as ACCOUNT=1, or run\n' +
        'distribute-queue.ts first to settle the queued balances.'
    )
  }

  // 1. Empty the deposit queue. `_withdraw` pays out of it before it touches
  //    anything else, so while it holds more than the amount being withdrawn
  //    nothing ever reaches the withdrawal pool. This is what made the first
  //    version of this script report "queued: 0": the local queue held 6,515
  //    LINK against a 500 withdrawal.
  console.log('\nemptying the deposit queue')
  await drainDepositQueue(amount)

  // 2. Force the withdrawal into the queue. `canWithdraw` consults this flag
  //    for everyone except the withdrawal pool itself, so the batch can still
  //    be settled below while it is off.
  //
  //    Restored to what it was, not to `true`: this env deploys with instant
  //    withdrawals off (`deploy-link-staking.ts` passes `false`), so an
  //    earlier version of this script was quietly turning them on.
  const wasInstant = await priorityPool.allowInstantWithdrawals()
  console.log(`\ndisabling instant withdrawals (were ${wasInstant})`)
  await (await priorityPool.setAllowInstantWithdrawals(false)).wait()

  try {
    await (await stakingPool.connect(account).approve(priorityPool.target, amount)).wait()

    // `shouldUnqueue` false: unqueueing checks a merkle proof, and this
    // account's queued deposits are not what the exercise is about.
    await (
      await priorityPool.connect(account).withdraw(amount, 0, 0, [], false, true, strategyData)
    ).wait()
  } finally {
    if (wasInstant) {
      console.log('restoring instant withdrawals')
      await (await priorityPool.setAllowInstantWithdrawals(true)).wait()
    }
  }

  const queued = await withdrawalPool.getAccountTotalQueuedWithdrawals(account.address)
  console.log(`\nqueued for this account: ${link(queued)}`)
  if (queued === 0n) {
    throw new Error(
      'nothing reached the withdrawal pool: the amount was below its minimum, or the deposit queue absorbed it'
    )
  }

  // 3. Settle the batch. Chainlink Automation would call this; nothing stops
  //    anyone else from doing so once the interval has passed.
  const interval = await withdrawalPool.minTimeBetweenWithdrawals()
  console.log(`\nrolling past the ${interval} second batch interval`)
  await time.increase(Number(interval) + 1)

  // Called without asking `checkUpkeep` first, on purpose: the deployed
  // pools on this node are older than the contracts in the submodule, so
  // decoding that view's result against the current ABI fails before it can
  // answer. `performUpkeep` returns nothing, so it has no result to mis-decode
  // and reverts only if the upkeep genuinely is not due.
  try {
    await (
      await withdrawalPool.performUpkeep(
        ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [strategyData])
      )
    ).wait()
  } catch (error) {
    console.log(`\ncould not settle the batch: ${(error as Error).message.split('\n')[0]}`)
    console.log(
      `The ${link(queued)} stays queued, which is still worth looking at:\n` +
        `open /v2/link/withdraw as test account ${accountIndex} and the card reads\n` +
        '"Waiting to settle" with a live countdown to the next batch.'
    )
    return
  }

  const [, withdrawable] = await withdrawalPool.getFinalizedWithdrawalIdsByOwner(account.address)
  console.log(`\nready to withdraw: ${link(withdrawable)}`)
  console.log(
    `Open /v2/link/withdraw as test account ${accountIndex}: the card should offer to withdraw it.`
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
