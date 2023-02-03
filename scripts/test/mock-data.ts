// @ts-nocheck

import { fromEther, getAccounts, toEther } from '../utils/helpers'
import { getContract, deployUpgradeable, deploy, updateDeployments } from '../utils/deployment'
import { defaultAbiCoder } from 'ethers/lib/utils'
import {
  ERC677,
  LidoSTETHAdapter,
  LiquidSDIndexPool,
  StakingPool,
  StrategyMock,
} from '../../typechain-types'
import { padBytes } from '../../test/utils/helpers'

/*
Accounts:
0 - main account that holds most of the tokens. Do not test ui with this account.
1 - account with no tokens.
2 - account with STA/LINK/LPL and with no staked assets
3 - account with staked STA/LINK/LPL/rETH/stETH
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
  const stLINK_DelegatorRewardsPool = (await getContract('stLINK_DelegatorRewardsPool')) as any
  const indexPool = (await getContract('LiquidSDIndexPool')) as any
  const iETH_DelegatorRewardsPool = (await getContract('iETH_DelegatorRewardsPool')) as any

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

  // account 5 lpl rewards

  await lplToken.transfer(accounts[5], toEther(1))
  await lplToken.connect(signers[5]).transferAndCall(poolOwnersV1.address, toEther(1), '0x00')
  await linkToken.transfer(ownersRewardsPoolV1.address, toEther(1))
  await ownersRewardsPoolV1.distributeRewards()
  await poolOwnersV1.connect(signers[5]).withdraw(toEther(1))
  await lplToken.connect(signers[5]).transferAndCall(lplMigration.address, toEther(1), '0x00')
  // await lplToken.connect(signers[5]).transferAndCall(accounts[0].address, toEther(1), '0x00')

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

  await sdlToken.connect(signers[3]).transferAndCall(delegatorPool.address, toEther(1000), '0x00')

  // const canDepositAddress3 = await poolRouter['canDeposit(address,address,uint16)'](
  //   accounts[3],
  //   linkToken.address,
  //   '0x00'
  // )

  // stake LINK

  await linkToken.connect(signers[3]).transferAndCall(poolRouter.address, toEther(1), '0x00')

  // send stLINK rewards to rewards pool

  await LINK_StakingPool.connect(signers[3]).transferAndCall(
    stLINK_DelegatorRewardsPool.address,
    toEther(1),
    '0x00'
  )

  // account 4

  await linkToken.transfer(accounts[4], toEther(10000000))
  await lplToken.transfer(accounts[4], toEther(10000))
  await sdlToken.mint(accounts[4], toEther(100000))

  // stake SDL

  await sdlToken.connect(signers[4]).transferAndCall(delegatorPool.address, toEther(100000), '0x00')

  const canDepositAddress4 = await poolRouter['canDeposit(address,address,uint16)'](
    accounts[4],
    linkToken.address,
    '0x00'
  )

  // stake LINK

  await linkToken
    .connect(signers[4])
    .transferAndCall(poolRouter.address, canDepositAddress4, '0x00')

  // account 5

  await sdlToken.mintToContract(
    delegatorPool.address,
    accounts[5],
    toEther(600),
    defaultAbiCoder.encode(['uint64', 'uint64'], [1685980800, 47347200])
  )

  // Liquid SD Index

  const ethToken = (await deploy('ERC677', ['ETH', 'ETH', 1000000000])) as ERC677

  const stakingPoolOne = (await deployUpgradeable('StakingPool', [
    ethToken.address,
    'Staked ETH',
    'stETH',
    [],
    poolRouter.address,
    delegatorPool.address,
  ])) as StakingPool

  const stakingPoolTwo = (await deployUpgradeable('StakingPool', [
    ethToken.address,
    'RocketPool ETH',
    'rETH',
    [],
    poolRouter.address,
    delegatorPool.address,
  ])) as StakingPool

  const strategyOne = (await deployUpgradeable('StrategyMock', [
    ethToken.address,
    stakingPoolOne.address,
    toEther(1000),
    toEther(10),
  ])) as StrategyMock
  await stakingPoolOne.addStrategy(strategyOne.address)

  const strategyTwo = (await deployUpgradeable('StrategyMock', [
    ethToken.address,
    stakingPoolTwo.address,
    toEther(2000),
    toEther(20),
  ])) as StrategyMock
  await stakingPoolTwo.addStrategy(strategyTwo.address)

  await poolRouter.addPool(stakingPoolOne.address, 0, false)
  await poolRouter.addPool(stakingPoolTwo.address, 0, false)

  const adapterOne = (await deployUpgradeable('LidoSTETHAdapter', [
    stakingPoolOne.address,
    indexPool.address,
  ])) as LidoSTETHAdapter

  const adapterTwo = (await deployUpgradeable('LidoSTETHAdapter', [
    stakingPoolTwo.address,
    indexPool.address,
  ])) as LidoSTETHAdapter

  await indexPool.addLSDToken(stakingPoolOne.address, adapterOne.address, [10000])
  await indexPool.addLSDToken(stakingPoolTwo.address, adapterTwo.address, [5000, 5000])

  await ethToken.transferAndCall(poolRouter.address, toEther(1000), padBytes('0x0', 32))
  await ethToken.transferAndCall(poolRouter.address, toEther(1000), padBytes('0x1', 32))


  await stakingPoolOne.transfer(accounts[3], toEther(400))
  await stakingPoolTwo.transfer(accounts[3], toEther(600))
  
  await stakingPoolOne.connect(signers[3]).approve(indexPool.address, toEther(400))
  await stakingPoolTwo.connect(signers[3]).approve(indexPool.address, toEther(600))
  await indexPool.connect(signers[3]).deposit(stakingPoolOne.address, toEther(400))
  await indexPool.connect(signers[3]).deposit(stakingPoolTwo.address, toEther(600))

  await stakingPoolOne.transfer(accounts[2], toEther(100))
  await stakingPoolTwo.transfer(accounts[2], toEther(100))

  // send rewards to rewards pool

  await indexPool.connect(signers[3]).transferAndCall(
    iETH_DelegatorRewardsPool.address,
    toEther(1),
    '0x00'
  )


  updateDeployments({
    LidoETH: stakingPoolOne.address,
    RocketPoolETH: stakingPoolTwo.address,
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
