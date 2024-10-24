import { printDeployments } from '../../utils/deployment'
import { setupCore } from './modules/setup-core'
import { setupLINKStaking } from './modules/setup-link-staking'
import { setupMETISStaking } from './modules/setup-metis-staking'
import { setupOther } from './modules/setup-other'

async function main() {
  await setupCore()
  await setupLINKStaking()
  await setupMETISStaking()
  await setupOther()

  printDeployments()
  console.log('setup-test-env-ready')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
