import hre, { ethers } from 'hardhat'
import SafeApiKit from '@safe-global/api-kit'
import Safe from '@safe-global/protocol-kit'
import { MetaTransactionData } from '@safe-global/types-kit'
import { getContract } from '../../../utils/deployment'
import { getAccounts } from '../../../utils/helpers'
import { GovernanceTimelock } from '../../../../typechain-types'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const claimerAddress = '0x43975fe745cB4171E15ceEd5d8D05A3502e0e87B'
const rights = ethers.ZeroHash
const enable = true

async function main() {
  const { accounts } = await getAccounts()

  const apiKit = new SafeApiKit({
    chainId: 1n,
    apiKey: process.env.SAFE_API_KEY,
  })
  const protocolKit = await Safe.init({
    provider: hre.network.provider,
    signer: accounts[0],
    safeAddress: multisigAddress,
  })

  const fundFlowController = await getContract('LINK_FundFlowController')
  const operatorVCS = await getContract('LINK_OperatorVCS')
  const communityVCS = await getContract('LINK_CommunityVCS')
  const timelock = (await getContract('GovernanceTimelock')) as GovernanceTimelock

  const opVaults = await operatorVCS.getVaults()
  const comVaults = await communityVCS.getVaults()

  const timelockTxs: any = [
    [
      fundFlowController.target,
      0,
      (
        await fundFlowController.delegateVaults.populateTransaction(
          [...opVaults, ...comVaults.slice(0, 65)],
          claimerAddress,
          rights,
          enable
        )
      ).data,
      ethers.ZeroHash,
      ethers.ZeroHash,
      86400,
    ],
    [
      fundFlowController.target,
      0,
      (
        await fundFlowController.delegateVaults.populateTransaction(
          [...comVaults.slice(65, 145)],
          claimerAddress,
          rights,
          enable
        )
      ).data,
      ethers.ZeroHash,
      ethers.ZeroHash,
      86400,
    ],
    [
      fundFlowController.target,
      0,
      (
        await fundFlowController.delegateVaults.populateTransaction(
          [...comVaults.slice(145, 225)],
          claimerAddress,
          rights,
          enable
        )
      ).data,
      ethers.ZeroHash,
      ethers.ZeroHash,
      86400,
    ],
    [
      fundFlowController.target,
      0,
      (
        await fundFlowController.delegateVaults.populateTransaction(
          [...comVaults.slice(225)],
          claimerAddress,
          rights,
          enable
        )
      ).data,
      ethers.ZeroHash,
      ethers.ZeroHash,
      86400,
    ],
  ]

  for (let i = 0; i < timelockTxs.length; i++) {
    const transactions: MetaTransactionData[] = [
      {
        to: timelock.target.toString(),
        data: (await timelock.schedule.populateTransaction(...timelockTxs[i])).data || '',
        value: '0',
      },
    ]

    const nonce = Number(await apiKit.getNextNonce(multisigAddress))
    const safeTransaction = await protocolKit.createTransaction({
      transactions: transactions,
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
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
