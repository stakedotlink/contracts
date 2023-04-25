import { LiquidSDIndexPool } from '../../typechain-types'
import { deployUpgradeable, getContract, updateDeployments } from '../utils/deployment'

// Tokens
const stETHToken = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84'
const rETHToken = '0xae78736cd615f374d3085123a210448e74fc6393'

const compositionTargets = [7500, 2500] // basis point index composition targets [stETH,rETH]

async function main() {
  const ixETHIndexPool = (await getContract('ETH_LiquidSDIndexPool')) as LiquidSDIndexPool

  const lidoAdapter = await deployUpgradeable('LidoLSDIndexAdapter', [
    stETHToken,
    ixETHIndexPool.address,
  ])
  console.log('ixETH_LidoLSDIndexAdapter deployed: ', lidoAdapter.address)

  const rocketPoolAdapter = await deployUpgradeable('RocketPoolLSDIndexAdapter', [
    rETHToken,
    ixETHIndexPool.address,
  ])
  console.log('ixETH_RocketPoolLSDIndexAdapter deployed: ', rocketPoolAdapter.address)

  let tx = await ixETHIndexPool.addLSDToken(stETHToken, lidoAdapter.address, [10000])
  await tx.wait()
  console.log('LidoLSDIndexAdapter added to ETH_LiquidSDIndexPool')

  tx = await ixETHIndexPool.addLSDToken(rETHToken, rocketPoolAdapter.address, compositionTargets)
  await tx.wait()
  console.log('RocketPoolLSDIndexAdapter added to ETH_LiquidSDIndexPool')

  updateDeployments(
    {
      ixETH_LidoLSDIndexAdapter: lidoAdapter.address,
      ixETH_RocketPoolLSDIndexAdapter: rocketPoolAdapter.address,
    },
    {
      ixETH_LidoLSDIndexAdapter: 'LidoLSDIndexAdapter',
      ixETH_RocketPoolLSDIndexAdapter: 'RocketPoolLSDIndexAdapter',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
