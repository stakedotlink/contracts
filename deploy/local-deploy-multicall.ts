import { HardhatRuntimeEnvironment } from 'hardhat/types'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, hardhatArguments } = hre
  const { network } = hardhatArguments
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  if (network == 'hardhat') {
    await deploy('Multicall3', {
      from: deployer,
      log: true,
      deterministicDeployment: true,
    })
  }
}

module.exports.tags = ['Local-Deployments']
