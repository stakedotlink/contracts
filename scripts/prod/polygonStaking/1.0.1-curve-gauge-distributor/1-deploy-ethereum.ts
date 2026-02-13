import { ethers } from 'hardhat'
import { updateDeployments, getContract, deploy } from '../../../utils/deployment'

const ccipRouter = '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D'
const linkToken = '0x514910771AF9Ca656af840dff83E8264EcF986CA'
const destinationChainSelector = 4051577828743386545n
const extraArgs = `0x97a657c9${ethers.AbiCoder.defaultAbiCoder()
  .encode(['uint256'], [500000])
  .slice(2)}`

const rewardsSender = '0x43975fe745cB4171E15ceEd5d8D05A3502e0e87B'

async function main() {
  const stakingPool = await getContract('POL_StakingPool')
  const wstPOL = await getContract('POL_WrappedSDToken')

  const ccipCurveGaugeSender = await deploy('CCIPCurveGaugeSender', [
    stakingPool.target,
    wstPOL.target,
    ccipRouter,
    linkToken,
    destinationChainSelector,
    extraArgs,
    rewardsSender,
  ])
  console.log('POL_CCIPCurveGaugeSender deployed: ', ccipCurveGaugeSender.target)

  updateDeployments(
    {
      POL_CCIPCurveGaugeSender: ccipCurveGaugeSender.target,
    },
    {
      POL_CCIPCurveGaugeSender: 'CCIPCurveGaugeSender',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
