import { CommunityVCS } from '../../../typechain-types'
import { getContract } from '../../utils/deployment'
import { ethers, fromEther, toEther } from '../../utils/helpers'

// claims Chainlink staking rewards from every community vault holding at least minRewards, in batches
// that fit under mainnet's per-transaction gas cap (2^24, EIP-7825); claimed vaults fall below
// minRewards, so a rerun picks up where a failed run stopped

// skips vaults whose rewards don't cover their ~100k gas share
const minRewards = toEther(1)
// starting batch size; a batch is halved until its estimate fits under maxBatchGas
const vaultsPerBatch = 100
// keeps the 20% gas limit headroom under the 16,777,216 cap
const maxBatchGas = 12_000_000n
// about the median tip in recent mainnet blocks
const minTip = ethers.parseUnits('0.15', 'gwei')

const multicall3 = '0xcA11bde05977b3631167028862bE2a173976CA11'

async function main() {
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS
  if ((await communityVCS.currentVaultIndex()) != 0n) throw new Error('Deposit update in progress')

  const vaults = await communityVCS.getVaults()
  const rewards = await readRewards(vaults)
  const ids = vaults.map((_, i) => i).filter((i) => rewards[i] >= minRewards)
  if (ids.length == 0) {
    console.log('No vaults to claim from')
    return
  }

  const batches: Batch[] = []
  for (let i = 0; i < ids.length; i += vaultsPerBatch) {
    batches.push(...(await fitBatch(communityVCS, ids.slice(i, i + vaultsPerBatch))))
  }

  const total = ids.reduce((sum, i) => sum + rewards[i], 0n)
  const gas = batches.reduce((sum, batch) => sum + batch.gas, 0n)
  console.log(`Claiming ${fromEther(total).toFixed(2)} LINK from ${ids.length} vaults`)
  console.log(`${batches.length} batches, ${gas} gas`)

  for (const [n, batch] of batches.entries()) {
    const tx = await communityVCS.claimRewards(batch.ids, minRewards, {
      gasLimit: (batch.gas * 12n) / 10n,
      ...(await getFees()),
    })
    console.log(`Batch ${n + 1}/${batches.length} (${batch.ids.length} vaults): ${tx.hash}`)
    await tx.wait()
  }
}

type Batch = { ids: number[]; gas: bigint }

// hardhat-ledger signs before Hardhat fills in fees, so it rejects a transaction without them; the
// RPC can suggest a near-zero tip, which leaves a 10M-gas transaction pending
async function getFees() {
  const { maxFeePerGas, maxPriorityFeePerGas } = await ethers.provider.getFeeData()
  const tip = maxPriorityFeePerGas! > minTip ? maxPriorityFeePerGas! : minTip
  return { maxFeePerGas: maxFeePerGas! - maxPriorityFeePerGas! + tip, maxPriorityFeePerGas: tip }
}

// reads claimable rewards through Multicall3, 100 vaults per call to stay under RPC eth_call gas caps;
// a call per vault takes over a minute
async function readRewards(vaults: string[]) {
  const multicall = await ethers.getContractAt('Multicall3', multicall3)
  const vault = await ethers.getContractAt('CommunityVault', vaults[0])
  const callData = vault.interface.encodeFunctionData('getRewards')

  const rewards: bigint[] = []
  for (let i = 0; i < vaults.length; i += 100) {
    const calls = vaults
      .slice(i, i + 100)
      .map((target) => ({ target, allowFailure: false, callData }))
    const results = await multicall.aggregate3.staticCall(calls)
    rewards.push(
      ...results.map(({ returnData }) => {
        return vault.interface.decodeFunctionResult('getRewards', returnData)[0] as bigint
      })
    )
  }
  return rewards
}

async function fitBatch(communityVCS: CommunityVCS, ids: number[]): Promise<Batch[]> {
  const gas = await communityVCS.claimRewards.estimateGas(ids, minRewards)
  if (gas <= maxBatchGas || ids.length == 1) return [{ ids, gas }]

  const half = Math.ceil(ids.length / 2)
  return [
    ...(await fitBatch(communityVCS, ids.slice(0, half))),
    ...(await fitBatch(communityVCS, ids.slice(half))),
  ]
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
