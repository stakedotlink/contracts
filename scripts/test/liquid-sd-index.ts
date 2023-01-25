import {
  DelegatorPool,
  ERC677,
  LidoSTETHAdapter,
  LiquidSDIndexPool,
  PoolRouter,
  StakingAllowance,
  StakingPool,
  StrategyMock,
} from '../../typechain-types'
import { deploy, deployUpgradeable, getContract, updateDeployments } from '../utils/deployment'
import { toEther } from '../utils/helpers'
import { padBytes } from '../../test/utils/helpers'

async function main() {
  const sdlToken = (await getContract('SDLToken')) as StakingAllowance
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool
  const poolRouter = (await getContract('PoolRouter')) as PoolRouter

  const ethToken = (await deploy('ERC677', ['ETH', 'ETH', 1000000000])) as ERC677
  console.log('ETH Token deployed: ', ethToken.address)

  const stakingPoolOne = (await deployUpgradeable('StakingPool', [
    ethToken.address,
    'LSD ETH 1',
    'oETH',
    [],
    poolRouter.address,
    delegatorPool.address,
  ])) as StakingPool
  console.log('ETH_StakingPool_1 deployed: ', stakingPoolOne.address)

  const stakingPoolTwo = (await deployUpgradeable('StakingPool', [
    ethToken.address,
    'LSD ETH 2',
    'tETH',
    [],
    poolRouter.address,
    delegatorPool.address,
  ])) as StakingPool
  console.log('ETH_StakingPool_2 deployed: ', stakingPoolTwo.address)

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

  const indexPool = (await deployUpgradeable('LiquidSDIndexPool', [
    'Index ETH',
    'iETH',
    5000,
  ])) as LiquidSDIndexPool
  console.log('LiquidSDIndexPool deployed: ', indexPool.address)

  const wsdToken = await deploy('WrappedSDToken', [indexPool.address, 'Wrapped iETH', 'wiETH'])
  console.log('iETH_WrappedSDToken token deployed: ', wsdToken.address)

  const iETHDelegatorRewardsPool = await deploy('RewardsPoolWSD', [
    delegatorPool.address,
    indexPool.address,
    wsdToken.address,
  ])
  await delegatorPool.addToken(indexPool.address, iETHDelegatorRewardsPool.address)
  console.log('iETH_DelegatorRewardsPool deployed: ', iETHDelegatorRewardsPool.address)

  const adapterOne = (await deployUpgradeable('LidoSTETHAdapter', [
    stakingPoolOne.address,
    indexPool.address,
  ])) as LidoSTETHAdapter
  console.log('LidoSTETHAdapter_oETH deployed: ', adapterOne.address)

  const adapterTwo = (await deployUpgradeable('LidoSTETHAdapter', [
    stakingPoolTwo.address,
    indexPool.address,
  ])) as LidoSTETHAdapter
  console.log('LidoSTETHAdapter_tETH deployed: ', adapterTwo.address)

  await indexPool.addFee(delegatorPool.address, 25)
  console.log('SDL Fee Added')

  await indexPool.addLSDToken(stakingPoolOne.address, adapterOne.address, [10000])
  await indexPool.addLSDToken(stakingPoolTwo.address, adapterTwo.address, [5000, 5000])
  console.log('LSD Tokens Added')

  await ethToken.transferAndCall(poolRouter.address, toEther(1000), padBytes('0x0', 32))
  await ethToken.transferAndCall(poolRouter.address, toEther(1000), padBytes('0x1', 32))
  console.log('Staked in StakingPools')

  await stakingPoolOne.approve(indexPool.address, toEther(1000))
  await stakingPoolTwo.approve(indexPool.address, toEther(1000))
  await indexPool.deposit(stakingPoolOne.address, toEther(500))
  await indexPool.deposit(stakingPoolTwo.address, toEther(500))
  console.log('Deposited in LiquidSDIndexPool')

  updateDeployments(
    {
      ETHToken: ethToken.address,
      SDLToken: sdlToken.address,
      ETH_StakingPool_1: stakingPoolOne.address,
      ETH_StakingPool_2: stakingPoolTwo.address,
      LiquidSDIndexPool: indexPool.address,
      iETH_WrappedSDToken: wsdToken.address,
      iETH_DelegatorRewardsPool: iETHDelegatorRewardsPool.address,
      LidoSTETHAdapter_oETH: adapterOne.address,
      LidoSTETHAdapter_tETH: adapterTwo.address,
    },
    {
      ETHToken: 'ETHToken',
      SDLToken: 'StakingAllowance',
      ETH_StakingPool_1: 'StakingPool',
      ETH_StakingPool_2: 'StakingPool',
      iETH_WrappedSDToken: 'WrappedSDToken',
      iETH_DelegatorRewardsPool: 'RewardsPoolWSD',
      LidoSTETHAdapter_oETH: 'LidoSTETHAdapter',
      LidoSTETHAdapter_tETH: 'LidoSTETHAdapter',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
