import { getAccounts, toEther, setupToken } from '../../../utils/helpers'
import { deploy, getContract } from '../../../utils/deployment'
import {
  StakingPool,
  PriorityPool,
  ERC20,
  PolygonStrategy,
  PolygonFundFlowController,
} from '../../../../typechain-types'
import { ethers } from 'hardhat'

/*
Accounts:
0 - main account that holds most of the tokens
1 - holds POL
2 - holds POL + has unclaimed stPOL rewards
3 - holds POL + stPOL + has unclaimed stPOL rewards
4 - holds POL + stPOL + has withdrawable POL + has unclaimed stPOL rewards
*/

// Priority pool mock data N/A as there is no upper deposit limit

export async function setupPOLStaking() {
  const { signers, accounts } = await getAccounts()
  const polToken = (await getContract('POLToken')) as ERC20
  const stakingPool = (await getContract('POL_StakingPool')) as StakingPool
  const priorityPool = (await getContract('POL_PriorityPool')) as PriorityPool
  const strategy = (await getContract('POL_PolygonStrategy')) as PolygonStrategy
  const fundFlowController = (await getContract(
    'POL_PolygonFundFlowController'
  )) as PolygonFundFlowController
  const stPOLSDLRewardsPool = await getContract('stPOL_SDLRewardsPool')
  const stakeManagerAddress = await strategy.stakeManager()

  // Staking Setup

  await setupToken(polToken, accounts)

  const validatorShare = await deploy('PolygonValidatorShareMock', [stakeManagerAddress])
  await (await strategy.addValidator(validatorShare.target, accounts[0])).wait()

  await (await polToken.approve(priorityPool.target, ethers.MaxUint256)).wait()
  await (await priorityPool.deposit(toEther(200000), false, ['0x'])).wait()
  await (await polToken.transfer(strategy.target, toEther(150000))).wait()
  await (await stakingPool.updateStrategyRewards([0], '0x')).wait()

  // Account 3

  await (await polToken.connect(signers[3]).approve(priorityPool.target, ethers.MaxUint256)).wait()
  await (await priorityPool.connect(signers[3]).deposit(toEther(3000), false, ['0x'])).wait()

  // Account 4

  await (await polToken.connect(signers[4]).approve(priorityPool.target, ethers.MaxUint256)).wait()
  await (await priorityPool.connect(signers[4]).deposit(toEther(4000), false, ['0x'])).wait()

  await (await fundFlowController.depositQueuedTokens([0], [toEther(357000)])).wait()
  await (
    await stakingPool.connect(signers[4]).approve(priorityPool.target, ethers.MaxUint256)
  ).wait()
  await (
    await stakingPool
      .connect(signers[4])
      .transferAndCall(
        priorityPool.target,
        toEther(1000),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, ['0x']])
      )
  ).wait()
  await (await priorityPool.deposit(toEther(300), false, ['0x'])).wait()

  // Reward Distribution

  await (await stakingPool.addFee(stPOLSDLRewardsPool.target, 1500)).wait()
  await (await stakingPool.addFee(accounts[0], 300)).wait()

  const vaults = await strategy.getVaults()
  await (await polToken.approve(stakeManagerAddress, ethers.MaxUint256)).wait()

  await (await validatorShare.addReward(vaults[0], toEther(2000))).wait()
  await (await stakingPool.updateStrategyRewards([0], '0x')).wait()

  await (await validatorShare.addReward(vaults[0], toEther(5000))).wait()
  await (await stakingPool.updateStrategyRewards([0], '0x')).wait()
}
