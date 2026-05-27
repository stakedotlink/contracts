// contracts/scripts/test/setup/modules/setup-marketplace.ts
import { ethers } from 'hardhat'
import type { Signer } from 'ethers'
import * as fs from 'fs'
import * as path from 'path'

const DEPLOYMENTS_PATH = path.resolve(__dirname, '../../../../deployments/localhost.json')

const SECONDS_PER_DAY = 86_400
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY

interface Deployments {
  [key: string]: { address: string; artifact?: string }
}

function loadDeployments(): Deployments {
  return JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, 'utf-8'))
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
 * Marketplace on-chain seed. Runs inside setup-test-env after the staking
 * modules. Mints/distributes payment tokens, creates reSDL locks on a few
 * test wallets, and pre-approves Seaport for transfer.
 *
 * Wallet roles (indices into ethers.getSigners() = Setup A's 14 hardcoded keys):
 *   [0] deployer  — already used for all prior deploys/setup; not seeded here
 *   [1] primary   — primary tester; will own reSDL #1..#3
 *   [2] buyer     — places offers; pre-funded with USDC/WETH/LINK
 *   [3] lister    — pre-seeds 2 marketplace listings; will own reSDL #4..#5
 */
export async function setupMarketplace() {
  const deployments = loadDeployments()
  const signers = await ethers.getSigners()

  const deployer = signers[0]
  const walletPrimary = signers[1]
  const walletBuyer = signers[2]
  const walletLister = signers[3]

  console.log('--- setupMarketplace ---')
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

  console.log('Minting SDL...')
  await (await sdlToken.mint(walletPrimary.address, ethers.parseEther('50000'))).wait()
  await (await sdlToken.mint(walletLister.address, ethers.parseEther('25000'))).wait()

  console.log('Distributing LINK...')
  await (await linkToken.transfer(walletPrimary.address, ethers.parseEther('10000'))).wait()
  await (await linkToken.transfer(walletBuyer.address, ethers.parseEther('10000'))).wait()

  console.log('Minting USDC...')
  for (const w of [walletPrimary, walletBuyer]) {
    await (await mockUsdc.mint(w.address, 10_000_000_000n)).wait() // 10k USDC (6 decimals)
  }

  console.log('Depositing WETH...')
  for (const w of [walletPrimary, walletBuyer]) {
    await (await mockWeth.connect(w).deposit({ value: ethers.parseEther('10') })).wait()
  }

  console.log('Wallet 1 staking 3 locks...')
  await stakeForLock(
    sdlToken,
    sdlPoolAddress,
    walletPrimary,
    ethers.parseEther('10000'),
    SECONDS_PER_YEAR
  )
  await stakeForLock(
    sdlToken,
    sdlPoolAddress,
    walletPrimary,
    ethers.parseEther('20000'),
    4 * SECONDS_PER_YEAR
  )
  await stakeForLock(
    sdlToken,
    sdlPoolAddress,
    walletPrimary,
    ethers.parseEther('5000'),
    30 * SECONDS_PER_DAY
  )

  console.log('Wallet 3 staking 2 locks...')
  await stakeForLock(
    sdlToken,
    sdlPoolAddress,
    walletLister,
    ethers.parseEther('15000'),
    2 * SECONDS_PER_YEAR
  )
  await stakeForLock(
    sdlToken,
    sdlPoolAddress,
    walletLister,
    ethers.parseEther('8000'),
    180 * SECONDS_PER_DAY
  )

  console.log('Setting approvals...')
  const sdlPool = await ethers.getContractAt('SDLPool', sdlPoolAddress, deployer)
  await (
    await sdlPool.connect(walletPrimary).setApprovalForAll(deployments.Seaport.address, true)
  ).wait()
  await (
    await sdlPool.connect(walletLister).setApprovalForAll(deployments.Seaport.address, true)
  ).wait()

  const MAX = ethers.MaxUint256
  await (
    await (mockWeth.connect(walletBuyer) as any).approve(deployments.Seaport.address, MAX)
  ).wait()
  await (
    await (linkToken.connect(walletBuyer) as any).approve(deployments.Seaport.address, MAX)
  ).wait()
  await (
    await (mockUsdc.connect(walletBuyer) as any).approve(deployments.Seaport.address, MAX)
  ).wait()

  console.log('--- setupMarketplace complete ---')
}
