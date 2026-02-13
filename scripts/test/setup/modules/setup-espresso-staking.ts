import { getAccounts, toEther, setupToken } from '../../../utils/helpers'
import { getContract } from '../../../utils/deployment'
import {
  StakingPool,
  PriorityPool,
  ERC20,
  EspressoStrategy,
  EspressoFundFlowController,
  EspressoStakingMock,
} from '../../../../typechain-types'
import { ethers } from 'hardhat'

/*
Accounts:
0 - main account that holds most of the tokens
1 - holds ESP
2 - holds ESP + has unclaimed stESPRESSO rewards
3 - holds ESP + stESPRESSO + has unclaimed stESPRESSO rewards
4 - holds ESP + stESPRESSO + has withdrawable ESP + has unclaimed stESPRESSO rewards
*/

export async function setupESPStaking() {
  const { signers, accounts } = await getAccounts()
  const espressoToken = (await getContract('ESPToken')) as ERC20
  const stakingPool = (await getContract('ESP_StakingPool')) as StakingPool
  const priorityPool = (await getContract('ESP_PriorityPool')) as PriorityPool
  const strategy = (await getContract('ESP_EspressoStrategy')) as EspressoStrategy
  const fundFlowController = (await getContract(
    'ESP_EspressoFundFlowController'
  )) as EspressoFundFlowController
  const stEspressoSDLRewardsPool = await getContract('stESP_SDLRewardsPool')
  const espressoStaking = (await getContract('EspressoStakingMock')) as EspressoStakingMock
  const espressoRewards = await getContract('EspressoRewardsMock')

  // Staking Setup

  await setupToken(espressoToken, accounts)

  // Register validators and add vaults
  const validators = [accounts[5], accounts[6], accounts[7]]
  for (const validator of validators) {
    await (await espressoStaking.registerValidator(validator)).wait()
    await (await strategy.addVault(validator)).wait()
  }

  // Fund the rewards contract
  await (await espressoToken.transfer(espressoRewards.target, toEther(100000))).wait()

  await (await espressoToken.approve(priorityPool.target, ethers.MaxUint256)).wait()
  await (await priorityPool.deposit(toEther(200000), false, ['0x'])).wait()
  await (await espressoToken.transfer(strategy.target, toEther(150000))).wait()
  await (await stakingPool.updateStrategyRewards([0], '0x')).wait()
  await (await stakingPool.approve(priorityPool.target, toEther(500))).wait()
  await (
    await stakingPool.transferAndCall(
      priorityPool.target,
      toEther(500),
      ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, ['0x']])
    )
  ).wait()

  // Account 3

  await (
    await espressoToken.connect(signers[3]).approve(priorityPool.target, ethers.MaxUint256)
  ).wait()
  await (await priorityPool.connect(signers[3]).deposit(toEther(3500), false, ['0x'])).wait()

  // Account 4

  await (
    await espressoToken.connect(signers[4]).approve(priorityPool.target, ethers.MaxUint256)
  ).wait()
  await (await priorityPool.connect(signers[4]).deposit(toEther(4000), false, ['0x'])).wait()

  await (
    await fundFlowController.depositQueuedTokens(
      [0, 1, 2],
      [toEther(119000), toEther(119000), toEther(119000)]
    )
  ).wait()
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

  await (await stakingPool.addFee(stEspressoSDLRewardsPool.target, 1500)).wait()
  await (await stakingPool.addFee(accounts[0], 300)).wait()

  const vaults = await strategy.getVaults()

  // Simulate rewards for vaults
  await (await espressoToken.transfer(vaults[0], toEther(2000))).wait()
  await (await strategy.updateLifetimeRewards([0], [toEther(2000)])).wait()
  await (await stakingPool.updateStrategyRewards([0], '0x')).wait()

  await (await espressoToken.transfer(vaults[0], toEther(5000))).wait()
  await (await strategy.updateLifetimeRewards([0], [toEther(7000)])).wait()
  await (await stakingPool.updateStrategyRewards([0], '0x')).wait()
}
