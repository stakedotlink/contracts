import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { LINK_StakingPool, LINK_WrappedSDToken } = config

  const linkToken = await ethers.getContract('LinkToken')
  const stakingAllowance = await ethers.getContract('StakingAllowance')
  const delegatorPool = await ethers.getContract('DelegatorPool')

  await deploy('PoolRouter', {
    from: deployer,
    log: true,
    args: [stakingAllowance.address, delegatorPool.address],
  })
  const poolRouter = await ethers.getContract('PoolRouter')

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

  const wsdToken = await deploy('LINK_WrappedSDToken', {
    contract: 'WrappedSDToken',
    from: deployer,
    log: true,
    args: [stakingPool.address, LINK_WrappedSDToken.name, LINK_WrappedSDToken.symbol],
  })

  const wstLinkDelegatorRewardsPool = await deploy('wstLINK_DelegatorRewardsPool', {
    contract: 'RewardsPoolWSD',
    from: deployer,
    log: true,
    args: [delegatorPool.address, stakingPool.address, wsdToken.address],
  })

  let tx = await poolRouter.addPool(linkToken.address, stakingPool.address, 0, true)
  await tx.wait()

  tx = await delegatorPool.addToken(stakingPool.address, wstLinkDelegatorRewardsPool.address)
  await tx.wait()
}

module.exports.tags = ['1.0']
