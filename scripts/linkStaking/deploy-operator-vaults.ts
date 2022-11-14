import { program } from 'commander'
import fs from 'fs'
import { ethers, upgrades, network } from 'hardhat'

async function main() {
  program.version('0.0.0').requiredOption('--vaults <numVaults>', 'input # of vaults to deploy')

  program.parse(process.argv)
  const opts = program.opts()

  const linkToken = await ethers.getContract('LinkToken')
  const OperatorVault = await ethers.getContractFactory('OperatorVault')
  const addresses = []

  for (let i = 0; i < opts.vaults; i++) {
    const vault = await upgrades.deployProxy(OperatorVault, [
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
