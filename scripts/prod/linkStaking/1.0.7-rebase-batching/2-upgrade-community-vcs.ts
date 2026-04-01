import hre, { ethers } from 'hardhat'
import Safe from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { MetaTransactionData } from '@safe-global/types-kit'
import { CommunityVCS, GovernanceTimelock } from '../../../../typechain-types'
import { getContract } from '../../../utils/deployment'
import { getAccounts } from '../../../utils/helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

// Set after running 1-deploy-implementation.ts
const communityVCSImp = '0x14024f4e7FeF08cb19F8051456E39Ee899990744'
// Set the deposit updater address
const depositUpdater = '0xf5c08D55a77063ac4E5E18F1a470804088BE1ad4'
// Set the number of vaults per batch
const vaultsPerBatch = 200

async function main() {
  if (!communityVCSImp) throw new Error('Set communityVCSImp before running')
  if (!depositUpdater) throw new Error('Set depositUpdater before running')
  if (!vaultsPerBatch) throw new Error('Set vaultsPerBatch before running')

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

  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS
  const timelock = (await getContract('GovernanceTimelock')) as GovernanceTimelock

  const timelockBatch: any = [
    [communityVCS.target, communityVCS.target, communityVCS.target],
    [0, 0, 0],
    [
      (await communityVCS.upgradeTo.populateTransaction(communityVCSImp)).data,
      (await communityVCS.setVaultsPerBatch.populateTransaction(vaultsPerBatch)).data,
      (await communityVCS.setDepositUpdater.populateTransaction(depositUpdater)).data,
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
