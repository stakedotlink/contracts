import { LiquidSDIndexPool } from '../../typechain-types'
import { deployUpgradeable, getContract, updateDeployments } from '../utils/deployment'

const compositionTargets = [7000, 3000] // basis point index composition targets [stETH,rETH]

async function main() {
  const ixETHIndexPool = (await getContract('ETH_LiquidSDIndex')) as LiquidSDIndexPool
  const stETHToken = (await getContract('LidoSTETHToken')) as LiquidSDIndexPool
  const rETHToken = (await getContract('ETH_LiquidSDIndex')) as LiquidSDIndexPool

  const lidoSTETHAdapter = await deployUpgradeable('LidoSTETHAdapter', [
    stETHToken.address,
    ixETHIndexPool.address,
  ])
  console.log('ixETH_LidoSTETHAdapter deployed: ', lidoSTETHAdapter.address)

  const rocketPoolRETHAdapter = await deployUpgradeable('RocketPoolRETHAdapter', [
    rETHToken.address,
    ixETHIndexPool.address,
  ])
  console.log('ixETH_RocketPoolRETHAdapter deployed: ', rocketPoolRETHAdapter.address)

  let tx = await ixETHIndexPool.addLSDToken(stETHToken.address, lidoSTETHAdapter.address, [10000])
  await tx.wait()
  console.log('LidoSTETHAdapter added to LiquidSDIndex')

  tx = await ixETHIndexPool.addLSDToken(
    rETHToken.address,
    rocketPoolRETHAdapter.address,
    compositionTargets
  )
  await tx.wait()
  console.log('RocketPoolRETHAdapter added to LiquidSDIndex')

  updateDeployments(
    {
      ixETH_LidoSTETHAdapter: lidoSTETHAdapter.address,
      ixETH_RocketPoolRETHAdapter: rocketPoolRETHAdapter.address,
    },
    {
      ixETH_LidoSTETHAdapter: 'LidoSTETHAdapter',
      ixETH_RocketPoolRETHAdapter: 'RocketPoolRETHAdapter',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
