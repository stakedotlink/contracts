import { OperatorVCS } from '../../typechain-types'
import { getContract, upgradeProxy } from '../utils/deployment'

async function main() {
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS
  await upgradeProxy(operatorVCS.address, 'OperatorVCS')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
