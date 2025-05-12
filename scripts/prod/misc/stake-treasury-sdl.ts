import hre, { ethers } from 'hardhat'
import SafeApiKit from '@safe-global/api-kit'
import Safe from '@safe-global/protocol-kit'
import { MetaTransactionData } from '@safe-global/types-kit'
import { ERC677 } from '../../../typechain-types'
import { getContract } from '../../utils/deployment'
import { getAccounts, toEther } from '../../utils/helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const numStakes = 20
const amountPerStake = 50000
const lockingDuration = 4 * 365 * 86400

async function main() {
  const { accounts } = await getAccounts()

  const apiKit = new SafeApiKit({
    chainId: 1n,
  })
  const protocolKit = await Safe.init({
    provider: hre.network.provider,
    signer: accounts[0],
    safeAddress: multisigAddress,
  })

  const sdlPool = await getContract('SDLPool')
  const sdlToken = (await getContract('SDLToken')) as ERC677

  let transactions: MetaTransactionData[] = []
  for (let i = 0; i < numStakes; i++) {
    transactions.push({
      to: sdlToken.target.toString(),
      data:
        (
          await sdlToken.transferAndCall.populateTransaction(
            sdlPool.target,
            toEther(amountPerStake),
            ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, lockingDuration])
          )
        ).data || '',
      value: '0',
    })
  }

  const nonce = Number(await apiKit.getNextNonce(multisigAddress))
  const safeTransaction = await protocolKit.createTransaction({ transactions, options: { nonce } })
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

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
