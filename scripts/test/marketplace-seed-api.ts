/**
 * Phase 2 orchestrator — runs in the marketplace-seed container after the
 * marketplace-backend is healthy. Calls the API to create seed listings and
 * an offer, then waits for the subgraph to index, then prints the welcome
 * banner.
 */
import { seedViaApi } from './setup/modules/seed-marketplace'

seedViaApi()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
