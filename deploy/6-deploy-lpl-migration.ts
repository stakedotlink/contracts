import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { LPLMigration } = config

  const lplToken = await ethers.getContract('OwnersToken')
  const sdlToken = await ethers.getContract('StakingAllowance')

  const lplMigration = await deploy('LPLMigration', {
    from: deployer,
    log: true,
    args: [lplToken.address, sdlToken.address],
  })

  let tx = await sdlToken.transfer(
    lplMigration.address,
    ethers.utils.parseEther(LPLMigration.depositAmount.toString())
  )
  await tx.wait()

  console.log('deploy-status-ready')
}

module.exports.tags = ['LPL-Migration']
