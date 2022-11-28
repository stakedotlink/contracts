import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { DelegatorPool, FlatFee } = config

  const stakingAllowance = await ethers.getContract('StakingAllowance')
  const poolRouter = await ethers.getContract('PoolRouter')

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
      stakingAllowance.address,
      DelegatorPool.derivativeTokenName,
      DelegatorPool.derivativeTokenSymbol,
      poolRouter.address,
      feeCurve.address,
    ],
  })
  const delegatorPool = await ethers.getContract('DelegatorPool')

  const tx = await poolRouter.setDelegatorPool(delegatorPool.address)
  await tx.wait()
}

module.exports.tags = ['DelegatorPool']
