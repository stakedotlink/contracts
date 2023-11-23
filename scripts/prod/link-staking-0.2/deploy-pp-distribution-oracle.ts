import { DistributionOracle } from '../../../typechain-types'
import { deploy, getContract, updateDeployments } from '../../utils/deployment'
import { toEther } from '../../utils/helpers'
import { ethers } from 'ethers'

const clOracle = '0x1152c76A0B3acC9856B1d8ee9EbDf2A2d0a01cC3'
const minTimeBetweenUpdates = 86400 // 1 day
const minDepositsSinceLastUpdate = toEther(1000)
const minBlockConfirmations = 75 // 15min with avg block time of 12 seconds

async function main() {
  const linkToken = await getContract('LINKToken')
  const priorityPool = await getContract('LINK_PriorityPool')

  const distributionOracle = (await deploy('DistributionOracle', [
    linkToken.address,
    clOracle,
    ethers.constants.HashZero,
    0,
    minTimeBetweenUpdates,
    minDepositsSinceLastUpdate,
    minBlockConfirmations,
    priorityPool.address,
  ])) as DistributionOracle
  console.log('DistributionOracle deployed: ', distributionOracle.address)

  updateDeployments(
    { LINK_PP_DistributionOracle: distributionOracle.address },
    { LINK_PP_DistributionOracle: 'DistributionOracle' }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
