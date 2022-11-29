import { deployUpgradeable, getAccounts, toEther, fromEther } from '../utils/helpers'
// import { ERC677,  PoolRouter, StakingPool } from '../../typechain-types'
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

  const linkToken = (await ethers.getContract('LinkToken')) as any
  const ownersToken = (await ethers.getContract('OwnersToken')) as any
  const stakingAllowance = (await ethers.getContract('StakingAllowance')) as any
  const stakingPool = (await ethers.getContract('LINK_StakingPool')) as any
  const poolRouter = (await ethers.getContract('PoolRouter')) as any
  const poolOwnersV1 = (await ethers.getContract('PoolOwnersV1')) as any
  const ownersRewardsPoolV1 = (await ethers.getContract('OwnersRewardsPoolV1')) as any
  const delegatorPool = (await ethers.getContract('DelegatorPool')) as any
  const wstLINK_DelegatorRewardsPool = (await ethers.getContract(
    'wstLINK_DelegatorRewardsPool'
  )) as any
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
  await stakingAllowance.transfer(accounts[3], toEther(40000))

  // stake SDL

  await stakingAllowance
    .connect(signers[3])
    .transferAndCall(delegatorPool.address, toEther(1000), '0x00')

  const canDepositAddress3 = await poolRouter['canDeposit(address,address,uint16)'](
    accounts[3],
    linkToken.address,
    '0x00'
  )

  // stake LINK

  await linkToken
    .connect(signers[3])
    .transferAndCall(poolRouter.address, canDepositAddress3, '0x00')

  // send stLINK rewards to rewards pool

  await stakingPool
    .connect(signers[3])
    .transferAndCall(wstLINK_DelegatorRewardsPool.address, toEther(1), '0x00')

  // account 4

  await linkToken.transfer(accounts[4], toEther(10000))
  await ownersToken.transfer(accounts[4], toEther(10000))
  await stakingAllowance.transfer(accounts[4], toEther(100000))

  // stake SDL

  await stakingAllowance
    .connect(signers[4])
    .transferAndCall(delegatorPool.address, toEther(100000), '0x00')

  const canDepositAddress4 = await poolRouter['canDeposit(address,address,uint16)'](
    accounts[4],
    linkToken.address,
    '0x00'
  )

  // stake LINK

  await linkToken
    .connect(signers[4])
    .transferAndCall(poolRouter.address, canDepositAddress4, '0x00')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
