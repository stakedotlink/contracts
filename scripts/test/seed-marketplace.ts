// contracts/scripts/test/seed-marketplace.ts
import { ethers } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

const DEPLOYMENTS_PATH = path.resolve(__dirname, '../../deployments/localhost.json')
const BACKEND_URL = process.env.MARKETPLACE_API_URL || 'http://localhost:3001'
const CHAIN_ID = 1337

interface Deployments {
  [key: string]: { address: string }
}

function loadDeployments(): Deployments {
  return JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, 'utf-8'))
}

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
  throw new Error(`Backend health check at ${BACKEND_URL}/api/health timed out after ${timeoutMs}ms`)
}

async function discoverMintedTokenIds(
  provider: any,
  resdlAddress: string
): Promise<Record<string, string[]>> {
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

function orderToApiPayload(order: any) {
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
    chainId: CHAIN_ID,
  }
}

async function main() {
  const { Seaport } = await import('@opensea/seaport-js')
  const { ItemType } = await import('@opensea/seaport-js/lib/constants')

  const deployments = loadDeployments()
  const signers = await ethers.getSigners()
  const walletPrimary = signers[1]
  const walletBuyer = signers[2]
  const walletLister = signers[3]

  const seaportAddress = deployments.Seaport.address
  const resdlAddress = deployments.SDLPool.address
  const linkAddress = deployments.LINKToken.address
  const wethAddress = deployments.MockWETH.address

  console.log(`--- seed-marketplace (backend=${BACKEND_URL}) ---`)
  await waitForBackend()

  // Idempotency: if seed listings already exist for the lister, skip.
  try {
    const existing = await fetch(
      `${BACKEND_URL}/api/orders?offerer=${walletLister.address}&chainId=${CHAIN_ID}`
    ).then((r) => r.json())
    const count = Array.isArray((existing as any)?.data) ? (existing as any).data.length : 0
    if (count >= 2) {
      console.log(`Found ${count} existing listings — already seeded, skipping.`)
      return
    }
  } catch (e) {
    console.warn('Idempotency check failed, will attempt fresh seed:', (e as Error).message)
  }

  const byOwner = await discoverMintedTokenIds(ethers.provider, resdlAddress)
  const primaryTokenIds = byOwner[walletPrimary.address.toLowerCase()] || []
  const listerTokenIds = byOwner[walletLister.address.toLowerCase()] || []
  if (primaryTokenIds.length < 3 || listerTokenIds.length < 2) {
    throw new Error(
      `Expected ≥3 NFTs for primary and ≥2 for lister. Got primary=${JSON.stringify(
        primaryTokenIds
      )} lister=${JSON.stringify(listerTokenIds)}. Did setup-test-env run?`
    )
  }
  const listing1TokenId = listerTokenIds[0]
  const listing2TokenId = listerTokenIds[1]
  const offerTargetTokenId = primaryTokenIds[0]

  const seaportVersion = process.env.SEAPORT_VERSION || '1.5'
  const listerSeaport = new Seaport(walletLister as any, {
    overrides: { contractAddress: seaportAddress, seaportVersion } as any,
  })

  // setup-test-env's setup-link-staking advances the chain ~28 days via
  // time.increase(). Use block.timestamp (not Date.now) as the base so
  // orders aren't born already-expired relative to the chain clock.
  const latestBlock = await ethers.provider.getBlock('latest')
  const nowOnChain = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000)
  const endTime = nowOnChain + 7 * 24 * 3600

  console.log(`Listing 1: ${listing1TokenId} for 2 ETH`)
  const { executeAllActions: ex1 } = await listerSeaport.createOrder({
    offer: [{ itemType: ItemType.ERC721, token: resdlAddress, identifier: listing1TokenId }],
    consideration: [{ amount: ethers.parseEther('2').toString(), recipient: walletLister.address }],
    endTime,
  })
  const order1 = await ex1()
  const r1 = await postJson(`${BACKEND_URL}/api/orders`, orderToApiPayload(order1))
  if (!r1.success) throw new Error(`Listing 1 failed: ${JSON.stringify(r1)}`)
  console.log('Listing 1 created:', r1.data.orderHash)

  console.log(`Listing 2: ${listing2TokenId} for 1500 LINK`)
  const { executeAllActions: ex2 } = await listerSeaport.createOrder({
    offer: [{ itemType: ItemType.ERC721, token: resdlAddress, identifier: listing2TokenId }],
    consideration: [
      { token: linkAddress, amount: ethers.parseEther('1500').toString(), recipient: walletLister.address },
    ],
    endTime,
  })
  const order2 = await ex2()
  const r2 = await postJson(`${BACKEND_URL}/api/orders`, orderToApiPayload(order2))
  if (!r2.success) throw new Error(`Listing 2 failed: ${JSON.stringify(r2)}`)
  console.log('Listing 2 created:', r2.data.orderHash)

  console.log(`Offer: 0.5 WETH for primary's #${offerTargetTokenId}`)
  const buyerSeaport = new Seaport(walletBuyer as any, {
    overrides: { contractAddress: seaportAddress, seaportVersion } as any,
  })
  const { executeAllActions: ex3 } = await buyerSeaport.createOrder({
    offer: [{ token: wethAddress, amount: ethers.parseEther('0.5').toString() }],
    consideration: [
      {
        itemType: ItemType.ERC721,
        token: resdlAddress,
        identifier: offerTargetTokenId,
        recipient: walletBuyer.address,
      },
    ],
    endTime,
  })
  const order3 = await ex3()
  const order3Hash = buyerSeaport.getOrderHash(order3.parameters)
  const offerPayload = {
    orderHash: order3Hash,
    order: orderToApiPayload(order3).order,
    signature: order3.signature,
    tokenId: offerTargetTokenId,
    nftAddress: resdlAddress,
    chainId: CHAIN_ID,
  }
  const r3 = await postJson(`${BACKEND_URL}/api/offers`, offerPayload)
  if (!r3.success) throw new Error(`Offer failed: ${JSON.stringify(r3)}`)
  console.log('Offer created:', r3.data.orderHash)

  console.log('--- seed-marketplace complete ---')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
