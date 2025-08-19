import { ethers } from 'hardhat'
import { getContract } from '../../../utils/deployment'
import { getLedgerSigner } from '../../../utils/helpers'

async function main() {
  const ledgerSigner = await getLedgerSigner()
  const governanceTimelock = await getContract('GovernanceTimelock')
  const priorityPool = await getContract('POL_PriorityPool')
  const withdrawalPool = await getContract('POL_WithdrawalPool')
  const stakingPool = await getContract('POL_StakingPool')
  const rebaseController = await getContract('POL_RebaseController')
  const polygonStrategy = await getContract('POL_PolygonStrategy')
  const fundFlowController = await getContract('POL_PolygonFundFlowController')
  const lstRewardsSplitterController = await getContract('POL_LSTRewardsSplitterController')
  const lstRewardsSplitter = (
    await ethers.getContractAt('LSTRewardsSplitter', '0x69a7977C3d7fdBad8414048f150eaBEA33a39b76')
  ).connect(ledgerSigner)

  await (await priorityPool.transferOwnership(governanceTimelock.target)).wait()
  await (await withdrawalPool.transferOwnership(governanceTimelock.target)).wait()
  await (await stakingPool.transferOwnership(governanceTimelock.target)).wait()
  await (await rebaseController.transferOwnership(governanceTimelock.target)).wait()
  await (await polygonStrategy.transferOwnership(governanceTimelock.target)).wait()
  await (await fundFlowController.transferOwnership(governanceTimelock.target)).wait()
  await (await lstRewardsSplitterController.transferOwnership(governanceTimelock.target)).wait()
  await (await lstRewardsSplitter.transferOwnership(governanceTimelock.target)).wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
