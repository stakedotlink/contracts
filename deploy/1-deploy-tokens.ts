import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { StakingAllowance } = config

  let lplToken: any = await ethers.getContractOrNull('OwnersToken')
  if (!lplToken) {
    await deploy('OwnersToken', {
      contract: 'ERC677',
      from: deployer,
      log: true,
      args: ['LinkPool', 'LPL', 100000000],
    })
    lplToken = await ethers.getContract('OwnersToken')
  }

  let linkToken: any = await ethers.getContractOrNull('LinkToken')
  if (!linkToken) {
    await deploy('LinkToken', {
      contract: 'ERC677',
      from: deployer,
      log: true,
      args: ['Chainlink', 'LINK', 1000000000],
    })
    linkToken = await ethers.getContract('LinkToken')
  }

  await deploy('StakingAllowance', {
    from: deployer,
    log: true,
    args: [StakingAllowance.name, StakingAllowance.symbol],
  })
  const stakingAllowance = await ethers.getContract('StakingAllowance')

  const tx = await stakingAllowance.mint(
    deployer,
    ethers.utils.parseEther(StakingAllowance.initialSupply.toString())
  )
  await tx.wait()
}

module.exports.tags = ['Tokens']
