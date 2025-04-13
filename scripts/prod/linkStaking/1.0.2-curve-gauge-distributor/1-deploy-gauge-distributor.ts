import { updateDeployments, getContract, deploy } from '../../../utils/deployment'

const multisigTimelockAddress = '0xb72d8F5213b3E52FAf13Aa074b03C4788e78349F'

const curveStableSwapNG = '0x7E13876B92F1a62C599C231f783f682E96B91761'
const liquidityGaugeV6 = '0x985ca600257BFc1adC2b630B8A7E2110b834A20e'
const rewardsDistributor = '0xf5c08D55a77063ac4E5E18F1a470804088BE1ad4'
const minTimeBetweenDistributions = 86400 * 7

async function main() {
  const stakingPool = await getContract('LINK_StakingPool')

  const gaugeDistributor = await deploy('CurveGaugeDistributor', [
    stakingPool.target,
    curveStableSwapNG,
    liquidityGaugeV6,
    rewardsDistributor,
    minTimeBetweenDistributions,
  ])
  console.log('LINK_GaugeDistributor deployed: ', gaugeDistributor.target)

  await (await gaugeDistributor.transferOwnership(multisigTimelockAddress)).wait()

  updateDeployments(
    {
      LINK_CurveGaugeDistributor: gaugeDistributor.target,
    },
    {
      LINK_CurveGaugeDistributor: 'CurveGaugeDistributor',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
