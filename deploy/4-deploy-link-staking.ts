import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { LinkStakingPool, LinkWrappedSDToken, LinkBorrowingPool, LinkWrappedBSDToken } = config

  const linkToken = await ethers.getContract('LinkToken')
  const poolRouter = await ethers.getContract('PoolRouter')
  const lendingPool = await ethers.getContract('LendingPool')
  const LinkOwnersRewardsPool = await ethers.getContract('LinkOwnersRewardsPool')

  await deploy('LinkStakingPool', {
    contract: 'StakingPool',
    from: deployer,
    log: true,
    args: [
      linkToken.address,
      LinkStakingPool.derivativeTokenName,
      LinkStakingPool.derivativeTokenSymbol,
      [
        [LinkOwnersRewardsPool.address, LinkStakingPool.ownersFeeBasisPoints],
        ...LinkStakingPool.fees,
      ],
      poolRouter.address,
    ],
  })
  const stakingPool = await ethers.getContract('LinkStakingPool')

  await deploy('LinkWrappedSDToken', {
    contract: 'WrappedSDToken',
    from: deployer,
    log: true,
    args: [stakingPool.address, LinkWrappedSDToken.name, LinkWrappedSDToken.symbol],
  })
  const wsdToken = await ethers.getContract('LinkWrappedSDToken')

  let tx = await stakingPool.setWSDToken(wsdToken.address)
  await tx.wait()

  tx = await poolRouter.addPool(linkToken.address, stakingPool.address, deployer, true, 0)
  await tx.wait()

  await deploy('LinkBorrowingPool', {
    contract: 'BorrowingPool',
    from: deployer,
    log: true,
    args: [
      linkToken.address,
      0,
      lendingPool.address,
      stakingPool.address,
      LinkBorrowingPool.derivativeTokenName,
      LinkBorrowingPool.derivativeTokenSymbol,
    ],
  })
  const borrowingPool = await ethers.getContract('LinkBorrowingPool')

  await deploy('LinkWrappedBSDToken', {
    contract: 'WrappedSDToken',
    from: deployer,
    log: true,
    args: [borrowingPool.address, LinkWrappedBSDToken.name, LinkWrappedBSDToken.symbol],
  })
  const wbsdToken = await ethers.getContract('LinkWrappedBSDToken')

  tx = await borrowingPool.init(wbsdToken.address)
  await tx.wait()
}

module.exports.tags = ['Link-Staking']
