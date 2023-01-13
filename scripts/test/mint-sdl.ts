import { getAccounts, toEther } from '../utils/helpers'
import { getContract } from '../utils/deployment'

async function main() {
  const { accounts } = await getAccounts()

  const sdlToken = (await getContract('SDLToken')) as any
  await sdlToken.mint(accounts[0], toEther(100000))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
