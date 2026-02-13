import { getContract } from '../../../utils/deployment'

const ccipCurveGaugeReceiver = '0x280516F160cC4f54C48bfD6B06033593B8EE5B35'

async function main() {
  const ccipCurveGaugeSender = await getContract('POL_CCIPCurveGaugeSender')

  await (await ccipCurveGaugeSender.setCCIPCurveGaugeReceiver(ccipCurveGaugeReceiver)).wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
