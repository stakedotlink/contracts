import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const stakingAllowance = await ethers.getContract('StakingAllowance')

  await deploy('PoolRouter', {
    from: deployer,
    log: true,
    args: [stakingAllowance.address, true],
  })
}

module.exports.tags = ['PoolRouter']
