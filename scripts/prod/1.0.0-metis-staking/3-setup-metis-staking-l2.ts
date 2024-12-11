import { L2Transmitter } from '../../../typechain-types/contracts/metisStaking/L2Transmitter'
import { getContract } from '../../utils/deployment'
import { switchNetwork } from '../../utils/helpers'

const l1Transmitter = ''

async function main() {
  await switchNetwork(1088, '')

  const l2Transmitter = (await getContract('METIS_L2Transmitter', true)) as L2Transmitter

  await (await l2Transmitter.setL1Transmitter(l1Transmitter)).wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
