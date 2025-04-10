import { updateDeployments, getContract, deploy } from '../../../utils/deployment'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const curveStableSwapNG = '0x7E13876B92F1a62C599C231f783f682E96B91761'
const liquidityGaugeV6 = '0x985ca600257BFc1adC2b630B8A7E2110b834A20e'
const rewardsDistributor = '0x11187eff852069a33d102476b2E8A9cc9167dAde'
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

  await (await gaugeDistributor.transferOwnership(multisigAddress)).wait()

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
