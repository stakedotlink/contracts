/**
 * Phase 1 orchestrator — runs in the contracts-bootstrap container.
 *
 * 1. Runs the full existing deploy chain (deploy.ts) — deploys core + staking +
 *    marketplace contracts.
 * 2. Runs the on-chain seed (seedOnChain) — mints SDL, creates reSDL locks,
 *    funds wallets, sets Seaport approvals.
 * 3. Writes /shared/addresses.json so downstream services (backend, subgraph,
 *    seed-api) can read contract addresses + test wallet keys.
 */
import * as fs from 'fs'
import * as path from 'path'
import { ethers } from 'hardhat'
import { execSync } from 'child_process'
import { seedOnChain } from './setup/modules/seed-marketplace'

const SHARED_DIR = process.env.SHARED_DIR || '/shared'
const ADDRESSES_OUT = path.join(SHARED_DIR, 'addresses.json')
const DEPLOYMENTS_PATH = path.resolve(__dirname, '../../deployments/localhost.json')

const FOUNDRY_MNEMONIC = 'test test test test test test test test test test test junk'

function walletInfo(index: number) {
  const w = ethers.HDNodeWallet.fromPhrase(FOUNDRY_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`)
  return { address: w.address, privateKey: w.privateKey }
}

async function isAddressDeployed(addr: string): Promise<boolean> {
  try {
    const code = await ethers.provider.getCode(addr)
    return code !== '0x' && code.length > 2
  } catch {
    return false
  }
}

async function main() {
  // Idempotency: if addresses.json already exists AND the contracts it
  // points to are still deployed on the current chain (anvil), skip the
  // deploy + seed. Compose re-runs this one-shot on every `up`; without
  // this guard, contracts get redeployed at new addresses while the
  // marketplace-postgres still has listings pointing at the OLD ones.
  if (fs.existsSync(ADDRESSES_OUT)) {
    try {
      const existing = JSON.parse(fs.readFileSync(ADDRESSES_OUT, 'utf-8'))
      const seaportOk = await isAddressDeployed(existing.seaportAddress)
      const resdlOk = await isAddressDeployed(existing.resdlContractAddress)
      if (seaportOk && resdlOk) {
        console.log(
          '===== addresses.json present and contracts still live; skipping deploy/seed ====='
        )
        return
      }
      console.log('===== addresses.json present but contracts missing on chain; re-deploying =====')
    } catch (e) {
      console.warn('Failed to parse existing addresses.json, re-deploying:', (e as Error).message)
    }
  }

  console.log('===== Phase 1a: deploy =====')
  // Run deploy.ts as a child process to keep its existing `main` entrypoint
  // intact (it has its own process.exit). Inherit env so RPC_URL flows through.
  execSync('npx hardhat run scripts/test/deploy/deploy.ts --network localhost', {
    cwd: path.resolve(__dirname, '../..'),
    stdio: 'inherit',
    env: process.env,
  })

  console.log('===== Phase 1b: on-chain seed =====')
  await seedOnChain()

  console.log('===== Phase 1c: write addresses.json =====')
  fs.mkdirSync(SHARED_DIR, { recursive: true })
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, 'utf-8'))
  const deployerAddress = await (await ethers.getSigners())[0].getAddress()
  const out = {
    chainId: 1337,
    rpcUrl: process.env.RPC_URL_DOCKER || process.env.RPC_URL || 'http://anvil:8545',
    seaportAddress: dep.Seaport.address,
    conduitControllerAddress: dep.ConduitController.address,
    resdlContractAddress: dep.SDLPool.address,
    sdlTokenAddress: dep.SDLToken.address,
    linkTokenAddress: dep.LINKToken.address,
    wethAddress: dep.MockWETH.address,
    usdcAddress: dep.MockUSDC.address,
    multicall3Address: dep.Multicall3?.address,
    deployerAddress,
    testWallets: Array.from({ length: 10 }, (_, i) => walletInfo(i)),
  }
  fs.writeFileSync(ADDRESSES_OUT, JSON.stringify(out, null, 2))
  console.log('Wrote', ADDRESSES_OUT)
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
