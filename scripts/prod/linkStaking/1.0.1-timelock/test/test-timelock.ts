import { fromEther, getAccounts, toEther } from '../../../../utils/helpers'
import { getContract } from '../../../../utils/deployment'
import { ethers } from 'hardhat'
import {
  CommunityVCS,
  FundFlowController,
  GovernanceTimelock,
  OperatorVCS,
  PriorityPool,
  RebaseController,
  StakingPool,
  WithdrawalPool,
} from '../../../../../typechain-types'
import { assert, expect } from 'chai'
import { time } from '@nomicfoundation/hardhat-network-helpers'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'
const executorAddress = '0xd1243345c4c7Ff0A26aF4d291d9C058C9dF3479C'

async function main() {
  const { accounts } = await getAccounts()
  const fundHolder = await ethers.getImpersonatedSigner(
    '0x11187eff852069a33d102476b2E8A9cc9167dAde'
  )
  await fundHolder.sendTransaction({ to: multisigAddress, value: toEther(100) })
  await fundHolder.sendTransaction({ to: executorAddress, value: toEther(100) })
  const signer = await ethers.getImpersonatedSigner(multisigAddress)
  const executor = await ethers.getImpersonatedSigner(executorAddress)

  const governanceTimelock = (await getContract('GovernanceTimelock')) as GovernanceTimelock
  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const withdrawalPool = (await getContract('LINK_WithdrawalPool')) as WithdrawalPool
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const rebaseController = (await getContract('LINK_RebaseController')) as RebaseController
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS
  const fundFlowController = (await getContract('LINK_FundFlowController')) as FundFlowController

  await priorityPool.connect(signer).transferOwnership(governanceTimelock.target)
  await withdrawalPool.connect(signer).transferOwnership(governanceTimelock.target)
  await stakingPool.connect(signer).transferOwnership(governanceTimelock.target)
  await rebaseController.connect(signer).transferOwnership(governanceTimelock.target)
  await operatorVCS.connect(signer).transferOwnership(governanceTimelock.target)
  await communityVCS.connect(signer).transferOwnership(governanceTimelock.target)
  await fundFlowController.connect(signer).transferOwnership(governanceTimelock.target)

  await governanceTimelock
    .connect(signer)
    .scheduleBatch(
      [priorityPool.target, withdrawalPool.target],
      [0, 0],
      [
        priorityPool.interface.encodeFunctionData('transferOwnership', [accounts[0]]),
        withdrawalPool.interface.encodeFunctionData('transferOwnership', [accounts[1]]),
      ],
      ethers.ZeroHash,
      ethers.ZeroHash,
      86400
    )

  await expect(
    governanceTimelock
      .connect(executor)
      .executeBatch(
        [priorityPool.target, withdrawalPool.target],
        [0, 0],
        [
          priorityPool.interface.encodeFunctionData('transferOwnership', [accounts[0]]),
          withdrawalPool.interface.encodeFunctionData('transferOwnership', [accounts[1]]),
        ],
        ethers.ZeroHash,
        ethers.ZeroHash
      )
  ).to.be.revertedWith('TimelockController: operation is not ready')

  await time.increase(86400)

  await governanceTimelock
    .connect(executor)
    .executeBatch(
      [priorityPool.target, withdrawalPool.target],
      [0, 0],
      [
        priorityPool.interface.encodeFunctionData('transferOwnership', [accounts[0]]),
        withdrawalPool.interface.encodeFunctionData('transferOwnership', [accounts[1]]),
      ],
      ethers.ZeroHash,
      ethers.ZeroHash
    )

  assert.equal(await priorityPool.owner(), accounts[0])
  assert.equal(await withdrawalPool.owner(), accounts[1])

  await governanceTimelock
    .connect(signer)
    .scheduleBatch(
      [governanceTimelock.target, governanceTimelock.target],
      [0, 0],
      [
        governanceTimelock.interface.encodeFunctionData('grantRole', [
          ethers.solidityPackedKeccak256(['string'], ['PROPOSER_ROLE']),
          accounts[0],
        ]),
        governanceTimelock.interface.encodeFunctionData('grantRole', [
          ethers.solidityPackedKeccak256(['string'], ['EXECUTOR_ROLE']),
          accounts[1],
        ]),
      ],
      ethers.ZeroHash,
      ethers.ZeroHash,
      86400
    )
  await time.increase(86400)
  await governanceTimelock
    .connect(executor)
    .executeBatch(
      [governanceTimelock.target, governanceTimelock.target],
      [0, 0],
      [
        governanceTimelock.interface.encodeFunctionData('grantRole', [
          ethers.solidityPackedKeccak256(['string'], ['PROPOSER_ROLE']),
          accounts[0],
        ]),
        governanceTimelock.interface.encodeFunctionData('grantRole', [
          ethers.solidityPackedKeccak256(['string'], ['EXECUTOR_ROLE']),
          accounts[1],
        ]),
      ],
      ethers.ZeroHash,
      ethers.ZeroHash
    )

  assert.isTrue(
    await governanceTimelock.hasRole(
      ethers.solidityPackedKeccak256(['string'], ['PROPOSER_ROLE']),
      accounts[0]
    )
  )
  assert.isTrue(
    await governanceTimelock.hasRole(
      ethers.solidityPackedKeccak256(['string'], ['EXECUTOR_ROLE']),
      accounts[1]
    )
  )

  console.log('All tests passed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
