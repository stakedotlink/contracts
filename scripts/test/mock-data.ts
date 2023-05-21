// @ts-nocheck

import { fromEther, getAccounts, toEther } from '../utils/helpers'
import { getContract, deployUpgradeable, deploy, updateDeployments } from '../utils/deployment'
import { defaultAbiCoder } from 'ethers/lib/utils'
import {
  CurveMock,
  ERC677,
  LidoLSDIndexAdapter,
  RocketPoolLSDIndexAdapter,
  LiquidSDIndexPool,
  StakingPool,
  StrategyMock,
  LiquidSDAdapterMock,
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
  const ETH_LiquidSDIndexPool = (await getContract('ETH_LiquidSDIndexPool')) as any
  const stETHToken = (await getContract('stETHToken')) as ERC20
  const rETHToken = (await getContract('rETHToken')) as ERC20
  const cbETHToken = (await getContract('cbETHToken')) as ERC20
  const sfrxETHToken = (await getContract('sfrxETHToken')) as ERC20

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

  await sdlToken.connect(signers[3]).transferAndCall(delegatorPool.address, toEther(1000), '0x')

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

  await sdlToken.connect(signers[4]).transferAndCall(delegatorPool.address, toEther(100000), '0x')

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
    defaultAbiCoder.encode(['uint256'], [toEther(400)])
  )

  // Liquid SD Index

  const lidoAdapter = (await deployUpgradeable('LSDIndexAdapterMock', [
    stETHToken.address,
    ETH_LiquidSDIndexPool.address,
    toEther(1),
  ])) as LSDIndexAdapterMock

  const rocketPoolAdapter = (await deployUpgradeable('LSDIndexAdapterMock', [
    rETHToken.address,
    ETH_LiquidSDIndexPool.address,
    toEther(1.2),
  ])) as LSDIndexAdapterMock

  const coinbaseAdapter = (await deployUpgradeable('LSDIndexAdapterMock', [
    cbETHToken.address,
    ETH_LiquidSDIndexPool.address,
    toEther(1.03),
  ])) as LSDIndexAdapterMock

  const fraxAdapter = (await deployUpgradeable('LSDIndexAdapterMock', [
    sfrxETHToken.address,
    ETH_LiquidSDIndexPool.address,
    toEther(1.03),
  ])) as LSDIndexAdapterMock

  await ETH_LiquidSDIndexPool.addLSDToken(stETHToken.address, lidoAdapter.address, [10000])
  await ETH_LiquidSDIndexPool.addLSDToken(
    rETHToken.address,
    rocketPoolAdapter.address,
    [7500, 2500]
  )
  await ETH_LiquidSDIndexPool.addLSDToken(
    cbETHToken.address,
    coinbaseAdapter.address,
    [5200, 1800, 3000]
  )
  await ETH_LiquidSDIndexPool.addLSDToken(
    sfrxETHToken.address,
    fraxAdapter.address,
    [4600, 1600, 2700, 1100]
  )

  await stETHToken.transfer(accounts[3], toEther(100))
  await rETHToken.transfer(accounts[3], toEther(100))
  await cbETHToken.transfer(accounts[3], toEther(100))
  await sfrxETHToken.transfer(accounts[3], toEther(100))

  await stETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(10))
  await rETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(10))
  await cbETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(10))
  await sfrxETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(10))

  await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(stETHToken.address, toEther(10))
  await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(rETHToken.address, toEther(10))
  await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(cbETHToken.address, toEther(10))
  await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(sfrxETHToken.address, toEther(10))

  await stETHToken.transfer(accounts[2], toEther(100))
  await rETHToken.transfer(accounts[2], toEther(100))
  await cbETHToken.transfer(accounts[2], toEther(100))
  await sfrxETHToken.transfer(accounts[2], toEther(100))

  // Basic Curve Mock

  const curveMock = (await deploy('CurveMock', [
    LINK_StakingPool.address,
    linkToken.address,
  ])) as CurveMock
  await linkToken.transfer(curveMock.address, toEther(1000))

  updateDeployments({
    CurvePool: curveMock.address,
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
