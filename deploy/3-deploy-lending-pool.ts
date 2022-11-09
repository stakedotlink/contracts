import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { LendingPool } = config

  const stakingAllowance = await ethers.getContract('StakingAllowance')
  const poolRouter = await ethers.getContract('PoolRouter')

  await deploy('LendingPool', {
    from: deployer,
    log: true,
    args: [
      stakingAllowance.address,
      LendingPool.derivativeTokenName,
      LendingPool.derivativeTokenSymbol,
      poolRouter.address,
      LendingPool.rateConstantA,
      LendingPool.rateConstantB,
      LendingPool.rateConstantC,
      LendingPool.rateConstantD,
      LendingPool.rateConstantE,
    ],
  })
  const lendingPool = await ethers.getContract('LendingPool')

  const tx = await poolRouter.setLendingPool(lendingPool.address)
  await tx.wait()
}

module.exports.tags = ['LendingPool']
