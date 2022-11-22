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
  const delegatorPool = await ethers.getContract('DelegatorPool')

  await deploy('LINK_StakingPool', {
    contract: 'StakingPool',
    from: deployer,
    log: true,
    args: [
      linkToken.address,
      LINK_StakingPool.derivativeTokenName,
      LINK_StakingPool.derivativeTokenSymbol,
      LINK_StakingPool.fees,
      poolRouter.address,
      delegatorPool.address,
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

  const wstLinkDelegatorRewardsPool = await deploy('wstLINK_DelegatorRewardsPool', {
    contract: 'RewardsPoolWSD',
    from: deployer,
    log: true,
    args: [delegatorPool.address, stakingPool.address, wsdToken.address],
  })

  let tx = await poolRouter.addPool(linkToken.address, stakingPool.address, 0)
  await tx.wait()

  tx = await delegatorPool.addToken(linkToken.address, wstLinkDelegatorRewardsPool.address)
  await tx.wait()

  console.log('deploy-status-ready')
}

module.exports.tags = ['Link-Staking']
