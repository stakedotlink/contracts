import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { ETH_StakingPool, ETH_WrappedSDToken, wstETH_OwnersRewardsPool } = config

  const poolRouter = await ethers.getContract('PoolRouter')
  const poolOwners = await ethers.getContract('PoolOwners')

  const wrappedETH = await deploy('WrappedETH', { from: deployer, log: true })

  await deploy('ETH_StakingPool', {
    contract: 'StakingPool',
    from: deployer,
    log: true,
    args: [
      wrappedETH.address,
      ETH_StakingPool.derivativeTokenName,
      ETH_StakingPool.derivativeTokenSymbol,
      [[poolOwners.address, ETH_StakingPool.ownersFeeBasisPoints], ...ETH_StakingPool.fees],
      poolRouter.address,
    ],
  })
  const stakingPool = await ethers.getContract('ETH_StakingPool')

  await deploy('ETH_WrappedSDToken', {
    contract: 'WrappedSDToken',
    from: deployer,
    log: true,
    args: [stakingPool.address, ETH_WrappedSDToken.name, ETH_WrappedSDToken.symbol],
  })
  const wsdToken = await ethers.getContract('ETH_WrappedSDToken')

  const wstEthOwnersRewardsPool = await deploy('wstETH_OwnersRewardsPool', {
    contract: 'RewardsPool',
    from: deployer,
    log: true,
    args: [
      poolOwners.address,
      wsdToken.address,
      wstETH_OwnersRewardsPool.derivativeTokenName,
      wstETH_OwnersRewardsPool.derivativeTokenSymbol,
    ],
  })

  let tx = await stakingPool.setWSDToken(wsdToken.address)
  await tx.wait()

  tx = await poolRouter.addPool(wrappedETH.address, stakingPool.address, false, 0)
  await tx.wait()

  tx = await poolOwners.addToken(wsdToken.address, wstEthOwnersRewardsPool.address)
  await tx.wait()
}

module.exports.tags = ['Eth-Staking']
