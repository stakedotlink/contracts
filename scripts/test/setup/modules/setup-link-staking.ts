import { getAccounts, toEther, setupToken } from '../../../utils/helpers'
import { getContract, deploy, updateDeployments } from '../../../utils/deployment'
import {
  StakingPool,
  ERC677,
  PriorityPool,
  DelegatorPool,
  CommunityVCS,
  OperatorVCS,
  StakingMock,
} from '../../../../typechain-types'
import base58 from 'bs58'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { time } from '@nomicfoundation/hardhat-network-helpers'

/*
Accounts:
0 - main account that holds most of the tokens
1 - holds LINK + stLINK
2 - holds LINK + stLINK + has withdrawable LINK + has unclaimed stLINK rewards
3 - holds LINK + stLINK + has queued LINK + has claimable stLINK + has unclaimed stLINK rewards
4 - holds LINK + has queued LINK + has claimable stLINK + has unclaimed stLINK rewards
5 - has LINK staked in Community Pool
6 - has unbonded LINK staked in Community Pool 
7 - has unbonding LINK staked in Community Pool
*/

/*
Priority Pool IPFS mock data
CID: QmPmDRJy6EZNAu64Sp37G2k3UgLnSGU3957biQhMjZ4auv
data:
{
  "merkleRoot": "0x636b20fe97efac2148da6cc0342a0dfc7e670ee78681c00cfdf4338c8984d23f",
  "data": {
    "0x0000000000000000000000000000000000000000": {
      "amount": "0",
      "sharesAmount": "0"
    },
    "0x444485D3d01447da706550B1c10362676193CAd0": {
      "amount": "300000000000000000000",
      "sharesAmount": "150000000000000000000"
    },
    "0x555f27995D7BB56c989d7C1cA4e5e03e930ecA67": {
      "amount": "400000000000000000000",
      "sharesAmount": "200000000000000000000"
    },
  }
}
*/

const depositData = [
  ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[]]),
  ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[]]),
]

export async function setupLINKStaking() {
  const { signers, accounts } = await getAccounts()
  const linkToken = (await getContract('LINKToken')) as ERC677
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const priorityPool = (await getContract('LINK_PriorityPool')) as PriorityPool
  const communityVCS = (await getContract('LINK_CommunityVCS')) as CommunityVCS
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const wsdToken = await getContract('LINK_WrappedSDToken')
  const sdlPool = await getContract('SDLPool')
  const stLINKSDLRewardsPool = await getContract('stLINK_SDLRewardsPool')
  const communityPool = (await ethers.getContractAt(
    'StakingMock',
    await communityVCS.stakeController()
  )) as any as StakingMock

  // Staking Setup

  await setupToken(linkToken, accounts)

  await (
    await linkToken.transferAndCall(
      priorityPool.target,
      toEther(222000),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [false, depositData])
    )
  ).wait()
  await (await linkToken.transfer(communityVCS.target, toEther(222000))).wait()
  await (await stakingPool.updateStrategyRewards([0, 1], '0x')).wait()
  await (await priorityPool.depositQueuedTokens(0, toEther(222000), depositData)).wait()

  // Account 1

  await (
    await linkToken
      .connect(signers[1])
      .transferAndCall(
        priorityPool.target,
        toEther(1000),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [false, depositData])
      )
  ).wait()

  // Account 2

  await (
    await linkToken
      .connect(signers[2])
      .transferAndCall(
        priorityPool.target,
        toEther(2000),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [false, depositData])
      )
  ).wait()
  await (await stakingPool.approve(priorityPool.target, toEther(500))).wait()
  await (await priorityPool.withdraw(toEther(500), 0, 0, [], false, true, depositData)).wait()

  // Account 3

  await (
    await linkToken
      .connect(signers[3])
      .transferAndCall(
        priorityPool.target,
        toEther(3500),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [false, depositData])
      )
  ).wait()

  await (
    await linkToken
      .connect(signers[3])
      .transferAndCall(
        priorityPool.target,
        toEther(3700),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, depositData])
      )
  ).wait()

  // Account 4

  await (
    await linkToken
      .connect(signers[4])
      .transferAndCall(
        priorityPool.target,
        toEther(4000),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, depositData])
      )
  ).wait()

  // Account 5

  await (
    await linkToken.connect(signers[5]).transferAndCall(communityPool.target, toEther(5000), '0x')
  ).wait()

  // Account 6

  await (
    await linkToken.connect(signers[6]).transferAndCall(communityPool.target, toEther(6000), '0x')
  ).wait()
  await (await communityPool.connect(signers[6]).unbond()).wait()
  await time.increase(86400 * 28)

  // Account 7

  await (
    await linkToken.connect(signers[7]).transferAndCall(communityPool.target, toEther(7000), '0x')
  ).wait()
  await (await communityPool.connect(signers[7]).unbond()).wait()

  // Priority Pool Distribution

  await (await communityVCS.addVaults(1)).wait()
  await (await priorityPool.depositQueuedTokens(toEther(700), toEther(700), depositData)).wait()
  await (await priorityPool.pauseForUpdate()).wait()

  let tree = StandardMerkleTree.of(
    [
      [ethers.ZeroAddress, toEther(0), toEther(0)],
      [accounts[3], toEther(300), toEther(150)],
      [accounts[4], toEther(400), toEther(200)],
    ],
    ['address', 'uint256', 'uint256']
  )
  await (
    await priorityPool.updateDistribution(
      tree.root,
      '0x' +
        Buffer.from(base58.decode('QmPmDRJy6EZNAu64Sp37G2k3UgLnSGU3957biQhMjZ4auv'))
          .toString('hex')
          .slice(4),
      toEther(700),
      toEther(350)
    )
  ).wait()

  // Reward Distribution

  await (await operatorVCS.addFee(stLINKSDLRewardsPool.target, 1500)).wait()
  await (await communityVCS.addFee(stLINKSDLRewardsPool.target, 1000)).wait()
  await (await stakingPool.addFee(accounts[0], 300)).wait()

  const opVaults = await operatorVCS.getVaults()
  const opRewardsController = await ethers.getContractAt(
    'StakingRewardsMock',
    await (
      await ethers.getContractAt('StakingMock', await operatorVCS.stakeController())
    ).rewardVault()
  )
  const comVaults = await communityVCS.getVaults()
  const comRewardsController = await ethers.getContractAt(
    'StakingRewardsMock',
    await (
      await ethers.getContractAt('StakingMock', await communityVCS.stakeController())
    ).rewardVault()
  )

  await (await opRewardsController.setReward(opVaults[0], toEther(2000))).wait()
  await (await comRewardsController.setReward(comVaults[3], toEther(1000))).wait()
  await (await stakingPool.updateStrategyRewards([0, 1], '0x')).wait()

  await (await opRewardsController.setReward(opVaults[1], toEther(698))).wait()
  await (await comRewardsController.setReward(comVaults[2], toEther(777))).wait()
  await (await stakingPool.updateStrategyRewards([0, 1], '0x')).wait()

  await (await opRewardsController.setReward(opVaults[2], toEther(1893))).wait()
  await (await comRewardsController.setReward(comVaults[4], toEther(1237))).wait()
  await (await stakingPool.updateStrategyRewards([0, 1], '0x')).wait()

  // Delegator Pool Setup

  let stLINK_DelegatorRewardsPool = await deploy('RewardsPoolWSD', [
    delegatorPool.target,
    stakingPool.target,
    wsdToken.target,
  ])
  await (
    await delegatorPool.addToken(stakingPool.target, stLINK_DelegatorRewardsPool.target)
  ).wait()

  updateDeployments(
    {
      stLINK_DelegatorRewardsPool: stLINK_DelegatorRewardsPool.target,
    },
    {
      stLINK_DelegatorRewardsPool: 'RewardsPoolWSD',
    }
  )

  await (await stakingPool.transferAndCall(delegatorPool.target, toEther(1000), '0x')).wait()
  await (await delegatorPool.retireDelegatorPool([], sdlPool.target)).wait()
}
