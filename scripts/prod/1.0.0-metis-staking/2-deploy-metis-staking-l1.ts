import {
  updateDeployments,
  getContract,
  deployUpgradeable,
  deploy,
  deployImplementation,
} from '../../utils/deployment'
import { L1Strategy } from '../../../typechain-types/contracts/metisStaking/L1Strategy'
import { toEther } from '../../utils/helpers'
import { ethers } from 'hardhat'

const l2Transmitter = '0xc4bAf9Df7Da0dB146D8AeDEe447246ed47b4c2E4'

// wstMETIS
const wstMETISArgs = {
  name: 'Wrapped stMETIS', // wrapped token name
  symbol: 'wstMETIS', // wrapped token symbol
  decimals: 18, // wrapped token decimals
}
// L1Strategy
const L1StrategyArgs = {
  lockingInfo: '0x0fe382b74C3894B65c10E5C12ae60Bbd8FAf5b48', // address of Metis locking info contract
  minRewardsToClaim: toEther(500), // min amount of rewards required to relock/claim in vaults on a call to updateDeposits
  operatorRewardPercentage: 600, // basis point amount of an operator's earned rewards that they receive
}
// L1Transmitter
const L1TransmitterArgs = {
  depositController: '0x43975fe745cB4171E15ceEd5d8D05A3502e0e87B', // address authorized to deposit queued tokens
  l1StandardBridge: '0x3980c9ed79d2c191A89E02Fa3529C60eD6e9c04b', // address of the L1 standard bridge
  l1StandardBridgeGasOracle: '0x7f6B0b7589febc40419a8646EFf9801b87397063', // address of MVM_DiscountOracle
  l2ChainId: '1088', // chain id of L2
  l2MetisToken: '0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000', // address of METIS token on L2
  minWithdrawalThreshold: toEther(200), // must exceed this amount of withdrawable tokens to withdraw to L2
  ccipRouter: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D', // address of CCIP router
  l2ChainSelector: '8805746078405598895', // CCIP chain selector for L2
  extraArgs:
    '0x97a657c9' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [500000]).slice(2), // extra args for CCIP messaging
}

async function main() {
  const metisToken = await getContract('METISToken')
  const sdlPool = await getContract('SDLPool')

  const wrappedSDToken = await deploy(
    'BurnMintERC677',
    [wstMETISArgs.name, wstMETISArgs.symbol, wstMETISArgs.decimals, 0],
    true
  )
  console.log('METIS_WrappedSDToken deployed: ', wrappedSDToken.target)

  const vaultImpAddress = (await deployImplementation('SequencerVault', true)) as string
  console.log('SequencerVault implementation deployed: ', vaultImpAddress)

  const l1Strategy = (await deployUpgradeable(
    'L1Strategy',
    [
      metisToken.target,
      L1StrategyArgs.lockingInfo,
      vaultImpAddress,
      l2Transmitter,
      L1StrategyArgs.minRewardsToClaim,
      L1StrategyArgs.operatorRewardPercentage,
    ],
    true
  )) as L1Strategy
  console.log('METIS_L1Strategy deployed: ', l1Strategy.target)

  const l1Transmitter = await deployUpgradeable(
    'L1Transmitter',
    [
      metisToken.target,
      L1TransmitterArgs.depositController,
      l1Strategy.target,
      L1TransmitterArgs.l1StandardBridge,
      L1TransmitterArgs.l1StandardBridgeGasOracle,
      l2Transmitter,
      L1TransmitterArgs.l2ChainId,
      L1TransmitterArgs.l2MetisToken,
      L1TransmitterArgs.minWithdrawalThreshold,
      L1TransmitterArgs.ccipRouter,
      L1TransmitterArgs.l2ChainSelector,
      L1TransmitterArgs.extraArgs,
    ],
    true
  )
  console.log('METIS_L1Transmitter deployed: ', l1Transmitter.target)

  const wstMetisSDLRewardsPool = await deploy('RewardsPool', [
    sdlPool.target,
    wrappedSDToken.target,
  ])
  console.log('wstMetis_SDLRewardsPool deployed: ', wstMetisSDLRewardsPool.target)

  await (await l1Strategy.setL1Transmitter(l1Transmitter.target)).wait()

  updateDeployments(
    {
      METIS_L1Strategy: l1Strategy.target.toString(),
      METIS_L1Transmitter: l1Transmitter.target,
      wstMETIS_SDLRewardsPool: wstMetisSDLRewardsPool.target,
      METIS_WrappedSDToken: wrappedSDToken.target,
    },
    {
      METIS_L1Strategy: 'L1Strategy',
      METIS_L1Transmitter: 'L1Transmitter',
      wstMETIS_SDLRewardsPool: 'RewardsPool',
      METIS_WrappedSDToken: 'WrappedSDToken',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
