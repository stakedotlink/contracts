import { HardhatRuntimeEnvironment } from 'hardhat/types'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  await deploy('MerkleDistributor', {
    from: deployer,
    log: true,
  })

  console.log('deploy-status-ready')
}

module.exports.tags = ['MerkleDistributor']
