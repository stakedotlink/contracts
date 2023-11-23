import { DistributionOracle } from '../../../typechain-types'
import { getContract } from '../../utils/deployment'

const jobId = 'fc3f1cdefbca4d8786cddc954078df9c'
const fee = 0

async function main() {
  const distributionOracle = (await getContract('LINK_PP_DistributionOracle')) as DistributionOracle

  await (
    await distributionOracle.setChainlinkParams('0x' + Buffer.from(jobId).toString('hex'), fee)
  ).wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
