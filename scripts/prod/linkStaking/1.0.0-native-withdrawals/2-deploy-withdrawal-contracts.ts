import {
  updateDeployments,
  getContract,
  deployUpgradeable,
  deploy,
} from '../../../utils/deployment'
import { ethers } from 'hardhat'
import { toEther } from '../../../utils/helpers'
import { FundFlowController, RebaseController, WithdrawalPool } from '../../../../typechain-types'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

// Rebase Controller
const RebaseControllerArgs = {
  emergencyPauser: '0x785a2de1cad17721b05d111bf087b1d87048f4a5', // address authorized to pause pool in case of emergency
  rewardsUpdater: '0xf5c08D55a77063ac4E5E18F1a470804088BE1ad4', // address authorized to update rewards
}
// Withdrawal Pool
const WithdrawalPoolArgs = {
  minWithdrawalAmount: toEther(5), // minimum amount of LSTs that can be queued for withdrawal
  minTimeBetweenWithdrawals: 86400 * 3, // min amount of time between execution of withdrawals
}
// Fund Flow Controller
const FundFlowControllerArgs = {
  unbondingPeriod: 2419200, // unbonding period as set in Chainlink staking contract
  claimPeriod: 604800, // claim period as set in Chainlink staking contract
  numVaultGroups: 5, // total number of vault groups
}

async function main() {
  const linkToken = await getContract('LINKToken')
  const stakingPool = await getContract('LINK_StakingPool')
  const priorityPool = await getContract('LINK_PriorityPool')
  const operatorVCS = await getContract('LINK_OperatorVCS')
  const communityVCS = await getContract('LINK_CommunityVCS')

  const rebaseController = (await deploy('RebaseController', [
    stakingPool.target,
    priorityPool.target,
    ethers.ZeroAddress,
    RebaseControllerArgs.emergencyPauser,
    RebaseControllerArgs.rewardsUpdater,
  ])) as RebaseController
  console.log('LINK_RebaseController deployed: ', rebaseController.target)

  const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
    linkToken.target,
    stakingPool.target,
    priorityPool.target,
    WithdrawalPoolArgs.minWithdrawalAmount,
    WithdrawalPoolArgs.minTimeBetweenWithdrawals,
  ])) as WithdrawalPool
  console.log('LINK_WithdrawalPool deployed: ', withdrawalPool.target)

  const fundFlowController = (await deployUpgradeable('FundFlowController', [
    operatorVCS.target,
    communityVCS.target,
    FundFlowControllerArgs.unbondingPeriod,
    FundFlowControllerArgs.claimPeriod,
    FundFlowControllerArgs.numVaultGroups,
  ])) as FundFlowController
  console.log('LINK_FundFlowController deployed: ', fundFlowController.target)

  await (await rebaseController.transferOwnership(multisigAddress)).wait()
  await (await withdrawalPool.transferOwnership(multisigAddress)).wait()
  await (await fundFlowController.transferOwnership(multisigAddress)).wait()

  updateDeployments(
    {
      LINK_RebaseController: rebaseController.target.toString(),
      LINK_WithdrawalPool: withdrawalPool.target.toString(),
      LINK_FundFlowController: fundFlowController.target.toString(),
    },
    {
      LINK_RebaseController: 'RebaseController',
      LINK_WithdrawalPool: 'WithdrawalPool',
      LINK_FundFlowController: 'FundFlowController',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
