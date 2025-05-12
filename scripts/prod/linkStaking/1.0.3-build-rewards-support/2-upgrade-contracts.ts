import hre, { ethers } from 'hardhat'
import SafeApiKit from '@safe-global/api-kit'
import Safe from '@safe-global/protocol-kit'
import { MetaTransactionData } from '@safe-global/types-kit'
import { getContract } from '../../../utils/deployment'
import { getAccounts } from '../../../utils/helpers'
import { GovernanceTimelock } from '../../../../typechain-types'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const fundFlowControllerImp = '0xacbFC09A1C4966F11c969080374010536090A8E0'
const operatorVCSImp = '0x25FB2B9030F8C0002d018Bb02B7D86b844bAAF57'
const communityVCSImp = '0x2339aD1a674fB8BE412Df6CC1c80Fb2bA5c3F647'
const operatorVaultImp = '0xaaBC1C74639B2479e79603cA43F0298E7AaBd392'
const communityVaultImp = '0x94277A23095B27041bEf93EAF9df81E8D733791A'

const FundFlowControllerArgs = {
  linkToken: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  nonLINKRewardReceiver: '0x43975fe745cB4171E15ceEd5d8D05A3502e0e87B',
}

const delegateRegistry = '0x00000000000000447e69651d841bD8D104Bed493'

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

  const fundFlowController = await getContract('LINK_FundFlowController')
  const operatorVCS = await getContract('LINK_OperatorVCS')
  const communityVCS = await getContract('LINK_CommunityVCS')
  const timelock = (await getContract('GovernanceTimelock')) as GovernanceTimelock

  const vaultInterface = (await ethers.getContractFactory('OperatorVault')).interface

  const numOperatorVaults = (await operatorVCS.getVaults()).length
  const operatorVaultsToUpgrade = [...Array(numOperatorVaults).keys()]
  const operatorVaultUpgradeData = Array(numOperatorVaults).fill(
    vaultInterface.encodeFunctionData('setDelegateRegistry', [delegateRegistry])
  )

  const numCommunityVaults = (await communityVCS.getVaults()).length
  const communityVaultsToUpgrade = [...Array(numCommunityVaults).keys()]
  const communityVaultUpgradeData = Array(numCommunityVaults).fill(
    vaultInterface.encodeFunctionData('setDelegateRegistry', [delegateRegistry])
  )

  const timelockBatch: any = [
    [
      fundFlowController.target,
      operatorVCS.target,
      operatorVCS.target,
      operatorVCS.target,
      operatorVCS.target,
      communityVCS.target,
      communityVCS.target,
      communityVCS.target,
      communityVCS.target,
    ],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [
      (
        await fundFlowController.upgradeToAndCall.populateTransaction(
          fundFlowControllerImp,
          fundFlowController.interface.encodeFunctionData('initialize', [
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            FundFlowControllerArgs.linkToken,
            FundFlowControllerArgs.nonLINKRewardReceiver,
            0,
            0,
            0,
          ])
        )
      ).data,
      (await operatorVCS.upgradeTo.populateTransaction(operatorVCSImp)).data,
      (await operatorVCS.setDelegateRegistry.populateTransaction(delegateRegistry)).data,
      (await operatorVCS.setVaultImplementation.populateTransaction(operatorVaultImp)).data,
      (
        await operatorVCS.upgradeVaults.populateTransaction(
          operatorVaultsToUpgrade,
          operatorVaultUpgradeData
        )
      ).data,
      (await communityVCS.upgradeTo.populateTransaction(communityVCSImp)).data,
      (await communityVCS.setDelegateRegistry.populateTransaction(delegateRegistry)).data,
      (await communityVCS.setVaultImplementation.populateTransaction(communityVaultImp)).data,
      (
        await communityVCS.upgradeVaults.populateTransaction(
          communityVaultsToUpgrade.slice(0, 25),
          communityVaultUpgradeData.slice(0, 25)
        )
      ).data,
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

  for (let i = 0; i < 4; i++) {
    const timelockTx: any = [
      communityVCS.target,
      0,
      (
        await communityVCS.upgradeVaults.populateTransaction(
          communityVaultsToUpgrade.slice(i * 50 + 25, (i + 1) * 50 + 25),
          communityVaultUpgradeData.slice(i * 50 + 25, (i + 1) * 50 + 25)
        )
      ).data,
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
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
