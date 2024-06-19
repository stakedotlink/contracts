import { ethers } from 'hardhat'
import { updateDeployments, getContract, deployUpgradeable, deploy } from '../../utils/deployment'

// Deploy on Metis

// wstMETIS
const wstMETIS = {
  name: 'Wrapped stMETIS',
  symbol: 'wstMETIS',
  decimals: 18,
}

// Sequencer Rewards CCIP Sender
const RewardsSenderArgs = {
  router: ethers.constants.AddressZero, // address of CCIP router on Metis
  transferInitiator: ethers.constants.AddressZero, // address authorized to initiate rewards transfers
  destinationChainSelector: '5009297550715157269', // ETH mainnet CCIP ID
  extraArgs: '0x', // extra args for reward token CCIP transfer
}

async function main() {
  const metisToken = await getContract('METISToken')

  const rewardsSender = await deployUpgradeable(
    'SequencerRewardsCCIPSender',
    [
      RewardsSenderArgs.router,
      ethers.constants.AddressZero,
      metisToken.address,
      RewardsSenderArgs.transferInitiator,
      RewardsSenderArgs.destinationChainSelector,
      RewardsSenderArgs.extraArgs,
    ],
    true
  )
  console.log('METIS_SequencerRewardsCCIPSender deployed: ', rewardsSender.address)

  const wrappedSDToken = await deploy(
    'BurnMintERC677',
    [wstMETIS.name, wstMETIS.symbol, wstMETIS.decimals, 0],
    true
  )
  console.log('METIS_WrappedSDToken deployed: ', wrappedSDToken.address)

  updateDeployments(
    {
      METIS_SequencerRewardsCCIPSender: rewardsSender.address,
      METIS_WrappedSDToken: wrappedSDToken.address,
    },
    {
      METIS_SequencerRewardsCCIPSender: 'SequencerRewardsCCIPSender',
      METIS_wrappedSDToken: 'BurnMintERC677',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
