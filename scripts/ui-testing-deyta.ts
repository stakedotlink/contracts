import { deployUpgradeable, getAccounts, toEther } from './utils/helpers'
import { ERC677, PoolOwners, PoolRouter, StakingPool } from '../typechain-types'
import { ethers } from 'hardhat'

/*
Accounts:
0 - main account that holds most of the tokens. Do not test ui with this account.
1 - account with no tokens.
2 - account with STA/LINK/LPL and with no staked assets
3 -  account with staked STA/LINK/LPL
*/

async function main() {
  const { signers, accounts } = await getAccounts()

  const linkToken = (await ethers.getContract('LinkToken')) as ERC677
  const ownersToken = (await ethers.getContract('OwnersToken')) as ERC677
  const stakingAllowance = (await ethers.getContract('StakingAllowance')) as ERC677
  const stakingPool = (await ethers.getContract('LINK_StakingPool')) as StakingPool
  const poolOwners = (await ethers.getContract('PoolOwners')) as PoolOwners
  const poolRouter = (await ethers.getContract('PoolRouter')) as PoolRouter

  const strategyMock = await deployUpgradeable('StrategyMock', [
    linkToken.address,
    stakingPool.address,
    toEther(1000000),
    toEther(100000),
  ])
  await stakingPool.addStrategy(strategyMock.address)

  // account 2

  await linkToken.transfer(accounts[2], toEther(10000))
  await ownersToken.transfer(accounts[2], toEther(10000))
  await stakingAllowance.transfer(accounts[2], toEther(10000))

  // account 3

  await linkToken.transfer(accounts[3], toEther(10000))
  await ownersToken.transfer(accounts[3], toEther(10000))
  await stakingAllowance.transfer(accounts[3], toEther(10000))

  // stake LPL
  await ownersToken.connect(signers[3]).transferAndCall(poolOwners.address, toEther(1000), '0x00')
  // stake STA
  await stakingAllowance
    .connect(signers[3])
    .transferAndCall(poolRouter.address, toEther(1000), '0x00')
  // stake LINK
  await linkToken.connect(signers[3]).transferAndCall(poolRouter.address, toEther(10), '0x00')

  // account 4
  // ...
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
