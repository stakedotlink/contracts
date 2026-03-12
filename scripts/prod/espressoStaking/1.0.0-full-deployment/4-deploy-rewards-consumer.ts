import { deploy, getContract, updateDeployments } from '../../../utils/deployment'

// EspressoRewardsConsumer
const EspressoRewardsConsumerArgs = {
  forwarder: '0x0b93082D9b3C7C97fAcd250082899BAcf3af3885', // address of the authorized report forwarder
}

async function main() {
  const strategy = await getContract('ESP_EspressoStrategy')

  const consumer = await deploy('EspressoRewardsConsumer', [
    EspressoRewardsConsumerArgs.forwarder,
    strategy.target,
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
