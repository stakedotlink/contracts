import fs from 'fs'
import { ethers, network } from 'hardhat'
import { ERC677 } from '../../typechain-types'
import { deployUpgradeable, getContract } from '../utils/deployment'

async function main() {
  const linkToken = (await getContract('LINKToken')) as ERC677
  const addresses = []

  for (let i = 0; i < 10; i++) {
    const vault = await deployUpgradeable('OperatorVaultV0', [
      linkToken.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
    ])
    addresses.push(vault.address)
  }

  fs.writeFileSync(
    `scripts/linkStrategies/deployedOpVaults.${network.name}.json`,
    JSON.stringify(addresses, null, 1)
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
