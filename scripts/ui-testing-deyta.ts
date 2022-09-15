import { deployUpgradeable, getAccounts, toEther } from './utils/helpers'
import { ERC677, StakingPool } from '../typechain-types'
import { ethers } from 'hardhat'

async function main() {
  const { accounts } = await getAccounts()

  const linkToken = (await ethers.getContract('LinkToken')) as ERC677
  const ownersToken = (await ethers.getContract('OwnersToken')) as ERC677
  const stakingAllowance = (await ethers.getContract('StakingAllowance')) as ERC677
  const stakingPool = (await ethers.getContract('LINK_StakingPool')) as StakingPool

  const strategyMock = await deployUpgradeable('StrategyMock', [
    linkToken.address,
    stakingPool.address,
    toEther(1000000),
    toEther(100000),
  ])
  await stakingPool.addStrategy(strategyMock.address)

  for (let i = 1; i < accounts.length; i++) {
    await linkToken.transfer(accounts[i], toEther(100000))
    await ownersToken.transfer(accounts[i], toEther(1000))
    await stakingAllowance.transfer(accounts[i], toEther(1000))
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
