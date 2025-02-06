import hre, { ethers } from 'hardhat'
import Safe from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { CommunityVCS, OperatorVCS, PriorityPool, StakingPool } from '../../../../typechain-types'
import { getContract } from '../../../utils/deployment'
import { getAccounts, toEther } from '../../../utils/helpers'
import { MetaTransactionData } from '@safe-global/types-kit'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const priorityPoolImp = ''
const stakingPoolImp = ''
const operatorVCSImp = ''
const communityVCSImp = ''
const operatorVaultImp = ''
const communityVaultImp = ''
const vaultDepositController = ''

// Staking Pool
const StakingPoolArgs = {
  unusedDepositLimit: toEther(5000),
}
// Operator VCS
const OperatorVCSArgs = {
  maxDepositSizeBP: 9000,
  vaultMaxDeposits: toEther(75000),
}
// Community VCS
const CommunityVCSArgs = {
  maxDepositSizeBP: 10000,
  vaultMaxDeposits: toEther(15000),
}

async function main() {
  const { signers, accounts } = await getAccounts()

  const apiKit = new SafeApiKit({
    chainId: 1n,
  })

  const protocolKitOwner = await Safe.init({
    provider: hre.network.provider,
    signer: signers[0],
    safeAddress: multisigAddress,
  })

  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const withdrawalPool = await getContract('LINK_WithdrawalPool')
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const rebaseController = await getContract('LINK_RebaseController')
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS
  const fundFlowController = await getContract('LINK_FundFlowController')

  const numOperatorVaults = (await operatorVCS.getVaults()).length
  const operatorVaultsToUpgrade = [...Array(numOperatorVaults).keys()]
  const operatorVaultUpgradeData = Array(numOperatorVaults).fill('0x')

  const numCommunityVaults = (await communityVCS.getVaults()).length
  const communityVaultsToUpgrade = [...Array(numCommunityVaults).keys()]
  const communityVaultUpgradeData = Array(numCommunityVaults).fill('0x')

  const transactions: MetaTransactionData[] = [
    {
      to: priorityPool.target.toString(),
      data: (await priorityPool.upgradeTo.populateTransaction(priorityPoolImp)).data || '',
      value: '0',
    },
    {
      to: priorityPool.target.toString(),
      data:
        (await priorityPool.setRebaseController.populateTransaction(rebaseController.target))
          .data || '',
      value: '0',
    },
    {
      to: priorityPool.target.toString(),
      data:
        (await priorityPool.setWithdrawalPool.populateTransaction(withdrawalPool.target)).data ||
        '',
      value: '0',
    },
    {
      to: stakingPool.target.toString(),
      data: (await stakingPool.upgradeTo.populateTransaction(stakingPoolImp)).data || '',
      value: '0',
    },
    {
      to: stakingPool.target.toString(),
      data:
        (await stakingPool.setRebaseController.populateTransaction(rebaseController.target)).data ||
        '',
      value: '0',
    },
    {
      to: stakingPool.target.toString(),
      data:
        (
          await stakingPool.setUnusedDepositLimit.populateTransaction(
            StakingPoolArgs.unusedDepositLimit
          )
        ).data || '',
      value: '0',
    },
    {
      to: operatorVCS.target.toString(),
      data:
        (
          await operatorVCS.upgradeToAndCall.populateTransaction(
            operatorVCSImp,
            operatorVCS.interface.encodeFunctionData('initialize', [
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              [],
              OperatorVCSArgs.maxDepositSizeBP,
              OperatorVCSArgs.vaultMaxDeposits,
              0,
              ethers.ZeroAddress,
            ])
          )
        ).data || '',
      value: '0',
    },
    {
      to: operatorVCS.target.toString(),
      data:
        (await operatorVCS.setVaultImplementation.populateTransaction(operatorVaultImp)).data || '',
      value: '0',
    },
    {
      to: operatorVCS.target.toString(),
      data:
        (await operatorVCS.setFundFlowController.populateTransaction(fundFlowController.target))
          .data || '',
      value: '0',
    },
    {
      to: operatorVCS.target.toString(),
      data:
        (await operatorVCS.setVaultDepositController.populateTransaction(vaultDepositController))
          .data || '',
      value: '0',
    },
    {
      to: operatorVCS.target.toString(),
      data:
        (
          await operatorVCS.upgradeVaults.populateTransaction(
            operatorVaultsToUpgrade,
            operatorVaultUpgradeData
          )
        ).data || '',
      value: '0',
    },
    {
      to: communityVCS.target.toString(),
      data:
        (
          await communityVCS.upgradeToAndCall.populateTransaction(
            communityVCSImp,
            communityVCS.interface.encodeFunctionData('initialize', [
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              [],
              CommunityVCSArgs.maxDepositSizeBP,
              CommunityVCSArgs.vaultMaxDeposits,
              0,
              0,
              ethers.ZeroAddress,
            ])
          )
        ).data || '',
      value: '0',
    },
    {
      to: communityVCS.target.toString(),
      data:
        (await communityVCS.setVaultImplementation.populateTransaction(communityVaultImp)).data ||
        '',
      value: '0',
    },
    {
      to: communityVCS.target.toString(),
      data:
        (await communityVCS.setFundFlowController.populateTransaction(fundFlowController.target))
          .data || '',
      value: '0',
    },
    {
      to: communityVCS.target.toString(),
      data:
        (await communityVCS.setVaultDepositController.populateTransaction(vaultDepositController))
          .data || '',
      value: '0',
    },
    {
      to: communityVCS.target.toString(),
      data:
        (
          await communityVCS.upgradeVaults.populateTransaction(
            communityVaultsToUpgrade,
            communityVaultUpgradeData
          )
        ).data || '',
      value: '0',
    },
  ]
  const safeTransaction = await protocolKitOwner.createTransaction({ transactions })
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
