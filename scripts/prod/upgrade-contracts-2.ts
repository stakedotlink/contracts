import { ethers } from 'hardhat'
import Safe, { EthersAdapter } from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types'
import { PriorityPool, StakingPool, CommunityVCS } from '../../typechain-types'
import { getContract } from '../utils/deployment'
import { getAccounts } from '../utils/helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

// New implementation addresses for the contracts
const priorityPoolNewImplementation = '0x0bC122c224b875cA79250A54a08a6e5df8dEF817'
const stakingPoolNewImplementation = '0xEBc52afCFC9495Ec083264Ed68E8e6F454E5F715'
const communityVCSNewImplementation = '0x96418D70832d08CF683Be81Ee9890e1337FAd41b'

async function main() {
  const { signers } = await getAccounts()
  const ethAdapter = new EthersAdapter({
    ethers,
    signerOrProvider: signers[0],
  })
  const safeSdk = await Safe.create({ ethAdapter, safeAddress: multisigAddress })
  const safeService = new SafeApiKit({
    txServiceUrl: 'https://safe-transaction-mainnet.safe.global',
    ethAdapter,
  })

  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS

  const safeTransactionData: MetaTransactionData[] = [
    {
      to: priorityPool.address,
      data:
        (await priorityPool.populateTransaction.upgradeTo(priorityPoolNewImplementation)).data ||
        '',
      value: '0',
    },
    {
      to: stakingPool.address,
      data:
        (await stakingPool.populateTransaction.upgradeTo(stakingPoolNewImplementation)).data || '',
      value: '0',
    },
    {
      to: communityVCS.address,
      data:
        (await communityVCS.populateTransaction.upgradeTo(communityVCSNewImplementation)).data ||
        '',
      value: '0',
    },
  ]

  const safeTransaction = await safeSdk.createTransaction({ safeTransactionData })
  const safeTxHash = await safeSdk.getTransactionHash(safeTransaction)
  const senderSignature = await safeSdk.signTransactionHash(safeTxHash)

  await safeService.proposeTransaction({
    safeAddress: multisigAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: signers[0].address,
    senderSignature: senderSignature.data,
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
