import hre from 'hardhat'
import Safe from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { CommunityVCS, OperatorVCS, PriorityPool, StakingPool } from '../../../../typechain-types'
import { getContract } from '../../../utils/deployment'
import { getAccounts } from '../../../utils/helpers'
import { MetaTransactionData } from '@safe-global/types-kit'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

async function main() {
  const { accounts } = await getAccounts()

  const apiKit = new SafeApiKit({
    chainId: 1n,
  })

  const protocolKitOwner = await Safe.init({
    provider: hre.network.provider,
    signer: accounts[0],
    safeAddress: multisigAddress,
  })

  const governanceTimelock = await getContract('GovernanceTimelock')
  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const withdrawalPool = await getContract('LINK_WithdrawalPool')
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const rebaseController = await getContract('LINK_RebaseController')
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS
  const fundFlowController = await getContract('LINK_FundFlowController')
  const distributionOracle = await getContract('LINK_PP_DistributionOracle')
  const wrappedTokenBridge = await getContract('stLINK_WrappedTokenBridge')

  const sdlPool = await getContract('SDLPool')
  const linearBoostController = await getContract('LinearBoostController')

  const transactions: MetaTransactionData[] = [
    {
      to: priorityPool.target.toString(),
      data:
        (await priorityPool.transferOwnership.populateTransaction(governanceTimelock.target))
          .data || '',
      value: '0',
    },
    {
      to: withdrawalPool.target.toString(),
      data:
        (await withdrawalPool.transferOwnership.populateTransaction(governanceTimelock.target))
          .data || '',
      value: '0',
    },
    {
      to: stakingPool.target.toString(),
      data:
        (await stakingPool.transferOwnership.populateTransaction(governanceTimelock.target)).data ||
        '',
      value: '0',
    },
    {
      to: rebaseController.target.toString(),
      data:
        (await rebaseController.transferOwnership.populateTransaction(governanceTimelock.target))
          .data || '',
      value: '0',
    },
    {
      to: operatorVCS.target.toString(),
      data:
        (await operatorVCS.transferOwnership.populateTransaction(governanceTimelock.target)).data ||
        '',
      value: '0',
    },
    {
      to: communityVCS.target.toString(),
      data:
        (await communityVCS.transferOwnership.populateTransaction(governanceTimelock.target))
          .data || '',
      value: '0',
    },
    {
      to: fundFlowController.target.toString(),
      data:
        (await fundFlowController.transferOwnership.populateTransaction(governanceTimelock.target))
          .data || '',
      value: '0',
    },
    {
      to: distributionOracle.target.toString(),
      data:
        (await distributionOracle.transferOwnership.populateTransaction(governanceTimelock.target))
          .data || '',
      value: '0',
    },
    {
      to: wrappedTokenBridge.target.toString(),
      data:
        (await wrappedTokenBridge.transferOwnership.populateTransaction(governanceTimelock.target))
          .data || '',
      value: '0',
    },
    {
      to: sdlPool.target.toString(),
      data:
        (await sdlPool.transferOwnership.populateTransaction(governanceTimelock.target)).data || '',
      value: '0',
    },
    {
      to: linearBoostController.target.toString(),
      data:
        (
          await linearBoostController.transferOwnership.populateTransaction(
            governanceTimelock.target
          )
        ).data || '',
      value: '0',
    },
  ]
  const safeTransaction = await protocolKitOwner.createTransaction({
    transactions,
  })
  const safeTxHash = await protocolKitOwner.getTransactionHash(safeTransaction)
  const senderSignature = await protocolKitOwner.signHash(safeTxHash)

  await apiKit.proposeTransaction({
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
