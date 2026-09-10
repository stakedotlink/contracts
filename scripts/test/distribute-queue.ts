import fs from 'fs'
import path from 'path'
import { ethers } from 'hardhat'
import base58 from 'bs58'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { getContract } from '../utils/deployment'
import { fromEther, toEther } from '../utils/helpers'
import type { CommunityVCS, PriorityPool, StakingPool } from '../../typechain-types'

/*
Moves queued LINK into the staking pool and publishes a distribution for it, so
the queued balances become claimable stLINK in the UI.

  npx hardhat run --network localhost scripts/test/distribute-queue.ts

This is the local stand-in for the two things that happen in production: the
Chainlink Automation upkeep that calls `depositQueuedTokens`, and the
distribution oracle that pauses the pool, publishes a merkle tree to IPFS and
calls `updateDistribution`. Both roles are the deployer here, because
`deploy-link-staking.ts:257` points `distributionOracle` at accounts[0].

Serving the distribution file
-----------------------------
The UI does not take the tree from the chain. It reads the 32-byte hash the
pool stores, base58-encodes it into a CID and fetches that CID from the
gateways in `STAKING_UI_IPFS_URL`. So the file has to be reachable under that
name. This script writes it out ready to serve:

  npx serve contracts/scripts/test/state/ipfs -p 8088
  export STAKING_UI_IPFS_URL=http://localhost:8088

Nothing verifies that the hash is the real IPFS hash of the content, on chain or
in the UI, so the script uses keccak of the file as an identifier. That is a
shortcut only a local environment can afford, and it is the reason this script
must never be pointed at a real network.
*/

const depositData = [
  ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[]]),
  ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[]]),
]

const STATE_DIR = path.join(__dirname, 'state')
const IPFS_DIR = path.join(STATE_DIR, 'ipfs')
const LEDGER = path.join(STATE_DIR, 'pp-distribution.json')

const VAULTS_TO_ADD = 5
const DRAIN_CHUNK = toEther(1_000_000)
const MAX_DRAIN_CALLS = 20

const link = (wei: bigint) => `${Number(fromEther(wei)).toLocaleString('en-US')} LINK`

interface Entry {
  amount: string
  sharesAmount: string
}
interface Distribution {
  /** Which deployment this ledger describes. See `readLedger`. */
  chainId: string
  priorityPool: string
  merkleRoot: string
  data: Record<string, Entry>
}

/**
 * What `setup-link-staking.ts` already published, transcribed from the header
 * comment of that file.
 *
 * The distribution is cumulative: every tree contains the running total for
 * every account that has ever been in it, so a new one cannot be built without
 * knowing the last. On the first run there is no ledger on disk yet, and the
 * file the pool currently points at lives on public IPFS, so the seed is
 * hard-coded rather than fetched.
 */
function seedLedger(chainId: string, priorityPool: string, accounts: string[]): Distribution {
  return {
    chainId,
    priorityPool,
    merkleRoot: '',
    data: {
      [ethers.ZeroAddress]: { amount: '0', sharesAmount: '0' },
      [accounts[3]]: { amount: toEther(300).toString(), sharesAmount: toEther(150).toString() },
      [accounts[4]]: { amount: toEther(400).toString(), sharesAmount: toEther(200).toString() },
    },
  }
}

/**
 * The running totals from previous runs, or the fixture's own if there are
 * none this chain will recognise.
 *
 * The file outlives the chain it describes, in two different ways, and both
 * of them end the same: crediting against totals the pool never staked
 * produces a tree that claims more for an account than it queued, and
 * `getQueuedTokens` then reverts on the subtraction (panic 0x11) instead of
 * returning a balance.
 *
 * A redeploy is caught by the chain and pool it was written for. A snapshot
 * revert is not, since neither changes, so the root is checked too: this
 * ledger is only good if the pool is still pointing at the tree it last
 * produced. An empty root means the file has never published one.
 */
function readLedger(
  chainId: string,
  priorityPool: string,
  merkleRoot: string,
  accounts: string[]
): Distribution {
  if (!fs.existsSync(LEDGER)) return seedLedger(chainId, priorityPool, accounts)

  const onDisk = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) as Distribution
  if (onDisk.chainId !== chainId || onDisk.priorityPool !== priorityPool) {
    console.log(
      `ledger on disk belongs to chain ${onDisk.chainId} pool ${onDisk.priorityPool},` +
        ' starting again from the fixture'
    )
    return seedLedger(chainId, priorityPool, accounts)
  }
  if (onDisk.merkleRoot && onDisk.merkleRoot !== merkleRoot) {
    console.log(
      'the pool is not pointing at the tree this ledger last published, so the chain has' +
        ' been rolled back. Starting again from the fixture'
    )
    return seedLedger(chainId, priorityPool, accounts)
  }
  return onDisk
}

/** The name the UI will ask the gateway for, derived exactly as `ipfs.js` does. */
function cidFor(ipfsHash: string): string {
  return base58.encode(Buffer.from('1220' + ipfsHash.slice(2), 'hex'))
}

async function main() {
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS

  const chainId = (await ethers.provider.getNetwork()).chainId.toString()
  const [accountsOnChain, , queuedBalances] = await priorityPool.getAccountData()
  const signers = await ethers.getSigners()
  const accounts = signers.map((s) => s.address)

  // Snapshot before draining: `_depositQueuedTokens` reduces `totalQueued` but
  // leaves `accountQueuedTokens` alone, and the per-account figure is what the
  // distribution has to credit.
  const queuedBefore = new Map<string, bigint>()
  accountsOnChain.forEach((account, i) => {
    if (queuedBalances[i] > 0n) queuedBefore.set(account, queuedBalances[i])
  })

  const totalQueued = await priorityPool.totalQueued()
  const [undistributed] = await priorityPool.getDepositsSinceLastUpdate()
  console.log('queued now:      ', link(totalQueued))
  console.log('staked, undistributed:', link(undistributed))
  for (const [account, queued] of queuedBefore) {
    console.log(`  ${account} ${link(queued)}`)
  }

  /*
   * Both, not just the queue.
   *
   * A drained queue is not the same as nothing to do: the other test scripts
   * here drain as their first step, and `_withdraw` empties it too when a
   * withdrawal is paid out of it. In both cases the tokens are staked and the
   * accounts are owed the stLINK, with `depositsSinceLastUpdate` holding the
   * amount. Returning early on `totalQueued` alone refused to help in exactly
   * the state the other scripts leave behind.
   */
  if (totalQueued === 0n && undistributed === 0n) {
    console.log('\nnothing queued and nothing staked awaiting a distribution')
    return
  }

  // 1. Room to drain into, then drain. Same call the upkeep makes. Skipped
  //    when the queue is already empty, so this does not add five vaults for
  //    the sake of it.
  if (totalQueued !== 0n) {
    console.log(`\nadding ${VAULTS_TO_ADD} community vaults`)
    await (await communityVCS.addVaults(VAULTS_TO_ADD)).wait()

    for (let i = 0; i < MAX_DRAIN_CALLS; i++) {
      const left = await priorityPool.totalQueued()
      if (left === 0n) break
      console.log(`draining, ${link(left)} left`)
      await (await priorityPool.depositQueuedTokens(0, DRAIN_CHUNK, depositData)).wait()
    }

    const stillQueued = await priorityPool.totalQueued()
    if (stillQueued !== 0n) {
      throw new Error(
        `queue did not empty, ${link(stillQueued)} still waiting. Raise VAULTS_TO_ADD and rerun.`
      )
    }
  }

  /*
   * 2. Credit what has not been credited yet.
   *
   * `getAccountData` reports `accountQueuedTokens`, which is the total an
   * account has ever queued. A distribution does not reduce it: the contract
   * only touches it when someone unqueues (PriorityPool.sol:353 and :408).
   * The fixture leaves accounts 3 and 4 sitting at 300 and 400 LINK with both
   * amounts already in the published tree, so crediting the reported balance
   * would hand them a second 300 and 400.
   *
   * That is not a cosmetic overcount. `getQueuedTokens` returns
   * `accountQueuedTokens - _distributionAmount` (PriorityPool.sol:201), so a
   * tree that claims more than the account ever queued makes the read revert,
   * and the claim it authorises is for stLINK the pool does not hold.
   *
   * So the credit is the difference between the two, and the ledger entry
   * lands on `accountQueuedTokens` exactly. Which is the invariant that makes
   * the UI read zero once everything is distributed.
   */
  const ledger = readLedger(
    chainId,
    await priorityPool.getAddress(),
    await priorityPool.merkleRoot(),
    accounts
  )
  let credited = 0n
  for (const [account, queuedTotal] of queuedBefore) {
    const prev = ledger.data[account] ?? { amount: '0', sharesAmount: '0' }
    const credit = queuedTotal - BigInt(prev.amount)
    if (credit <= 0n) {
      console.log(`skipping ${account}, already distributed`)
      continue
    }
    const shares = await stakingPool.getSharesByStake(credit)
    ledger.data[account] = {
      amount: queuedTotal.toString(),
      sharesAmount: (BigInt(prev.sharesAmount) + shares).toString(),
    }
    credited += credit
    console.log(`crediting ${account} with ${link(credit)}`)
  }

  // 3. Build the tree the way the UI rebuilds it: `getAccounts()` order, and
  //    only the accounts the file actually carries. A different order is a
  //    different root, and every proof then fails verification.
  const treeAccounts = await priorityPool.getAccounts()
  const rows = treeAccounts
    .filter((account) => ledger.data[account])
    .map((account) => [account, ledger.data[account].amount, ledger.data[account].sharesAmount])
  const tree = StandardMerkleTree.of(rows, ['address', 'uint256', 'uint256'])
  ledger.merkleRoot = tree.root

  // 4. Write the file under the name the UI will ask for. The hash is only an
  //    identifier here — see the note at the top.
  const json = JSON.stringify({ merkleRoot: tree.root, data: ledger.data }, null, 2)
  const ipfsHash = ethers.keccak256(ethers.toUtf8Bytes(json))
  const cid = cidFor(ipfsHash)

  fs.mkdirSync(IPFS_DIR, { recursive: true })
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2))
  fs.writeFileSync(path.join(IPFS_DIR, cid), json)

  // 5. Publish. Pass the contract's own counters so they land on zero rather
  //    than underflowing on a residue this script did not put there.
  const [amountDistributed, sharesDistributed] = await priorityPool.getDepositsSinceLastUpdate()

  /*
   * The contract's own account of what has been staked and not yet
   * distributed. It counts two paths, not one: `_depositQueuedTokens` adds
   * what the drain moved, and `_withdraw` adds whatever a withdrawal took out
   * of the deposit queue, since the pool receives the withdrawer's stLINK for
   * it (PriorityPool.sol:776). The second of those lowers `totalQueued`
   * without touching any account, so the credits above can legitimately come
   * to more than the queue that was drained.
   *
   * What they must never come to is more than this. That direction is the
   * dangerous one: it is a tree promising stLINK the pool was never given.
   */
  if (credited > amountDistributed) {
    throw new Error(
      `credits come to ${link(credited)} but the pool has only ${link(amountDistributed)}` +
        ' staked and undistributed. Refusing to publish a tree it cannot cover.'
    )
  }
  if (credited < amountDistributed) {
    console.warn(
      `\ncredits come to ${link(credited)} against ${link(amountDistributed)} undistributed.` +
        `\nThe ${link(amountDistributed - credited)} difference stays in the pool unassigned,` +
        ' which is harmless but means someone deposited outside this script.'
    )
  }

  console.log('\npublishing distribution')
  console.log('  root  ', tree.root)
  console.log('  cid   ', cid)
  console.log('  amount', link(amountDistributed))

  await (await priorityPool.pauseForUpdate()).wait()
  await (
    await priorityPool.updateDistribution(tree.root, ipfsHash, amountDistributed, sharesDistributed)
  ).wait()

  console.log('\nserve the file and point the UI at it:')
  console.log(`  npx serve ${path.relative(process.cwd(), IPFS_DIR)} -p 8088`)
  console.log('  export STAKING_UI_IPFS_URL=http://localhost:8088')
  console.log('\nthen reload the pool page: the queued balances are now Ready to claim')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
