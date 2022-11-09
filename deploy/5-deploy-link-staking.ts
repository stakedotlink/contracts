import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { LINK_StakingPool, LINK_WrappedSDToken } = config

  const linkToken = await ethers.getContract('LinkToken')
  const poolRouter = await ethers.getContract('PoolRouter')
  const lendingPool = await ethers.getContract('LendingPool')
  const poolOwners = await ethers.getContract('PoolOwners')

  await deploy('LINK_StakingPool', {
    contract: 'StakingPool',
    from: deployer,
    log: true,
    args: [
      linkToken.address,
      LINK_StakingPool.derivativeTokenName,
      LINK_StakingPool.derivativeTokenSymbol,
      [[poolOwners.address, LINK_StakingPool.ownersFeeBasisPoints], ...LINK_StakingPool.fees],
      poolRouter.address,
      lendingPool.address,
    ],
  })
  const stakingPool = await ethers.getContract('LINK_StakingPool')

  await deploy('LINK_WrappedSDToken', {
    contract: 'WrappedSDToken',
    from: deployer,
    log: true,
    args: [stakingPool.address, LINK_WrappedSDToken.name, LINK_WrappedSDToken.symbol],
  })
  const wsdToken = await ethers.getContract('LINK_WrappedSDToken')

  const wstLinkOwnersRewardsPool = await deploy('wstLINK_OwnersRewardsPool', {
    contract: 'RewardsPool',
    from: deployer,
    log: true,
    args: [poolOwners.address, wsdToken.address],
  })

  let tx = await stakingPool.setWSDToken(wsdToken.address)
  await tx.wait()

  tx = await poolRouter.addPool(linkToken.address, stakingPool.address, true, 0)
  await tx.wait()

  tx = await poolOwners.addToken(wsdToken.address, wstLinkOwnersRewardsPool.address)
  await tx.wait()

  const linkLendingRewardsPool = await deploy('wstLINK_LendingRewardsPool', {
    contract: 'RewardsPool',
    from: deployer,
    log: true,
    args: [lendingPool.address, wsdToken.address],
  })

  tx = await lendingPool.addToken(wsdToken.address, linkLendingRewardsPool.address)
  await tx.wait()

  console.log('deploy-status-ready')
}

module.exports.tags = ['Link-Staking']
