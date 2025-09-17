import { ethers } from 'hardhat'
import { updateDeployments, getContract, deploy } from '../../../utils/deployment'

const CurveGaugeDistributorArgs = {
  curvePool: '0xD5D603EAA0F4696A2F55bd0850c00E6D4a248b9d',
  liquidityGauge: '0x516C72acD658b46e3A6980906582aDF266F77aa8',
  rewardsDistributor: ethers.ZeroAddress,
  epochDuration: 86400 * 7, // 1 week
  poolTokenIndex: 0,
}

const CurveGaugeReceiverArgs = {
  ccipRouter: '0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe',
  sourceChainSelector: 5009297550715157269n,
  ccipCurveGaugeSender: '0x949545A9d400cDc177C2fEc7f896F2Eb35Ed640D',
}

async function main() {
  const wstPOL = await getContract('POL_WrappedSDToken')

  const curveGaugeDistributor = await deploy('CurveGaugeDistributor', [
    wstPOL.target,
    CurveGaugeDistributorArgs.curvePool,
    CurveGaugeDistributorArgs.liquidityGauge,
    CurveGaugeDistributorArgs.rewardsDistributor,
    CurveGaugeDistributorArgs.epochDuration,
    CurveGaugeDistributorArgs.poolTokenIndex,
  ])
  console.log('POL_CurveGaugeDistributor deployed: ', curveGaugeDistributor.target)

  const ccipCurveGaugeReceiver = await deploy('CCIPCurveGaugeReceiver', [
    wstPOL.target,
    curveGaugeDistributor.target,
    CurveGaugeReceiverArgs.ccipRouter,
    CurveGaugeReceiverArgs.sourceChainSelector,
    CurveGaugeReceiverArgs.ccipCurveGaugeSender,
  ])
  console.log('POL_CCIPCurveGaugeReceiver deployed: ', ccipCurveGaugeReceiver.target)

  await (await curveGaugeDistributor.setRewardsDistributor(ccipCurveGaugeReceiver.target)).wait()

  updateDeployments(
    {
      POL_CurveGaugeDistributor: curveGaugeDistributor.target,
      POL_CCIPCurveGaugeReceiver: ccipCurveGaugeReceiver.target,
    },
    {
      POL_CurveGaugeDistributor: 'CurveGaugeDistributor',
      POL_CCIPCurveGaugeReceiver: 'CCIPCurveGaugeReceiver',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
