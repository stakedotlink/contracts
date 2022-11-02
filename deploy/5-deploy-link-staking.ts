import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { config } from '../config/deploy'

module.exports = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  const { LINK_StakingPool, LINK_WrappedSDToken, LINK_BorrowingPool, LINK_WrappedBorrowedSDToken } =
    config

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

  await deploy('LINK_BorrowingPool', {
    contract: 'BorrowingPool',
    from: deployer,
    log: true,
    args: [
      linkToken.address,
      0,
      lendingPool.address,
      stakingPool.address,
      LINK_BorrowingPool.derivativeTokenName,
      LINK_BorrowingPool.derivativeTokenSymbol,
    ],
  })
  const borrowingPool = await ethers.getContract('LINK_BorrowingPool')

  await deploy('LINK_WrappedBorrowedSDToken', {
    contract: 'WrappedSDToken',
    from: deployer,
    log: true,
    args: [
      borrowingPool.address,
      LINK_WrappedBorrowedSDToken.name,
      LINK_WrappedBorrowedSDToken.symbol,
    ],
  })
  const wbsdToken = await ethers.getContract('LINK_WrappedBorrowedSDToken')

  const linkLendingRewardsPool = await deploy('wbstLINK_LendingRewardsPool', {
    contract: 'RewardsPool',
    from: deployer,
    log: true,
    args: [lendingPool.address, wbsdToken.address],
  })

  tx = await borrowingPool.init(wbsdToken.address)
  await tx.wait()

  tx = await lendingPool.addToken(wbsdToken.address, linkLendingRewardsPool.address)
  await tx.wait()

  tx = await lendingPool.addPool(linkToken.address, 0, borrowingPool.address)
  await tx.wait()

  console.log('deploy-status-ready')
}

module.exports.tags = ['Link-Staking']
