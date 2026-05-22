import hre, { ethers } from 'hardhat'
import Safe from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { MetaTransactionData } from '@safe-global/types-kit'
import { GovernanceTimelock } from '../../../typechain-types'
import { getContract } from '../../utils/deployment'
import { getAccounts } from '../../utils/helpers'

// ------------------------------- Configuration -------------------------------

// Safe multisig that owns the timelock
const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'
// Safe Transaction Service API key
const safeApiKey = ''

// Deployment key of the proxy being upgraded (e.g. 'LINK_PriorityPool')
const deploymentKey = ''
// Address of the new implementation (output of 1-deploy-upgrade-imp.ts)
const newImplementation = ''
// Minimum timelock delay in seconds (24h = 86400)
const timelockDelay = 86400

// Optional: additional calls to batch alongside upgradeTo. Each entry is
// { target, data } — pre-populated calldata to execute through the timelock
// in the same batch as the upgrade. Useful for post-upgrade setX configuration.
const extraCalls: { target: string; data: string }[] = []

// -----------------------------------------------------------------------------

async function main() {
  if (!deploymentKey) throw new Error('Set deploymentKey before running')
  if (!newImplementation) throw new Error('Set newImplementation before running')

  const { accounts } = await getAccounts()

  const proxy = await getContract(deploymentKey)
  const timelock = (await getContract('GovernanceTimelock')) as GovernanceTimelock

  const upgradeCall = {
    target: proxy.target.toString(),
    data: (await (proxy as any).upgradeTo.populateTransaction(newImplementation)).data || '',
  }

  const calls = [upgradeCall, ...extraCalls]

  const timelockBatch: any = [
    calls.map((c) => c.target),
    calls.map(() => 0),
    calls.map((c) => c.data),
    ethers.ZeroHash,
    ethers.ZeroHash,
    timelockDelay,
  ]

  const apiKit = new SafeApiKit({ chainId: 1n, apiKey: safeApiKey })
  const protocolKit = await Safe.init({
    provider: hre.network.provider,
    signer: accounts[0],
    safeAddress: multisigAddress,
  })

  const transactions: MetaTransactionData[] = [
    {
      to: timelock.target.toString(),
      data: (await timelock.scheduleBatch.populateTransaction(...timelockBatch)).data || '',
      value: '0',
    },
  ]

  const nonce = Number(await apiKit.getNextNonce(multisigAddress))
  const safeTransaction = await protocolKit.createTransaction({
    transactions,
    options: { nonce },
  })
  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction)
  const signature = await protocolKit.signHash(safeTxHash)

  await apiKit.proposeTransaction({
    safeAddress: multisigAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: accounts[0],
    senderSignature: signature.data,
  })

  console.log('Safe transaction proposed with hash:', safeTxHash)
  console.log(`Batched ${calls.length} call(s) into the timelock:`)
  for (const c of calls) {
    console.log(`  - ${c.target}: ${c.data.slice(0, 10)}...`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
