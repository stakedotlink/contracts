import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { StakingAllowance } = config

  await deploy('StakingAllowance', {
    from: deployer,
    log: true,
    args: [StakingAllowance.name, StakingAllowance.symbol],
  })
  const stakingAllowance = await ethers.getContract('StakingAllowance')

  await deploy('PoolRouter', {
    from: deployer,
    log: true,
    args: [stakingAllowance.address, true],
  })

  const tx = await stakingAllowance.mint(deployer, ethers.utils.parseEther('100000000'))
  await tx.wait()
}

module.exports.tags = ['PoolRouter']
