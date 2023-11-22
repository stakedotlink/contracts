import { DistributionOracle } from '../../../typechain-types'
import { getContract } from '../../utils/deployment'

const jobId = ''
const fee = 0

async function main() {
  const distributionOracle = (await getContract(
    'LINK_PP_Distribution_Oracle'
  )) as DistributionOracle

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
