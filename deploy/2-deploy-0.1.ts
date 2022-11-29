import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { StakingAllowance, LPLMigration, DelegatorPool, FlatFee } = config

  const lplToken = await ethers.getContract('OwnersToken')

  await deploy('StakingAllowance', {
    from: deployer,
    log: true,
    args: [StakingAllowance.name, StakingAllowance.symbol],
  })
  const sdlToken = await ethers.getContract('StakingAllowance')

  let tx = await sdlToken.mint(
    deployer,
    ethers.utils.parseEther(StakingAllowance.initialSupply.toString())
  )
  await tx.wait()

  const lplMigration = await deploy('LPLMigration', {
    from: deployer,
    log: true,
    args: [lplToken.address, sdlToken.address],
  })

  tx = await sdlToken.transfer(
    lplMigration.address,
    ethers.utils.parseEther(LPLMigration.depositAmount.toString())
  )
  await tx.wait()

  await deploy('FlatFee', {
    from: deployer,
    log: true,
    args: [FlatFee.feeBasisPoints],
  })
  const feeCurve = await ethers.getContract('FlatFee')

  await deploy('DelegatorPool', {
    from: deployer,
    log: true,
    args: [
      sdlToken.address,
      DelegatorPool.derivativeTokenName,
      DelegatorPool.derivativeTokenSymbol,
      feeCurve.address,
    ],
  })
}

module.exports.tags = ['0.1']
