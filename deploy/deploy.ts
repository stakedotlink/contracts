import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre
  const { deploy } = deployments
  const deployer = await (await ethers.getSigners())[0].getAddress()

  let linkToken: any = await ethers.getContractOrNull('LinkToken')
  if (!linkToken) {
    linkToken = await deploy('ERC677', {
      from: deployer,
      log: true,
      args: ['Chainlink', 'LINK', 1000000000],
    })
  }

  let ownersToken: any = await ethers.getContractOrNull('OwnersToken')
  if (!ownersToken) {
    ownersToken = await deploy('ERC677', {
      from: deployer,
      log: true,
      args: ['LinkPool', 'LPL', 100000000],
    })
  }

  const allowanceToken = await deploy('Allowance', {
    from: deployer,
    log: true,
    args: ['LinkPool Allowance', 'LPLA'],
  })

  const poolOwners = await deploy('PoolOwners', {
    from: deployer,
    log: true,
    args: [ownersToken.address, allowanceToken.address],
  })

  const ownersRewardsPool = await deploy('OwnersRewardsPool', {
    from: deployer,
    log: true,
    args: [poolOwners.address, linkToken.address, 'LinkPool Owners LINK', 'lpoLINK'],
  })

  const AllowanceToken = await ethers.getContract('Allowance')
  await AllowanceToken.setPoolOwners(poolOwners.address)

  const PoolOwners = await ethers.getContract('PoolOwners')
  await PoolOwners.addToken(linkToken.address, ownersRewardsPool.address)
}
export default func
