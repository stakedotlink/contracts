import fs from 'fs'
import { ethers, network } from 'hardhat'
import { ERC677 } from '../../typechain-types'
import { deployUpgradeable } from '../utils/helpers'

async function main() {
  const linkToken = (await ethers.getContract('LinkToken')) as ERC677
  const addresses = []

  for (let i = 0; i < 10; i++) {
    const vault = await deployUpgradeable('OperatorVaultV0', [
      linkToken.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
    ])
    await vault.deployed()
    addresses.push(vault.address)
  }

  fs.writeFileSync(
    `scripts/linkStaking/deployedOpVaults.${network.name}.json`,
    JSON.stringify(addresses, null, 1)
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
