import { SequencerVCS } from '../../../typechain-types'
import { getContract } from '../../utils/deployment'

// Sequencer Vault
const SequencerVaultArgs = {
  pubkey: '', // sequencer pubkey
  signer: '', // sequencer signer
  rewardsReceiver: '', // address authorized to claim operator rewards
}

async function main() {
  const sequencerVCS = (await getContract('SequencerVCS', true)) as SequencerVCS

  await (
    await sequencerVCS.addVault(
      SequencerVaultArgs.pubkey,
      SequencerVaultArgs.signer,
      SequencerVaultArgs.rewardsReceiver
    )
  ).wait()

  console.log('SequencerVault deployed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
