import fs from 'fs'
import { deployCore } from './modules/deploy-core'
import { deployLINKStaking } from './modules/deploy-link-staking'
import { deployPOLStaking } from './modules/deploy-polygon-staking'
import { deployESPStaking } from './modules/deploy-espresso-staking'
import { deploySubgraphMockContracts } from './modules/deploy-subgraph-mocks'
import { deployDeprecated } from './modules/deploy-deprecated'
import { deployOther } from './modules/deploy-other'

const path = './deployments/localhost.json'

async function main() {
  if (fs.existsSync(path)) {
    fs.unlinkSync(path)
  }

  await deployDeprecated()
  await deployCore()
  await deployLINKStaking()
  await deployPOLStaking()
  await deployESPStaking()
  await deploySubgraphMockContracts()
  await deployOther()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
