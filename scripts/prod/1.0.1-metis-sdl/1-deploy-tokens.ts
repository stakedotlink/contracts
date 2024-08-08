import { BurnMintERC677 } from '../../../typechain-types'
import { updateDeployments, deploy } from '../../utils/deployment'

// Deploy on Metis

// SDL
const sdlArgs = {
  name: 'stake.link',
  symbol: 'SDL',
  decimals: 18,
}

// wstLINK
const wstLINKArgs = {
  name: 'Wrapped stLINK',
  symbol: 'wstLINK',
  decimals: 18,
}

const owner = '0x43975fe745cB4171E15ceEd5d8D05A3502e0e87B'

async function main() {
  const sdl = await deploy('BurnMintERC677', [sdlArgs.name, sdlArgs.symbol, sdlArgs.decimals, 0])
  await (await sdl.transferOwnership(owner)).wait()
  console.log('SDLToken deployed: ', await sdl.getAddress())

  const wstLINK = (await deploy('BurnMintERC677', [
    wstLINKArgs.name,
    wstLINKArgs.symbol,
    wstLINKArgs.decimals,
    0,
  ])) as BurnMintERC677
  await (await wstLINK.transferOwnership(owner)).wait()
  console.log('wstLINKToken deployed: ', await wstLINK.getAddress())

  updateDeployments(
    {
      SDLToken: await sdl.getAddress(),
      LINK_WrappedSDToken: await wstLINK.getAddress(),
    },
    {
      SDLToken: 'BurnMintERC677',
      LINK_WrappedSDToken: 'BurnMintERC677',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
