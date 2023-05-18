import { getAccounts, toEther } from '../utils/helpers'
import { getContract, deployUpgradeable, deploy, updateDeployments } from '../utils/deployment'
import {
  CurveMock,
  DelegatorPool,
  ERC20,
  ERC677,
  LiquidSDIndexPool,
  LPLMigration,
  LSDIndexAdapterMock,
  PoolRouter,
  StakingAllowance,
  StakingPool,
  StrategyMock,
} from '../../typechain-types'

/*
Accounts:
0 - main account that holds most of the tokens. Do not test ui with this account.
1 - holds no tokens
2 - holds SDL/LPL/LINK/stETH/rETH with no staked assets
3 - holds SDL/LPL/LINK/stETH/rETH and stSDL/stLINK/ixETH and has stLINK rewards
*/

async function main() {
  const { signers, accounts } = await getAccounts()
  const linkToken = (await getContract('LINKToken')) as ERC677
  const lplToken = (await getContract('LPLToken')) as ERC677
  const sdlToken = (await getContract('SDLToken')) as StakingAllowance
  const poolRouter = (await getContract('PoolRouter')) as PoolRouter
  const lplMigration = (await getContract('LPLMigration')) as LPLMigration
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const LINK_StakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const ETH_LiquidSDIndexPool = (await getContract('ETH_LiquidSDIndexPool')) as LiquidSDIndexPool
  const stETHToken = (await getContract('stETHToken')) as ERC20
  const rETHToken = (await getContract('rETHToken')) as ERC20
  const cbETHToken = (await getContract('cbETHToken')) as ERC20
  const sfrxETHToken = (await getContract('sfrxETHToken')) as ERC20

  // LPL Migration

  await sdlToken.mint(lplMigration.address, toEther(150000))

  // LINK Staking

  const strategyMockLINK = (await deployUpgradeable('StrategyMock', [
    linkToken.address,
    LINK_StakingPool.address,
    toEther(1000000),
    toEther(10),
  ])) as StrategyMock
  await LINK_StakingPool.addStrategy(strategyMockLINK.address)

  // ETH Liquid SD Index

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

  updateDeployments(
    {
      ixETH_CoinbaseLSDIndexAdapter: coinbaseAdapter.address,
      ixETH_FraxLSDIndexAdapter: fraxAdapter.address,
    },
    {
      ixETH_CoinbaseLSDIndexAdapter: 'CoinbaseLSDIndexAdapter',
      ixETH_FraxLSDIndexAdapter: 'FraxLSDIndexAdapter',
    }
  )

  // Account 2 - holds SDL/LPL/LINK/stETH/rETH/cbETH/sfrxETH with no staked assets

  await sdlToken.mint(accounts[2], toEther(10000))
  await lplToken.transfer(accounts[2], toEther(10000))
  await linkToken.transfer(accounts[2], toEther(10000))
  await stETHToken.transfer(accounts[2], toEther(10000))
  await rETHToken.transfer(accounts[2], toEther(10000))
  await cbETHToken.transfer(accounts[2], toEther(10000))
  await sfrxETHToken.transfer(accounts[2], toEther(10000))

  // Account 3 - holds SDL/LPL/LINK/stETH/rETH/cbETH/sfrxETH and stSDL/stLINK/ixETH and has stLINK rewards

  await sdlToken.mint(accounts[3], toEther(10000))
  await lplToken.transfer(accounts[3], toEther(10000))
  await linkToken.transfer(accounts[3], toEther(10000))
  await stETHToken.transfer(accounts[3], toEther(10000))
  await rETHToken.transfer(accounts[3], toEther(10000))
  await cbETHToken.transfer(accounts[3], toEther(10000))
  await sfrxETHToken.transfer(accounts[3], toEther(10000))

  await sdlToken.connect(signers[3]).transferAndCall(delegatorPool.address, toEther(1000), '0x')
  await linkToken.connect(signers[3]).transferAndCall(poolRouter.address, toEther(100), '0x')
  await stETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(100))
  await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(stETHToken.address, toEther(100))
  await rETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(50))
  await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(rETHToken.address, toEther(50))
  await cbETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(50))
  await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(cbETHToken.address, toEther(50))
  await sfrxETHToken.connect(signers[3]).approve(ETH_LiquidSDIndexPool.address, toEther(50))
  await ETH_LiquidSDIndexPool.connect(signers[3]).deposit(sfrxETHToken.address, toEther(50))

  await linkToken.transfer(strategyMockLINK.address, toEther(100))
  await LINK_StakingPool.updateStrategyRewards([0])

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
