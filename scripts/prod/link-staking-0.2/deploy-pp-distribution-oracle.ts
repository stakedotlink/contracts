import { DistributionOracle } from '../../../typechain-types'
import { deploy, getContract, updateDeployments } from '../../utils/deployment'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const clOracle = ''
const jobId = ''
const fee = 0
const minTimeBetweenUpdates = 0
const minDepositsSinceLastUpdate = 0
const minBlockConfirmations = 0

async function main() {
  const linkToken = await getContract('LINKToken')
  const priorityPool = await getContract('LINK_PriorityPool')

  const distributionOracle = (await deploy('DistributionOracle', [
    linkToken.address,
    clOracle,
    jobId,
    fee,
    minTimeBetweenUpdates,
    minDepositsSinceLastUpdate,
    minBlockConfirmations,
    priorityPool.address,
  ])) as DistributionOracle
  console.log('DistributionOracle deployed: ', distributionOracle.address)

  let tx = await distributionOracle.transferOwnership(multisigAddress)
  await tx.wait()

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
