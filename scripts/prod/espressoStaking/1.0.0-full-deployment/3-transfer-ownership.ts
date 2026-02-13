import { getContract } from '../../../utils/deployment'

async function main() {
  const governanceTimelock = await getContract('GovernanceTimelock')
  const stakingPool = await getContract('ESP_StakingPool')
  const priorityPool = await getContract('ESP_PriorityPool')
  const rebaseController = await getContract('ESP_RebaseController')
  const withdrawalPool = await getContract('ESP_WithdrawalPool')
  const espressoStrategy = await getContract('ESP_EspressoStrategy')
  const fundFlowController = await getContract('ESP_EspressoFundFlowController')

  await (await stakingPool.transferOwnership(governanceTimelock.target)).wait()
  await (await priorityPool.transferOwnership(governanceTimelock.target)).wait()
  await (await rebaseController.transferOwnership(governanceTimelock.target)).wait()
  await (await withdrawalPool.transferOwnership(governanceTimelock.target)).wait()
  await (await espressoStrategy.transferOwnership(governanceTimelock.target)).wait()
  await (await fundFlowController.transferOwnership(governanceTimelock.target)).wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
