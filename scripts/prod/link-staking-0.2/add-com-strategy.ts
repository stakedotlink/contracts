import { ethers } from 'hardhat'
import Safe, { EthersAdapter } from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types'
import { CommunityVCS, StakingPool } from '../../../typechain-types'
import { getContract } from '../../utils/deployment'
import { getAccounts } from '../../utils/helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

async function main() {
  const { signers, accounts } = await getAccounts()
  const ethAdapter = new EthersAdapter({
    ethers,
    signerOrProvider: signers[0],
  })
  const safeSdk = await Safe.create({ ethAdapter, safeAddress: multisigAddress })
  const safeService = new SafeApiKit({
    txServiceUrl: 'https://safe-transaction-mainnet.safe.global',
    ethAdapter,
  })

  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS

  const safeTransactionData: MetaTransactionData[] = [
    {
      to: stakingPool.address,
      data: (await stakingPool.populateTransaction.addStrategy(communityVCS.address)).data || '',
      value: '0',
    },
    {
      to: stakingPool.address,
      data: (await stakingPool.populateTransaction.reorderStrategies([1, 0])).data || '',
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
    senderAddress: accounts[0],
    senderSignature: senderSignature.data,
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })