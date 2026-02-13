import hre, { ethers } from 'hardhat'
import Safe from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { MetaTransactionData } from '@safe-global/types-kit'
import { GovernanceTimelock, SDLPool } from '../../../../typechain-types'
import { getContract } from '../../../utils/deployment'
import { getAccounts } from '../../../utils/helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

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

  const sdlPool = (await getContract('SDLPool')) as SDLPool
  const timelock = (await getContract('GovernanceTimelock')) as GovernanceTimelock
  const stESP = await getContract('ESP_StakingPool')
  const stESPSDLRewardsPool = await getContract('stESP_SDLRewardsPool')

  const timelockTx: any = [
    sdlPool.target,
    0,
    (await sdlPool.addToken.populateTransaction(stESP.target, stESPSDLRewardsPool.target)).data,
    ethers.ZeroHash,
    ethers.ZeroHash,
    86400,
  ]

  const transactions: MetaTransactionData[] = [
    {
      to: timelock.target.toString(),
      data: (await timelock.schedule.populateTransaction(...timelockTx)).data || '',
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
