import { deployUpgradeable, getAccounts, toEther } from './utils/helpers'
import { ERC677, PoolOwners, PoolRouter, StakingPool, LendingPool } from '../typechain-types'
import { ethers } from 'hardhat'

/*
Accounts:
0 - main account that holds most of the tokens. Do not test ui with this account.
1 - account with no tokens.
2 - account with STA/LINK/LPL and with no staked assets
3 - account with staked STA/LINK/LPL
4 - account with without STA + rewards
*/

async function main() {
  const { signers, accounts } = await getAccounts()

  const linkToken = (await ethers.getContract('LinkToken')) as ERC677
  const ownersToken = (await ethers.getContract('OwnersToken')) as ERC677
  const stakingAllowance = (await ethers.getContract('StakingAllowance')) as ERC677
  const stakingPool = (await ethers.getContract('LINK_StakingPool')) as StakingPool
  const poolOwners = (await ethers.getContract('PoolOwners')) as PoolOwners
  const poolRouter = (await ethers.getContract('PoolRouter')) as PoolRouter
  const poolOwnersV1 = (await ethers.getContract('PoolOwnersV1')) as any
  const ownersRewardsPoolV1 = (await ethers.getContract('OwnersRewardsPoolV1')) as any
  const LINK_WrappedSDToken = (await ethers.getContract('LINK_WrappedSDToken')) as any

  const poolMin = 10
  const poolMax = 1000000

  const strategyMock = await deployUpgradeable('StrategyMock', [
    linkToken.address,
    stakingPool.address,
    toEther(poolMax),
    toEther(poolMin),
  ])
  await stakingPool.addStrategy(strategyMock.address)

  // account 2

  await linkToken.transfer(accounts[2], toEther(10000))
  await ownersToken.transfer(accounts[2], toEther(10000))
  await stakingAllowance.transfer(accounts[2], toEther(10000))
  await ownersToken.connect(signers[2]).transferAndCall(poolOwnersV1.address, toEther(1), '0x00')
  await linkToken.transfer(ownersRewardsPoolV1.address, toEther(10))
  await ownersRewardsPoolV1.distributeRewards()

  // account 3

  await linkToken.transfer(accounts[3], toEther(10000))
  await ownersToken.transfer(accounts[3], toEther(10000))
  await stakingAllowance.transfer(accounts[3], toEther(40000))

  // stake LPL
  await ownersToken.connect(signers[3]).transferAndCall(poolOwners.address, toEther(1000), '0x00')

  // stake STA and LINK
  await linkToken.connect(signers[3]).approve(poolRouter.address, toEther(10))

  await stakingAllowance
    .connect(signers[3])
    .transferAndCall(
      poolRouter.address,
      toEther(1000),
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint', 'uint16'],
        [linkToken.address, toEther(10), 0]
      )
    )

  // lend STA
  await stakingAllowance
    .connect(signers[3])
    .transferAndCall(
      poolRouter.address,
      toEther(10000),
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint', 'uint16'],
        [linkToken.address, toEther(0), 0]
      )
    )

  // borrow
  await linkToken.connect(signers[3]).approve(poolRouter.address, toEther(10))
  await stakingAllowance
    .connect(signers[3])
    .transferAndCall(
      poolRouter.address,
      toEther(0),
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint', 'uint16'],
        [linkToken.address, toEther(10), 0]
      )
    )

  // account 4

  await linkToken.transfer(accounts[4], toEther(10000))
  await ownersToken.transfer(accounts[4], toEther(10000))
  await stakingAllowance.transfer(accounts[4], toEther(100000))

  // stake LPL
  await ownersToken.connect(signers[4]).transferAndCall(poolOwners.address, toEther(1000), '0x00')

  // stake STA and LINK
  await linkToken.connect(signers[4]).approve(poolRouter.address, toEther(1000))
  await stakingAllowance
    .connect(signers[4])
    .transferAndCall(
      poolRouter.address,
      toEther(100000),
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint', 'uint16'],
        [linkToken.address, toEther(1000), 0]
      )
    )

  // send LINK rewards to owners pool
  await linkToken.connect(signers[4]).transferAndCall(poolOwners.address, toEther(100), '0x00')
  // send stLINK rewards to owners pool
  await stakingPool
    .connect(signers[4])
    .transferAndCall(LINK_WrappedSDToken.address, toEther(100), '0x00')
  await LINK_WrappedSDToken.connect(signers[4]).transferAndCall(
    poolOwners.address,
    toEther(100),
    '0x00'
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
