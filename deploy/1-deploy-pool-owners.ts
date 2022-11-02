import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { PoolOwners } = config

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

  await deploy('PoolOwners', {
    from: deployer,
    log: true,
    args: [lplToken.address, PoolOwners.derivativeTokenName, PoolOwners.derivativeTokenSymbol],
  })
  const poolOwners = await ethers.getContract('PoolOwners')

  const linkOwnersRewardsPool = await deploy('LINK_OwnersRewardsPool', {
    contract: 'RewardsPool',
    from: deployer,
    log: true,
    args: [poolOwners.address, linkToken.address],
  })

  const tx = await poolOwners.addToken(linkToken.address, linkOwnersRewardsPool.address)
  await tx.wait()
}

module.exports.tags = ['PoolOwners']
