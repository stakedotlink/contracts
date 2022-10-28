import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, hardhatArguments } = hre
  const { network } = hardhatArguments
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  if (network == 'hardhat') {
    const lplToken = await ethers.getContract('OwnersToken')
    const linkToken = await ethers.getContract('LinkToken')

    await deploy('Multicall3', {
      from: deployer,
      log: true,
      deterministicDeployment: true,
    })

    await deploy('PoolOwnersV1', {
      from: deployer,
      log: true,
      args: [lplToken.address],
    })
    const poolOwners = await ethers.getContract('PoolOwnersV1')

    await deploy('RewardsPoolV1', {
      from: deployer,
      log: true,
      args: [poolOwners.address, linkToken.address, 'LinkPool Owners LINK', 'lpoLINK'],
    })
    const rewardsPool = await ethers.getContract('RewardsPoolV1')

    await deploy('PoolAllowanceV1', {
      from: deployer,
      log: true,
      args: ['LINK LinkPool Allowance', 'linkLPLA', poolOwners.address],
    })
    const poolAllowance = await ethers.getContract('PoolAllowanceV1')

    await poolOwners.addRewardToken(linkToken.address, poolAllowance.address, rewardsPool.address)
  }
}

module.exports.tags = ['Local-Deployments']
