import { ethers } from 'hardhat'
import type { Signer, HDNodeWallet, Provider } from 'ethers'
import * as fs from 'fs'
import * as path from 'path'

const DEPLOYMENTS_PATH = path.resolve(__dirname, '../../../../deployments/localhost.json')
const SHARED_ADDRESSES_PATH = process.env.SHARED_ADDRESSES_PATH || '/shared/addresses.json'

const SECONDS_PER_DAY = 86_400
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY

const FOUNDRY_MNEMONIC = 'test test test test test test test test test test test junk'

interface Deployments {
  [key: string]: { address: string; artifact?: string }
}

// Used by seedOnChain() — reads the contracts repo's local deployments file
// (written by hardhat during deploy.ts in the same container).
function loadDeployments(): Deployments {
  return JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, 'utf-8'))
}

// Used by seedViaApi() — runs in a separate container that only has access to
// the shared addresses.json volume.
interface SharedAddresses {
  chainId: number
  rpcUrl: string
  seaportAddress: string
  conduitControllerAddress: string
  resdlContractAddress: string
  sdlTokenAddress: string
  linkTokenAddress: string
  wethAddress: string
  usdcAddress: string
}

function loadSharedAddresses(): SharedAddresses {
  if (!fs.existsSync(SHARED_ADDRESSES_PATH)) {
    throw new Error(
      `Missing ${SHARED_ADDRESSES_PATH}. Did contracts-bootstrap run first?`
    )
  }
  return JSON.parse(fs.readFileSync(SHARED_ADDRESSES_PATH, 'utf-8'))
}

/**
 * Derive a wallet from the foundry test mnemonic at the given derivation index.
 * Anvil uses the same mnemonic, so wallet at index i corresponds to anvil's
 * pre-funded account i (matching ethers.getSigners()[i]).
 */
function foundryWallet(index: number): HDNodeWallet {
  // ethers v6: HDNodeWallet.fromPhrase requires the path argument
  return ethers.HDNodeWallet.fromPhrase(
    FOUNDRY_MNEMONIC,
    undefined,
    `m/44'/60'/0'/0/${index}`
  )
}

async function stakeForLock(
  sdlToken: any,
  sdlPoolAddress: string,
  signer: Signer,
  amount: bigint,
  lockingDuration: number
) {
  // SDLPool.onTokenTransfer expects abi.encode(uint256 lockId, uint64 duration).
  // lockId = 0 means "create new lock".
  const calldata = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint64'],
    [0, lockingDuration]
  )
  const tx = await sdlToken
    .connect(signer)
    ['transferAndCall(address,uint256,bytes)'](sdlPoolAddress, amount, calldata)
  await tx.wait()
}

/**
 * Phase 1 of seeding: runs in the contracts-bootstrap container.
 * Only on-chain actions — no API calls. Mints SDL, creates reSDL locks on
 * test wallets, funds wallets with LINK/WETH/USDC, sets Seaport approvals.
 */
export async function seedOnChain() {
  const deployments = loadDeployments()
  const signers = await ethers.getSigners()

  // Use signers from the connected node (anvil's foundry-mnemonic accounts).
  const deployer = signers[0]
  const walletPrimary = signers[1] // primary tester — will own reSDL #1..#3
  const walletBuyer = signers[2]   // buyer — places offer
  const walletLister = signers[3]  // other lister — pre-seeds 2 listings

  console.log('--- seeding on-chain state ---')
  console.log('Deployer:', deployer.address)
  console.log('Primary:', walletPrimary.address)
  console.log('Buyer:', walletBuyer.address)
  console.log('Lister:', walletLister.address)

  const sdlToken = await ethers.getContractAt(
    'StakingAllowance',
    deployments.SDLToken.address,
    deployer
  )
  const sdlPoolAddress = deployments.SDLPool.address
  const linkToken = await ethers.getContractAt(
    'contracts/core/tokens/base/ERC677.sol:ERC677',
    deployments.LINKToken.address,
    deployer
  )
  const mockWeth = await ethers.getContractAt('MockWETH', deployments.MockWETH.address, deployer)
  const mockUsdc = await ethers.getContractAt('MockUSDC', deployments.MockUSDC.address, deployer)

  // 1. Mint SDL to wallets 1 and 3 (deployer is the owner)
  console.log('Minting SDL...')
  await (await sdlToken.mint(walletPrimary.address, ethers.parseEther('50000'))).wait()
  await (await sdlToken.mint(walletLister.address, ethers.parseEther('25000'))).wait()

  // 2. Distribute LINK to wallets 1 and 2 (deployer holds all LINK from genesis)
  console.log('Distributing LINK...')
  await (await linkToken.transfer(walletPrimary.address, ethers.parseEther('10000'))).wait()
  await (await linkToken.transfer(walletBuyer.address, ethers.parseEther('10000'))).wait()

  // 3. Mint USDC to wallets 1 and 2 (deployer is the owner)
  console.log('Minting USDC...')
  for (const w of [walletPrimary, walletBuyer]) {
    await (await mockUsdc.mint(w.address, 10_000_000_000n)).wait() // 10k USDC (6 decimals)
  }

  // 4. WETH: each wallet deposits 10 ETH for itself
  console.log('Depositing WETH...')
  for (const w of [walletPrimary, walletBuyer]) {
    await (await mockWeth.connect(w).deposit({ value: ethers.parseEther('10') })).wait()
  }

  // 5. Wallet 1: stake SDL three times for varied lock states
  console.log('Wallet 1 staking 3 locks...')
  await stakeForLock(sdlToken, sdlPoolAddress, walletPrimary, ethers.parseEther('10000'), SECONDS_PER_YEAR)
  await stakeForLock(sdlToken, sdlPoolAddress, walletPrimary, ethers.parseEther('20000'), 4 * SECONDS_PER_YEAR)
  await stakeForLock(sdlToken, sdlPoolAddress, walletPrimary, ethers.parseEther('5000'), 30 * SECONDS_PER_DAY)

  // 6. Wallet 3: stake SDL twice
  console.log('Wallet 3 staking 2 locks...')
  await stakeForLock(sdlToken, sdlPoolAddress, walletLister, ethers.parseEther('15000'), 2 * SECONDS_PER_YEAR)
  await stakeForLock(sdlToken, sdlPoolAddress, walletLister, ethers.parseEther('8000'), 180 * SECONDS_PER_DAY)

  // 7. Approvals
  console.log('Setting approvals...')
  const sdlPool = await ethers.getContractAt('SDLPool', sdlPoolAddress, deployer)
  await (await sdlPool.connect(walletPrimary).setApprovalForAll(deployments.Seaport.address, true)).wait()
  await (await sdlPool.connect(walletLister).setApprovalForAll(deployments.Seaport.address, true)).wait()

  // Buyer pre-approves Seaport (max) on the payment tokens it might use.
  const MAX = ethers.MaxUint256
  await (await (mockWeth.connect(walletBuyer) as any).approve(deployments.Seaport.address, MAX)).wait()
  await (await (linkToken.connect(walletBuyer) as any).approve(deployments.Seaport.address, MAX)).wait()
  await (await (mockUsdc.connect(walletBuyer) as any).approve(deployments.Seaport.address, MAX)).wait()

  console.log('--- on-chain seed complete ---')
}

// =============================================================================
// Phase 2: seedViaApi() — runs in marketplace-seed container AFTER backend is up
// =============================================================================

const BACKEND_URL = process.env.MARKETPLACE_API_URL || 'http://marketplace-backend:3001'
const GRAPH_STATUS_URL = process.env.GRAPH_STATUS_URL || 'http://graph-node:8030/graphql'

async function postJson(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${text}`)
  return JSON.parse(text)
}

async function waitForBackend(timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BACKEND_URL}/api/health`)
      if (r.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`Backend health check timed out after ${timeoutMs}ms`)
}

async function waitForSubgraphIndexed(timeoutMs = 60_000): Promise<void> {
  const query = `{ indexingStatuses { subgraph chains { latestBlock { number } chainHeadBlock { number } } } }`
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(GRAPH_STATUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const json = (await res.json()) as any
      const statuses = json?.data?.indexingStatuses || []
      const mp = statuses.find(
        (s: any) => s.subgraph?.includes('resdl-marketplace-localhost')
      )
      if (mp) {
        const chain = mp.chains[0]
        const head = parseInt(chain.chainHeadBlock?.number || '0')
        const latest = parseInt(chain.latestBlock?.number || '0')
        if (head > 0 && latest >= head) return
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`Subgraph indexing timed out after ${timeoutMs}ms`)
}

async function discoverMintedTokenIds(
  provider: Provider,
  resdlAddress: string
): Promise<Record<string, string[]>> {
  // SDLPool doesn't implement ERC721Enumerable, so we walk Transfer logs from
  // genesis to learn which tokenIds were minted to which addresses.
  const transferTopic = ethers.id('Transfer(address,address,uint256)')
  const zeroTopic = ethers.zeroPadValue('0x0000000000000000000000000000000000000000', 32)
  const logs = await provider.getLogs({
    address: resdlAddress,
    fromBlock: 0,
    toBlock: 'latest',
    topics: [transferTopic, zeroTopic],
  })
  const byTo: Record<string, string[]> = {}
  for (const log of logs) {
    const to = ethers.getAddress('0x' + log.topics[2].slice(26))
    const tokenId = BigInt(log.topics[3]).toString()
    ;(byTo[to.toLowerCase()] ||= []).push(tokenId)
  }
  return byTo
}

interface OrderApiPayload {
  order: {
    offerer: string
    zone: string
    offer: any[]
    consideration: any[]
    orderType: number
    startTime: string
    endTime: string
    zoneHash: string
    salt: string
    conduitKey: string
    counter: string
  }
  signature: string
  chainId: number
}

function orderToApiPayload(order: any): OrderApiPayload {
  return {
    order: {
      offerer: order.parameters.offerer,
      zone: order.parameters.zone,
      offer: order.parameters.offer,
      consideration: order.parameters.consideration,
      orderType: order.parameters.orderType,
      startTime: order.parameters.startTime.toString(),
      endTime: order.parameters.endTime.toString(),
      zoneHash: order.parameters.zoneHash,
      salt: order.parameters.salt,
      conduitKey: order.parameters.conduitKey,
      counter: order.parameters.counter?.toString() || '0',
    },
    signature: order.signature,
    chainId: 1337,
  }
}

function printWelcomeBanner(info: {
  primaryAddress: string
  primaryPrivateKey: string
  primaryTokenIds: string[]
  listing1TokenId: string
  listing2TokenId: string
}) {
  const lines = [
    '',
    '┌──────────────────────────────────────────────────────────────────┐',
    '│  Local marketplace ready! Open http://localhost:3006             │',
    '│                                                                  │',
    '│  In MetaMask: Add network → http://localhost:8545, chain 1337    │',
    '│  Import this private key to act as the primary tester:           │',
    `│  ${info.primaryPrivateKey}`.padEnd(67) + '│',
    `│  Address: ${info.primaryAddress}`.padEnd(67) + '│',
    '│                                                                  │',
    `│  Owns reSDL #${info.primaryTokenIds.join(', #')} (varied lock states)`.padEnd(67) + '│',
    `│  Pre-seeded listings: reSDL #${info.listing1TokenId} (2 ETH), reSDL #${info.listing2TokenId} (1500 LINK)`.padEnd(67) + '│',
    `│  Pre-seeded offer on your reSDL #${info.primaryTokenIds[0]}: 0.5 WETH from wallet 2`.padEnd(67) + '│',
    '└──────────────────────────────────────────────────────────────────┘',
    '',
  ]
  console.log(lines.join('\n'))
}

export async function seedViaApi() {
  // Lazy import — seaport-js is only needed in this phase.
  const { Seaport } = await import('@opensea/seaport-js')
  const { ItemType } = await import('@opensea/seaport-js/lib/constants')

  const addresses = loadSharedAddresses()
  const provider = ethers.provider

  // Derive wallets with explicit private keys (seaport-js needs to sign).
  const walletPrimary = foundryWallet(1).connect(provider)
  const walletBuyer = foundryWallet(2).connect(provider)
  const walletLister = foundryWallet(3).connect(provider)

  console.log('--- waiting for backend ---')
  await waitForBackend()

  // Idempotency: if seed listings already exist from a previous run, skip.
  console.log('--- checking for existing seed state ---')
  try {
    const existing = await fetch(
      `${BACKEND_URL}/api/orders?offerer=${walletLister.address}&chainId=1337`
    ).then((r) => r.json())
    const count = Array.isArray(existing?.data) ? existing.data.length : 0
    if (count >= 2) {
      console.log(`Found ${count} existing listings for lister — seed already applied, skipping.`)
      printWelcomeBanner({
        primaryAddress: walletPrimary.address,
        primaryPrivateKey: foundryWallet(1).privateKey,
        primaryTokenIds: ['1', '2', '3'],
        listing1TokenId: '4',
        listing2TokenId: '5',
      })
      return
    }
  } catch (e) {
    console.warn('Idempotency check failed, will attempt fresh seed:', (e as Error).message)
  }

  console.log('--- discovering minted reSDL tokenIds ---')
  const byOwner = await discoverMintedTokenIds(provider, addresses.resdlContractAddress)
  const primaryTokenIds = byOwner[walletPrimary.address.toLowerCase()] || []
  const listerTokenIds = byOwner[walletLister.address.toLowerCase()] || []
  if (primaryTokenIds.length < 3 || listerTokenIds.length < 2) {
    throw new Error(
      `Expected at least 3 NFTs for primary and 2 for lister. Got primary=${JSON.stringify(primaryTokenIds)} lister=${JSON.stringify(listerTokenIds)}`
    )
  }
  const listing1TokenId = listerTokenIds[0]
  const listing2TokenId = listerTokenIds[1]
  const offerTargetTokenId = primaryTokenIds[0]
  console.log(`Primary owns: ${primaryTokenIds.join(', ')}`)
  console.log(`Lister owns: ${listerTokenIds.join(', ')}`)

  console.log('--- creating listings via API ---')
  const seaportVersion = process.env.SEAPORT_VERSION
  const listerSeaport = new Seaport(walletLister as any, {
    overrides: {
      contractAddress: addresses.seaportAddress,
      ...(seaportVersion ? { seaportVersion } : {}),
    } as any,
  })

  // Listing 1: wallet 3 sells reSDL #listing1TokenId for 2 ETH
  const { executeAllActions: ex1 } = await listerSeaport.createOrder({
    offer: [
      {
        itemType: ItemType.ERC721,
        token: addresses.resdlContractAddress,
        identifier: listing1TokenId,
      },
    ],
    consideration: [
      {
        amount: ethers.parseEther('2').toString(),
        recipient: walletLister.address,
      },
    ],
    endTime: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, // 1 week
  })
  const order1 = await ex1()
  const r1 = await postJson(`${BACKEND_URL}/api/orders`, orderToApiPayload(order1))
  if (!r1.success) throw new Error(`Listing 1 failed: ${JSON.stringify(r1)}`)
  console.log('Listing 1 created:', r1.data.orderHash)

  // Listing 2: wallet 3 sells reSDL #listing2TokenId for 1500 LINK
  const { executeAllActions: ex2 } = await listerSeaport.createOrder({
    offer: [
      {
        itemType: ItemType.ERC721,
        token: addresses.resdlContractAddress,
        identifier: listing2TokenId,
      },
    ],
    consideration: [
      {
        token: addresses.linkTokenAddress,
        amount: ethers.parseEther('1500').toString(),
        recipient: walletLister.address,
      },
    ],
    endTime: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  })
  const order2 = await ex2()
  const r2 = await postJson(`${BACKEND_URL}/api/orders`, orderToApiPayload(order2))
  if (!r2.success) throw new Error(`Listing 2 failed: ${JSON.stringify(r2)}`)
  console.log('Listing 2 created:', r2.data.orderHash)

  // Offer: wallet 2 offers 0.5 WETH for wallet 1's reSDL #offerTargetTokenId
  const buyerSeaport = new Seaport(walletBuyer as any, {
    overrides: {
      contractAddress: addresses.seaportAddress,
      ...(seaportVersion ? { seaportVersion } : {}),
    } as any,
  })
  const { executeAllActions: ex3 } = await buyerSeaport.createOrder({
    offer: [
      {
        // Currency item — no itemType; seaport-js infers ERC20 from presence of token.
        token: addresses.wethAddress,
        amount: ethers.parseEther('0.5').toString(),
      },
    ],
    consideration: [
      {
        itemType: ItemType.ERC721,
        token: addresses.resdlContractAddress,
        identifier: offerTargetTokenId,
        recipient: walletBuyer.address,
      },
    ],
    endTime: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  })
  const order3 = await ex3()
  const order3Hash = buyerSeaport.getOrderHash(order3.parameters)
  // /api/offers has a different top-level shape than /api/orders:
  // it requires orderHash, order, signature, tokenId, nftAddress at the
  // top level (the NFT being requested as consideration).
  const offerPayload = {
    orderHash: order3Hash,
    order: orderToApiPayload(order3).order,
    signature: order3.signature,
    tokenId: offerTargetTokenId,
    nftAddress: addresses.resdlContractAddress,
    chainId: 1337,
  }
  const r3 = await postJson(`${BACKEND_URL}/api/offers`, offerPayload)
  if (!r3.success) throw new Error(`Offer failed: ${JSON.stringify(r3)}`)
  console.log('Offer created:', r3.data.orderHash)

  console.log('--- waiting for subgraph to catch up ---')
  try {
    await waitForSubgraphIndexed()
    console.log('Subgraph indexed.')
  } catch (e) {
    console.warn('Subgraph indexing check skipped:', (e as Error).message)
  }

  printWelcomeBanner({
    primaryAddress: walletPrimary.address,
    primaryPrivateKey: foundryWallet(1).privateKey,
    primaryTokenIds,
    listing1TokenId,
    listing2TokenId,
  })
}
