import { ethers } from 'hardhat'
import Safe, { EthersAdapter } from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types'
import { OperatorVCS, PriorityPool, StakingPool } from '../../../typechain-types'
import { getContract } from '../../utils/deployment'
import { getAccounts } from '../../utils/helpers'
import { Interface } from '@ethersproject/abi'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const clOperatorStakingPool = '0xA1d76A7cA72128541E9FCAcafBdA3a92EF94fDc5'
const clRewardsVault = '0x996913c8c08472f584ab8834e925b06d0eb1d813'
const clPriceFeedAlertsController = '0x27484ba119d12649be2a9854e4d3b44cc3fdbad7'

const stakingPoolImplementation = ''
const operatorVCSImplementation = ''
const priorityPoolImplementation = ''
const opVaultImplementation = ''

const operatorRewardPercentage = 1000 //  basis point amount of operator rewards paid to operators
const maxDepositSizeBP = 9000 // basis point amount of the remaing deposit room in the Chainlink staking contract that can be deposited at once

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
  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS
  const operatorVaultInterface = (await ethers.getContractFactory('OperatorVault'))
    .interface as Interface

  const safeTransactionData: MetaTransactionData[] = [
    {
      to: stakingPool.address,
      data: (await stakingPool.populateTransaction.upgradeTo(stakingPoolImplementation)).data || '',
      value: '0',
    },
    {
      to: priorityPool.address,
      data:
        (await priorityPool.populateTransaction.upgradeTo(priorityPoolImplementation)).data || '',
      value: '0',
    },
    {
      to: operatorVCS.address,
      data:
        (
          await operatorVCS.populateTransaction.upgradeToAndCall(
            operatorVCSImplementation,
            operatorVCS.interface.encodeFunctionData('initialize', [
              ethers.constants.AddressZero,
              ethers.constants.AddressZero,
              clOperatorStakingPool,
              opVaultImplementation,
              [],
              maxDepositSizeBP,
              operatorRewardPercentage,
            ])
          )
        ).data || '',
      value: '0',
    },
    {
      to: operatorVCS.address,
      data:
        (await operatorVCS.populateTransaction.updateFee(1, ethers.constants.AddressZero, 0))
          .data || '',
      value: '0',
    },
    {
      to: operatorVCS.address,
      data:
        (
          await operatorVCS.populateTransaction.upgradeVaults(
            0,
            15,
            operatorVaultInterface.encodeFunctionData('initialize', [
              ethers.constants.AddressZero,
              ethers.constants.AddressZero,
              clOperatorStakingPool,
              clRewardsVault,
              clPriceFeedAlertsController,
              ethers.constants.AddressZero,
              ethers.constants.AddressZero,
            ])
          )
        ).data || '',
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
