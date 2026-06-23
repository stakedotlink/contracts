import { deploy, getContract, updateDeployments } from '../../../utils/deployment'

// EspressoRewardsConsumer
const EspressoRewardsConsumerArgs = {
  forwarder: '0x0b93082D9b3C7C97fAcd250082899BAcf3af3885', // address of the authorized report forwarder
  // CRE workflow authorized to produce reward reports. Only reports whose Keystone metadata matches
  // both of these (owner + name) are accepted; everything else reverts with UnauthorizedWorkflow.
  // Verified against the live report metadata delivered to the current consumer (0xe69D92...).
  workflowOwner: '0x90510C6bAB8cc0f6C964c46970264Dbb8B7B2857', // CRE workflow owner
  workflowName: '0x39363364363236363730', // bytes10, UTF-8 "963d626670"
}

async function main() {
  if (
    EspressoRewardsConsumerArgs.workflowOwner === '0x0000000000000000000000000000000000000000' ||
    EspressoRewardsConsumerArgs.workflowName === '0x00000000000000000000'
  ) {
    throw new Error(
      'Set EspressoRewardsConsumerArgs.workflowOwner and workflowName to the real CRE workflow before deploying'
    )
  }

  const strategy = await getContract('ESP_EspressoStrategy')

  const consumer = await deploy('EspressoRewardsConsumer', [
    EspressoRewardsConsumerArgs.forwarder,
    strategy.target,
    EspressoRewardsConsumerArgs.workflowOwner,
    EspressoRewardsConsumerArgs.workflowName,
  ])
  console.log('ESP_EspressoRewardsConsumer deployed: ', consumer.target)

  updateDeployments(
    {
      ESP_EspressoRewardsConsumer: consumer.target,
    },
    {
      ESP_EspressoRewardsConsumer: 'EspressoRewardsConsumer',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
