import { updateDeployments, deploy, getContract } from '../../../utils/deployment'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

// LST Rewards Splitter Controller
const LSTRewardsSplitterControllerArgs = {
  rewardThreshold: 0, // min amount of rewards to trigger splitting
}

// LST Rewards Splitter
const LSTRewardsSplitterArgs = {
  fee: 9000, // 90% of rewards go back to staking pool
}

async function main() {
  const stakingPool = await getContract('POL_StakingPool')

  const splitter = await deploy('LSTRewardsSplitterController', [
    stakingPool.target,
    LSTRewardsSplitterControllerArgs.rewardThreshold,
  ])
  console.log('POL_LSTRewardsSplitterController deployed: ', splitter.target)

  updateDeployments(
    {
      POL_LSTRewardsSplitterController: splitter.target.toString(),
    },
    {
      POL_LSTRewardsSplitterController: 'LSTRewardsSplitterController',
    }
  )

  await (
    await splitter.addSplitter(multisigAddress, [[stakingPool.target, LSTRewardsSplitterArgs.fee]])
  ).wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
