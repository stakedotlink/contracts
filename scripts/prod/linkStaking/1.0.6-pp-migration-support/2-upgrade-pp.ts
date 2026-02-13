import hre, { ethers } from 'hardhat'
import Safe from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { MetaTransactionData } from '@safe-global/types-kit'
import { GovernanceTimelock, PriorityPool } from '../../../../typechain-types'
import { getContract } from '../../../utils/deployment'
import { getAccounts } from '../../../utils/helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const priorityPoolImp = '0x6Fb9CC7d10A5286A864e760C2756e7F6d44D4d26'
const queueBypassController = '0xdA77b1a19850606D1F4FAA0E200E035faa85FB15'

async function main() {
  const { accounts } = await getAccounts()

  const apiKit = new SafeApiKit({
    chainId: 1n,
    apiKey: '',
  })

  const protocolKit = await Safe.init({
    provider: hre.network.provider,
    signer: accounts[0],
    safeAddress: multisigAddress,
  })

  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const timelock = (await getContract('GovernanceTimelock')) as GovernanceTimelock

  const timelockBatch: any = [
    [priorityPool.target, priorityPool.target],
    [0, 0],
    [
      (await priorityPool.upgradeTo.populateTransaction(priorityPoolImp)).data,
      (await priorityPool.setQueueBypassController.populateTransaction(queueBypassController)).data,
    ],
    ethers.ZeroHash,
    ethers.ZeroHash,
    86400,
  ]

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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
