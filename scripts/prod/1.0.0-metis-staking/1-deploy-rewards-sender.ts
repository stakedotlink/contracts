import { ethers } from 'hardhat'
import { updateDeployments, getContract, deployUpgradeable } from '../../utils/deployment'

// Deploy on Metis

// Sequencer Rewards CCIP Sender
const RewardsSenderArgs = {
  router: ethers.constants.AddressZero, // address of CCIP router on Metis
  transferInitiator: ethers.constants.AddressZero, // address authorized to initiate rewards transfers
  destinationChainSelector: '5009297550715157269', // ETH mainnet CCIP ID
  extraArgs: '0x', // extra args for reward token CCIP transfer
}

async function main() {
  const metisToken = await getContract('METISToken')

  const rewardsSender = await deployUpgradeable('SequencerRewardsCCIPSender', [
    RewardsSenderArgs.router,
    ethers.constants.AddressZero,
    metisToken.address,
    RewardsSenderArgs.transferInitiator,
    RewardsSenderArgs.destinationChainSelector,
    RewardsSenderArgs.extraArgs,
  ])
  console.log('METIS_SequencerRewardsCCIPSender deployed: ', rewardsSender.address)

  updateDeployments(
    {
      METIS_SequencerRewardsCCIPSender: rewardsSender.address,
    },
    {
      METIS_SequencerRewardsCCIPSender: 'SequencerRewardsCCIPSender',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
