import { DistributionOracle } from '../../../typechain-types'
import { getContract } from '../../utils/deployment'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const jobId = ''
const fee = 0

async function main() {
  const distributionOracle = (await getContract(
    'LINK_PP_Distribution_Oracle'
  )) as DistributionOracle

  await (
    await distributionOracle.setChainlinkParams('0x' + Buffer.from(jobId).toString('hex'), fee)
  ).wait()
  await (await distributionOracle.transferOwnership(multisigAddress)).wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
