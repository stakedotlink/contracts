import { deployUpgradeable, getAccounts, toEther } from './utils/helpers'
import {
  BorrowingPool,
  ERC677,
  LendingPool,
  PoolOwners,
  PoolRouter,
  StakingPool,
} from '../typechain-types'
import { ethers } from 'hardhat'

async function main() {
  const { signers, accounts } = await getAccounts()

  const linkToken = (await ethers.getContract('LinkToken')) as ERC677
  const ownersToken = (await ethers.getContract('OwnersToken')) as ERC677
  const stakingAllowance = (await ethers.getContract('StakingAllowance')) as ERC677
  const poolRouter = (await ethers.getContract('PoolRouter')) as PoolRouter
  const poolOwners = (await ethers.getContract('PoolOwners')) as PoolOwners
  const stakingPool = (await ethers.getContract('LINK_StakingPool')) as StakingPool
  const lendingPool = (await ethers.getContract('LendingPool')) as LendingPool
  const borrowingPool = (await ethers.getContract('LINK_BorrowingPool')) as BorrowingPool

  const strategyMock = await deployUpgradeable('StrategyMock', [
    linkToken.address,
    stakingPool.address,
    toEther(1000000),
    0,
  ])
  await stakingPool.addStrategy(strategyMock.address)

  for (let i = 1; i < accounts.length; i++) {
    await linkToken.transfer(accounts[i], toEther(10000))
    await ownersToken.transfer(accounts[i], toEther(10000))
    await stakingAllowance.transfer(accounts[i], toEther(1000000))

    if (i % 2 != 0) {
      await ownersToken
        .connect(signers[i])
        .transferAndCall(poolOwners.address, toEther(200 * i), '0x00')
      await stakingAllowance
        .connect(signers[i])
        .transferAndCall(poolRouter.address, toEther(i * 10000), '0x00')
      await linkToken
        .connect(signers[i])
        .transferAndCall(poolRouter.address, toEther(i * 100), '0x00')
      await stakingAllowance
        .connect(signers[i])
        .transferAndCall(lendingPool.address, toEther(100000 * i), '0x00')
    } else {
      await linkToken
        .connect(signers[i])
        .transferAndCall(lendingPool.address, toEther(30 * i), '0x00')
    }
  }

  await linkToken.transfer(strategyMock.address, toEther(4000))
  await stakingPool.updateStrategyRewards([0])
  await borrowingPool.updateRewards()

  for (let i = 1; i < accounts.length; i++) {
    if (i % 2 != 0) {
      await poolOwners.connect(signers[i]).withdrawRewards([linkToken.address])
      await poolOwners.connect(signers[i]).withdraw(toEther(i * 100))
      await poolRouter.connect(signers[i]).withdraw(linkToken.address, 0, toEther(i * 200))
      await lendingPool.connect(signers[i]).withdrawAllowance(toEther(i * 100))
    } else {
      await lendingPool.connect(signers[i]).withdraw(linkToken.address, 0, toEther(i * 15))
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
