// @ts-nocheck

import {  fromEther, getAccounts, toEther } from '../utils/helpers'
import {  getContract, deployUpgradeable } from '../utils/deployment'

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
  const linkToken = (await getContract('LINKToken')) as any
  const lplToken = (await getContract('LPLToken')) as any
  const sdlToken = (await getContract('SDLToken')) as any
  const poolRouter = (await getContract('PoolRouter')) as any
  const lplMigration = (await getContract('LPLMigration')) as any
  const poolOwnersV1 = (await getContract('PoolOwnersV1')) as any
  const ownersRewardsPoolV1 = (await getContract('LINK_OwnersRewardsPoolV1')) as any
  const delegatorPool = (await getContract('DelegatorPool')) as any
  const LINK_StakingPool = (await getContract('LINK_StakingPool')) as any
  const stLINK_DelegatorRewardsPool = (await getContract(
    'stLINK_DelegatorRewardsPool'
  )) as any

  await sdlToken.mint(lplMigration.address, toEther(150000))

  const poolMin = 10
  const poolMax = 1000000

  const strategyMock = await deployUpgradeable('StrategyMock', [
    linkToken.address,
    LINK_StakingPool.address,
    toEther(poolMax),
    toEther(poolMin),
  ])
  await LINK_StakingPool.addStrategy(strategyMock.address)

  // account 2

  await linkToken.transfer(accounts[2], toEther(10000))
  await lplToken.transfer(accounts[2], toEther(10000))
  await sdlToken.mint(accounts[2], toEther(10000))
  await lplToken.connect(signers[2]).transferAndCall(poolOwnersV1.address, toEther(1), '0x00')
  await linkToken.transfer(ownersRewardsPoolV1.address, toEther(10))
  await ownersRewardsPoolV1.distributeRewards()

  // account 3

  await linkToken.transfer(accounts[3], toEther(10000))
  await sdlToken.mint(accounts[3], toEther(40000))

  // stake SDL

  await sdlToken
    .connect(signers[3])
    .transferAndCall(delegatorPool.address, toEther(1000), '0x00')

  // const canDepositAddress3 = await poolRouter['canDeposit(address,address,uint16)'](
  //   accounts[3],
  //   linkToken.address,
  //   '0x00'
  // )

  // stake LINK

  await linkToken
    .connect(signers[3])
    .transferAndCall(poolRouter.address, toEther(1), '0x00')

  // send stLINK rewards to rewards pool

  await LINK_StakingPool
    .connect(signers[3])
    .transferAndCall(stLINK_DelegatorRewardsPool.address, toEther(1), '0x00')

  // account 4

  await linkToken.transfer(accounts[4], toEther(10000000))
  await lplToken.transfer(accounts[4], toEther(10000))
  await sdlToken.mint(accounts[4], toEther(100000))

  // // stake SDL

  await sdlToken
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
