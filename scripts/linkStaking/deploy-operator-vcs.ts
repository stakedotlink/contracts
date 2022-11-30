import { ethers, network } from 'hardhat'
import fs from 'fs'
import { config } from '../../config/deploy'
import { ERC677, OperatorVaultV0, OperatorVCS, StakingPool } from '../../typechain-types'
import { deployUpgradeable, deployImplementation } from '../utils/helpers'
import { Interface } from 'ethers/lib/utils'

async function main() {
  const { OperatorVCS } = config

  const linkToken = (await ethers.getContract('LinkToken')) as ERC677
  const stakingPool = (await ethers.getContract('LINK_StakingPool')) as StakingPool
  const vaultInterface = (await ethers.getContractFactory('OperatorVault')).interface as Interface

  const initialVaults = JSON.parse(
    fs.readFileSync(`scripts/linkStaking/deployedOpVaults.${network.name}.json`, {
      encoding: 'utf8',
    })
  )

  if (initialVaults.length != OperatorVCS.vaultOperatorAddresses.length) {
    throw Error('The # of vault operator addresses must equal the # of deployed operator vaults')
  }

  const vaultImpAddress = (await deployImplementation('OperatorVault')) as string

  console.log('OperatorVault implementation deployed at: ', vaultImpAddress)

  const operatorVCS = (await deployUpgradeable('OperatorVCS', [
    linkToken.address,
    stakingPool.address,
    OperatorVCS.stakeController,
    vaultImpAddress,
    OperatorVCS.minDepositThreshold,
    OperatorVCS.fees,
    initialVaults,
  ])) as OperatorVCS
  await operatorVCS.deployed()

  console.log('OperatorVCS deployed at: ', operatorVCS.address)

  let tx = await stakingPool.addStrategy(operatorVCS.address)
  await tx.wait()

  console.log('OperatorVCS added to StakingPool')

  for (let i = 0; i < initialVaults.length; i++) {
    let vault = (await ethers.getContractAt('OperatorVaultV0', initialVaults[i])) as OperatorVaultV0
    tx = await vault.upgradeToAndCall(
      vaultImpAddress,
      vaultInterface.encodeFunctionData('initialize(address,address,address,address)', [
        linkToken.address,
        operatorVCS.address,
        OperatorVCS.stakeController,
        OperatorVCS.vaultOperatorAddresses[i],
      ])
    )
    await tx.wait()
    tx = await vault.transferOwnership(operatorVCS.address)
    await tx.wait()
  }

  console.log('All OperatorVaults have been upgraded from V0 to V1')
  console.log('All OperatorVaults have transferred ownership to OperatorVCS')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
