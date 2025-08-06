import { getAccounts, toEther, setupToken } from '../../../utils/helpers'
import { getContract } from '../../../utils/deployment'
import { StakingPool, ERC677, PriorityPool, StrategyMock } from '../../../../typechain-types'
import base58 from 'bs58'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'

/*
Accounts:
0 - main account that holds most of the tokens
1 - holds METIS + stMETIS
2 - holds METIS + stMETIS + has withdrawable METIS + has unclaimed stMETIS rewards
3 - holds METIS + stMETIS + has queued METIS + has claimable stMETIS + has unclaimed stMETIS rewards
4 - holds METIS + has queued METIS + has claimable stMETIS + has unclaimed stMETIS rewards
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
      "amount": "30000000000000000000",
      "sharesAmount": "15000000000000000000"
    },
    "0x555f27995D7BB56c989d7C1cA4e5e03e930ecA67": {
      "amount": "40000000000000000000",
      "sharesAmount": "20000000000000000000"
    },
  }
}
*/

export async function setupMETISStaking() {
  const { signers, accounts } = await getAccounts()
  const metisToken = (await getContract('METISToken')) as ERC677
  const stakingPool = (await getContract('METIS_StakingPool')) as StakingPool
  const priorityPool = (await getContract('METIS_PriorityPool')) as PriorityPool
  const l2Strategy = (await getContract('METIS_L2Strategy')) as StrategyMock
  const stMETISSDLRewardsPool = await getContract('stMETIS_SDLRewardsPool')

  // Staking Setup

  await setupToken(metisToken, accounts)

  await (await metisToken.approve(priorityPool.target, toEther(47000))).wait()
  await (await priorityPool.deposit(toEther(47000), false, ['0x'])).wait()
  await (await metisToken.transfer(l2Strategy.target, toEther(47000))).wait()
  await (await stakingPool.updateStrategyRewards([0], '0x')).wait()

  // Account 1
  await (await metisToken.connect(signers[1]).approve(priorityPool.target, toEther(1000))).wait()
  await (await priorityPool.connect(signers[1]).deposit(toEther(1000), false, ['0x'])).wait()

  // Account 2

  await (await metisToken.connect(signers[2]).approve(priorityPool.target, toEther(2000))).wait()
  await (await priorityPool.connect(signers[2]).deposit(toEther(2000), false, ['0x'])).wait()
  await (await l2Strategy.setMinDeposits(toEther(100000))).wait()
  await (await stakingPool.approve(priorityPool.target, toEther(500))).wait()
  await (await priorityPool.withdraw(toEther(500), 0, 0, [], false, true, ['0x'])).wait()
  await (await l2Strategy.setMinDeposits(toEther(20000))).wait()

  // Account 3

  await (await metisToken.connect(signers[3]).approve(priorityPool.target, toEther(7200))).wait()
  await (await priorityPool.connect(signers[3]).deposit(toEther(3500), false, ['0x'])).wait()
  await (await priorityPool.connect(signers[3]).deposit(toEther(3700), true, ['0x'])).wait()

  // Account 4

  await (await metisToken.connect(signers[4]).approve(priorityPool.target, toEther(4000))).wait()
  await (await priorityPool.connect(signers[4]).deposit(toEther(4000), true, ['0x'])).wait()

  // Priority Pool Distribution

  await (await l2Strategy.setMaxDeposits(toEther(100700))).wait()
  await (await priorityPool.depositQueuedTokens(toEther(700), toEther(700), ['0x'])).wait()
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

  await (await stakingPool.addFee(stMETISSDLRewardsPool.target, 1000)).wait()
  await (await stakingPool.addFee(accounts[0], 300)).wait()

  await (await metisToken.transfer(l2Strategy.target, toEther(3000))).wait()
  await (await stakingPool.updateStrategyRewards([0], '0x')).wait()

  await (await metisToken.transfer(l2Strategy.target, toEther(2384))).wait()
  await (await stakingPool.updateStrategyRewards([0], '0x')).wait()

  await (await metisToken.transfer(l2Strategy.target, toEther(5968))).wait()
  await (await stakingPool.updateStrategyRewards([0], '0x')).wait()
}
