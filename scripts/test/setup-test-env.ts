import { updateDeployments, deploy, getContract, deployUpgradeable } from '../utils/deployment'
import { getAccounts, toEther } from '../utils/helpers'

async function preSetup() {
  const { accounts } = await getAccounts()

  // Basic Tokens

  const lplToken = await deploy('ERC677', ['LinkPool', 'LPL', 100000000])
  console.log('LPLToken deployed: ', lplToken.address)

  const linkToken = await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])
  console.log('LINKToken deployed: ', linkToken.address)

  const stETHToken = await deploy('ERC677', ['Lido Staked ETH', 'stETH', 1000000000])
  console.log('stETHToken deployed: ', stETHToken.address)

  const rETHToken = await deploy('ERC677', ['RocketPool rETH', 'rETH', 1000000000])
  console.log('rETHToken deployed: ', rETHToken.address)

  // Multicall

  const multicall = await deploy('Multicall3', [])
  console.log('Multicall3 deployed: ', multicall.address)

  // Deprecated Contracts

  const poolOwners = await deploy('PoolOwnersV1', [lplToken.address])
  console.log('PoolOwners (v1) deployed: ', poolOwners.address)

  const ownersRewardsPoolV1 = await deploy('OwnersRewardsPoolV1', [
    poolOwners.address,
    linkToken.address,
    'LinkPool Owners LINK',
    'lpoLINK',
  ])
  console.log('LINK OwnersRewardsPool (v1) deployed: ', ownersRewardsPoolV1.address)

  const poolAllowance = await deploy('PoolAllowanceV1', [
    'LINK LinkPool Allowance',
    'linkLPLA',
    poolOwners.address,
  ])
  console.log('PoolAllowance (v1) deployed: ', multicall.address)

  let tx = await poolOwners.addRewardToken(
    linkToken.address,
    poolAllowance.address,
    ownersRewardsPoolV1.address
  )
  await tx.wait()

  // ETH Staking

  const lidoWQERC721 = await deploy('LidoWQERC721Mock', [
    [
      [toEther(1), 0, accounts[0], 0, true, false],
      [toEther(3), 0, accounts[1], 0, true, false],
      [toEther(5), 0, accounts[0], 0, true, false],
      [toEther(7), 0, accounts[1], 0, false, false],
      [toEther(8), 0, accounts[2], 0, false, false],
      [toEther(10), 0, accounts[3], 0, false, false],
    ],
    stETHToken.address,
  ])
  console.log('LidoWQERC721 deployed: ', stETHToken.address)

  const stETHCurvePool = await deploy('CurvePoolMock', [toEther(5)])
  console.log('stETH_CurvePool deployed: ', stETHCurvePool.address)

  updateDeployments(
    {
      LPLToken: lplToken.address,
      LINKToken: linkToken.address,
      stETHToken: stETHToken.address,
      rETHToken: rETHToken.address,
      Multicall3: multicall.address,
      PoolOwnersV1: poolOwners.address,
      LINK_OwnersRewardsPoolV1: ownersRewardsPoolV1.address,
      PoolAllowanceV1: poolAllowance.address,
      LidoWQERC721: lidoWQERC721.address,
      stETH_CurvePool: stETHCurvePool.address,
    },
    {
      LPLToken: 'ERC677',
      LINKToken: 'ERC677',
      rETHToken: 'ERC677',
      stETHToken: 'ERC677',
      LINK_OwnersRewardsPoolV1: 'OwnersRewardsPoolV1',
      LidoWQERC721: 'LidoWQERC721Mock',
      stETH_CurvePool: 'CurvePoolMock',
    }
  )
}

async function setupAirdrops() {
  const merkleDistributor = await deploy('MerkleDistributor')
  console.log('MerkleDistributor deployed: ', merkleDistributor.address)

  updateDeployments({
    MerkleDistributor: merkleDistributor.address,
  })
}

async function setupCore() {
  const lplToken = await getContract('LPLToken')

  const sdlToken = await deploy('StakingAllowance', [
    'stake.link', // SDL token name
    'SDL', // SDL token symbol
  ])
  console.log('SDLToken deployed: ', sdlToken.address)

  const lplMigration = await deploy('LPLMigration', [lplToken.address, sdlToken.address])
  console.log('LPLMigration deployed: ', lplMigration.address)

  const delegatorPool = await deployUpgradeable('DelegatorPool', [
    sdlToken.address,
    'Staked SDL', // SDL staking derivative token name
    'stSDL', // SDL staking derivative token symbol
  ])
  console.log('DelegatorPool deployed: ', delegatorPool.address)

  const poolRouter = await deployUpgradeable('PoolRouter', [
    sdlToken.address,
    delegatorPool.address,
  ])
  console.log('PoolRouter deployed: ', poolRouter.address)

  let tx = await delegatorPool.setPoolRouter(poolRouter.address)
  await tx.wait()

  updateDeployments(
    {
      SDLToken: sdlToken.address,
      LPLMigration: lplMigration.address,
      DelegatorPool: delegatorPool.address,
      PoolRouter: poolRouter.address,
    },
    { SDLToken: 'StakingAllowance' }
  )
}

async function setupLINKStaking() {
  const linkToken = await getContract('LINKToken')
  const poolRouter = await getContract('PoolRouter')
  const delegatorPool = await getContract('DelegatorPool')

  const stakingPool = await deployUpgradeable('StakingPool', [
    linkToken.address,
    'Staked LINK', // LINK staking derivative token name
    'stLINK', // LINK staking derivative token symbol
    [['0x6879826450e576B401c4dDeff2B7755B1e85d97c', 300]], // fee receivers & percentage amounts in basis points
    poolRouter.address,
    delegatorPool.address,
  ])
  console.log('LINK_StakingPool deployed: ', stakingPool.address)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.address,
    'Wrapped stLINK', // wrapped staking derivative token name
    'wstLINK', // wrapped staking derivative token symbol
  ])
  console.log('LINK_WrappedSDToken token deployed: ', wsdToken.address)

  const stLinkDelegatorRewardsPool = await deploy('RewardsPoolWSD', [
    delegatorPool.address,
    stakingPool.address,
    wsdToken.address,
  ])
  console.log('stLINK_DelegatorRewardsPool deployed: ', stLinkDelegatorRewardsPool.address)

  const strategy = await deployUpgradeable('StrategyMock', [
    linkToken.address,
    stakingPool.address,
    toEther(1000000),
    toEther(10),
  ])
  console.log('LINK_Strategy deployed: ', strategy.address)

  let tx = await poolRouter.addPool(stakingPool.address, 0, true)
  await tx.wait()

  tx = await delegatorPool.addToken(stakingPool.address, stLinkDelegatorRewardsPool.address)
  await tx.wait()

  tx = await stakingPool.addStrategy(strategy.address)
  await tx.wait()

  updateDeployments(
    {
      LINK_StakingPool: stakingPool.address,
      LINK_WrappedSDToken: wsdToken.address,
      stLINK_DelegatorRewardsPool: stLinkDelegatorRewardsPool.address,
      LINK_Strategy: strategy.address,
    },
    {
      LINK_StakingPool: 'StakingPool',
      LINK_WrappedSDToken: 'WrappedSDToken',
      stLINK_DelegatorRewardsPool: 'RewardsPoolWSD',
      LINK_Strategy: 'StrategyMock',
    }
  )
}

async function setupETHStaking() {
  const poolRouter = await getContract('PoolRouter')
  const delegatorPool = await getContract('DelegatorPool')
  const stETHToken = await getContract('stETHToken')

  // Core ETH Staking

  const wETHToken = await deploy('WrappedETH')
  console.log('wETHToken deployed: ', wETHToken.address)

  const stakingPool = await deployUpgradeable('StakingPool', [
    wETHToken.address,
    'stake.link ETH', // ETH staking derivative token name
    'sdlETH', // ETH staking derivative token symbol
    [], // fee receivers & percentage amounts in basis points
    poolRouter.address,
    delegatorPool.address,
  ])
  console.log('ETH_StakingPool deployed: ', stakingPool.address)

  const wsdToken = await deploy('WrappedSDToken', [
    stakingPool.address,
    'Wrapped sdlETH', // wrapped staking derivative token name
    'wsdlETH', // wrapped staking derivative token symbol
  ])
  console.log('ETH_WrappedSDToken token deployed: ', wsdToken.address)

  const sdlETHDelegatorRewardsPool = await deploy('RewardsPoolWSD', [
    delegatorPool.address,
    stakingPool.address,
    wsdToken.address,
  ])
  console.log('sdlETH_DelegatorRewardsPool deployed: ', sdlETHDelegatorRewardsPool.address)

  let tx = await poolRouter.setWrappedETH(wETHToken.address)
  await tx.wait()

  tx = await poolRouter.addPool(stakingPool.address, 0, true)
  await tx.wait()

  tx = await delegatorPool.addToken(stakingPool.address, sdlETHDelegatorRewardsPool.address)
  await tx.wait()

  updateDeployments(
    {
      wETHToken: wETHToken.address,
      ETH_StakingPool: stakingPool.address,
      ETH_WrappedSDToken: wsdToken.address,
      sdlETH_DelegatorRewardsPool: sdlETHDelegatorRewardsPool.address,
    },
    {
      wETHToken: 'WrappedETH',
      ETH_StakingPool: 'StakingPool',
      ETH_WrappedSDToken: 'WrappedSDToken',
      sdlETH_DelegatorRewardsPool: 'RewardsPoolWSD',
    }
  )

  // ETH Withdrawal Strategy

  const ethWithdrawalStrategy = await deployUpgradeable('ETHWithdrawalStrategy', [
    wETHToken.address,
    stakingPool.address,
    toEther(500), // minimum value for dynamic max deposit limit
    5000, // basis point target of total deposits that should be in use at any given time
  ])
  console.log('ETH_WithdrawalStrategy deployed: ', ethWithdrawalStrategy.address)

  const curveFee = await deploy('CurveFee', [
    '0xdc24316b9ae028f1497c275eb9192a3ea0f67022', // address of curve pool
    1, // index of stETH in curve pool
    0, // index of ETH in curve pool
    10, // minimum fee basis point fee to be paid on withdrawals
    500, // maximum basis point fee to be paid on withdrawals
    1000, // basis point amount to be subtracted off the current curve fee when calculating a withdrawal fee
  ])
  console.log('ETH_stETH_CurveFee deployed: ', curveFee.address)

  const lidoWithdrawalAdapter = await deployUpgradeable('LidoWithdrawalAdapter', [
    ethWithdrawalStrategy.address,
    curveFee.address,
    '0x0000000000000000000000000000000000000001', // address of Lido withdrawal queue ERC721
    stETHToken.address,
    9000, // basis point amount of ETH instantly received when initiating a withdrawal
    toEther(0.1), // minimum ETH withdrawal amount
  ])
  console.log('ETH_LidoWithdrawalAdapter deployed: ', ethWithdrawalStrategy.address)

  tx = await ethWithdrawalStrategy.addAdapter(lidoWithdrawalAdapter.address)
  await tx.wait()

  tx = await stakingPool.addStrategy(ethWithdrawalStrategy.address)
  await tx.wait()

  updateDeployments(
    {
      ETH_WithdrawalStrategy: ethWithdrawalStrategy.address,
      ETH_stETH_CurveFee: curveFee.address,
      ETH_LidoWithdrawalAdapter: lidoWithdrawalAdapter.address,
    },
    {
      ETH_WithdrawalStrategy: 'ETHWithdrawalStrategy',
      ETH_stETH_CurveFee: 'CurveFee',
      ETH_LidoWithdrawalAdapter: 'LidoWithdrawalAdapter',
    }
  )
}

async function setupETHLiquidSDIndexPool() {
  const stETHToken = await getContract('stETHToken')
  const rETHToken = await getContract('rETHToken')

  const indexPool = await deployUpgradeable('LiquidSDIndexPool', [
    'Staked ETH Index', // index token name
    'ixETH', // index token symbol
    5000, // percentage swing that any lsd can have from its composition target in either direction
    toEther(500), // total amount of deposits required for composition targets to be enforced
    [['0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D', 25]], // fee receivers & percentage amounts in basis points
    100, // withdrawal fee that goes to ixETH holders
  ])
  console.log('ETH_LiquidSDIndexPool deployed: ', indexPool.address)

  const wsdToken = await deploy('WrappedSDToken', [
    indexPool.address,
    'Wrapped ixETH', // Wrapped ixETH token name
    'wixETH', // Wrapped ixETH token symbol
  ])
  console.log('ixETH_WrappedSDToken token deployed: ', wsdToken.address)

  const lidoAdapter = await deployUpgradeable('LSDIndexAdapterMock', [
    stETHToken.address,
    indexPool.address,
    toEther(1),
  ])
  console.log('ixETH_LidoLSDIndexAdapter token deployed: ', lidoAdapter.address)

  const rocketPoolAdapter = await deployUpgradeable('LSDIndexAdapterMock', [
    rETHToken.address,
    indexPool.address,
    toEther(1.2),
  ])
  console.log('ixETH_RocketPoolLSDIndexAdapter token deployed: ', rocketPoolAdapter.address)

  await indexPool.addLSDToken(stETHToken.address, lidoAdapter.address, [10000])
  await indexPool.addLSDToken(rETHToken.address, rocketPoolAdapter.address, [7500, 2500])

  updateDeployments(
    {
      ixETH_WrappedSDToken: wsdToken.address,
      ETH_LiquidSDIndexPool: indexPool.address,
      ixETH_LidoLSDIndexAdapter: lidoAdapter.address,
      ixETH_RocketPoolLSDIndexAdapter: rocketPoolAdapter.address,
    },
    {
      ixETH_WrappedSDToken: 'WrappedSDToken',
      ETH_LiquidSDIndexPool: 'LiquidSDIndexPool',
      ixETH_LidoLSDIndexAdapter: 'LidoLSDIndexAdapter',
      ixETH_RocketPoolLSDIndexAdapter: 'RocketPoolLSDIndexAdapter',
    }
  )
}

async function setupAccounts() {
  const { accounts, signers } = await getAccounts()

  const linkToken = await getContract('LINKToken')
  const wETHToken = await getContract('wETHToken')
  const sdlToken = await getContract('SDLToken')
  const lplToken = await getContract('LPLToken')
  const stETHToken = await getContract('stETHToken')
  const rETHToken = await getContract('rETHToken')
  const delegatorPool = await getContract('DelegatorPool')
  const poolRouter = await getContract('PoolRouter')
  const ethLSDIndexPool = await getContract('ETH_LiquidSDIndexPool')
  const linkStakingPool = await getContract('LINK_StakingPool')
  const linkStakingStrategy = await getContract('LINK_Strategy')
  const ethStakingPool = await getContract('ETH_StakingPool')
  const ethStakingStrategy = await getContract('ETH_WithdrawalStrategy')

  // Account 2 - holds SDL/LPL/LINK/stETH/rETH with no staked assets
  await sdlToken.mint(accounts[2], toEther(10000))
  await lplToken.transfer(accounts[2], toEther(10000))
  await linkToken.transfer(accounts[2], toEther(10000))
  await stETHToken.transfer(accounts[2], toEther(10000))
  await rETHToken.transfer(accounts[2], toEther(10000))

  // Account 3 - holds SDL/LPL/LINK/stETH/rETH and stSDL/stLINK/sdlETH/ixETH and has stLINK/sdlETH rewards
  await sdlToken.mint(accounts[3], toEther(10000))
  await lplToken.transfer(accounts[3], toEther(10000))
  await linkToken.transfer(accounts[3], toEther(10000))
  await stETHToken.transfer(accounts[3], toEther(10000))
  await rETHToken.transfer(accounts[3], toEther(10000))

  await sdlToken.connect(signers[3]).transferAndCall(delegatorPool.address, toEther(1000), '0x')
  await linkToken.connect(signers[3]).transferAndCall(poolRouter.address, toEther(100), '0x')
  await poolRouter.connect(signers[3]).stakeETH(0, { value: toEther(10) })
  await stETHToken.connect(signers[3]).approve(ethLSDIndexPool.address, toEther(100))
  await ethLSDIndexPool.connect(signers[3]).deposit(stETHToken.address, toEther(100))
  await rETHToken.connect(signers[3]).approve(ethLSDIndexPool.address, toEther(50))
  await ethLSDIndexPool.connect(signers[3]).deposit(rETHToken.address, toEther(50))

  await linkToken.transfer(linkStakingStrategy.address, toEther(100))
  await linkStakingPool.updateStrategyRewards([0])
  await wETHToken.wrap({ value: toEther(10) })
  await wETHToken.transfer(ethStakingStrategy.address, toEther(10))
  await ethStakingPool.updateStrategyRewards([0])

  // Testnet Accounts
  const wallets = [
    {
      address: '0xE4Eeea0393E0b0d1e097a238DefD0e8ee799312c',
      privateKey: '0x5f68dac9e41b539e5c555dc5554e9a305c88ec06f3b990468396c82059ca9712',
    },
    {
      address: '0x0b61D3a0fEc3311Fa4B301cb17F860afF7CA80d1',
      privateKey: '0xd3b68b6fea9d1be0720374b7956e120a4e018ec62d66b11a0e82020fcdac4b6e',
    },
    {
      address: '0x23A758bBD7D6330596C11651F222ea02C4Cc634b',
      privateKey: '0x2f88fe4f3297c9e211948342827861e357312537898328b3a1388dd798b275a0',
    },
    {
      address: '0xc41C64fa8360AF65e979c6f20B7d51635fDa9AE0',
      privateKey: '0x56637f73bb73685c72d37abb6ce283dbe62d7d10cd26927397b0b1fb878e6c4a',
    },
    {
      address: '0x775A0B356f736A327c75f4016B5496B2466745F0',
      privateKey: '0xd21109f83d2462380cfc04cf30ab8dbde69d015d5d8b45cb47daf3d0dbacb61d',
    },
    {
      address: '0x427f7a3cD31C5f17C0B10000A8D827bd39995FE3',
      privateKey: '0x9cfb6412af721e7a6c267fe85db3c2b163ee9370507cf609bab81a779e0465e7',
    },
    {
      address: '0xB204655d377C8DD53539EE6785882A5bFeF8E6cE',
      privateKey: '0xe4340cf299dfc21473058559ecaa79ef2ab0ad3f6036120f0e7fa264e07d1352',
    },
    {
      address: '0xe2A449CeaD45dbEAf1C0a8fA043C9d993818b2e6',
      privateKey: '0x93c2038e51745251843a5f571ca61c3d486292a9abe69d5e9160f983e3288822',
    },
    {
      address: '0xc0B3eEabc79EfE603e497c647e57Ed9821c37166',
      privateKey: '0xe2f2a3a9f5689d55a5013e4b9ab53eaba96908c19dc907b504bc37c8f1cc8955',
    },
    {
      address: '0x8CA69d88C5cB3442074Ba03b5ebc0a7865e167E4',
      privateKey: '0xe02795be0058d763a04ed87f2294599be9ae03becf7478f0fc00eb8395e5e4b4',
    },
    {
      address: '0xa22e847d9b400eB3e7ADcAdE54A3e8eA4B5f5D6B',
      privateKey: '0xf6e48c2e3e8fe34d17a2f6f39cba305b49f80796df9aea412fe11b90d516e117',
    },
    {
      address: '0xD180078aB0E584449e7c74F53Ed05f046657f54d',
      privateKey: '0xbb070c0b217a7c69fec2ee988d7f7e14765fd4a37f65fc8a73a32435a0b2c673',
    },
    {
      address: '0xeB16c783669F1A76561Dad6318BAdc8c750804B9',
      privateKey: '0x8c87992c350a70e1558a7ec40f21560387e65874ef24917126464d5b248cb8af',
    },
    {
      address: '0x77814A2Fc416a0224C9794686ed335CA78BD5bc3',
      privateKey: '0xafbe98f01460d18c482a2021ee3421ec1d4a6190cfc472cad524acdde5166a31',
    },
    {
      address: '0x4098363f0cBF1bC935D23caFae5924572cF601d8',
      privateKey: '0xc631bf5ba085f9796aeac0576837062fcf9a61caa75f59a6234c25d6f7d380bc',
    },
    {
      address: '0x3542D7a5101385dFc0D8b9cF7aDF2768F34e55CE',
      privateKey: '0x3b2826a764a3bdbc1ecaaa3cf65b819e38ad0d781fca8c2a33613599e3641564',
    },
    {
      address: '0x63886410ACA8950c4c92F67C1e8d10732090A0F5',
      privateKey: '0xf557f94f7bb96608509933d8620b0356bc5c0f04716d93c69ef1d496c5668cc7',
    },
    {
      address: '0xC7Ae4ec7bC91f3C38CeDD51bB95189e5Ce9Aa1c7',
      privateKey: '0xc502f7b90aa03830fbfe15de6b497d6804aab1ed3f1fcd12ee0db8363de2f5ae',
    },
    {
      address: '0xddA84Aa1BfC2577D69CFa78A49217b98553f6D32',
      privateKey: '0x4a176d20b52c6c3d3451126f78a0bfc6b6f291394397daa706adfd615aef73b6',
    },
  ]

  for (let i = 0; i < wallets.length; i++) {
    const { address } = wallets[i]
    await signers[0].sendTransaction({
      to: address,
      value: toEther(100),
    })
    await sdlToken.mint(address, toEther(10000))
    await lplToken.transfer(address, toEther(10000))
    await linkToken.transfer(address, toEther(10000))
    await stETHToken.transfer(address, toEther(10000))
    await rETHToken.transfer(address, toEther(10000))
  }
}

async function main() {
  console.log('\nSetting up base contracts...\n')
  await preSetup()
  console.log('\nSetting up airdrop contracts...\n')
  await setupAirdrops()
  console.log('\nSetting up core contracts...\n')
  await setupCore()
  console.log('\nSetting up LINK staking contracts...\n')
  await setupLINKStaking()
  console.log('\nSetting up ETH staking contracts...\n')
  await setupETHStaking()
  console.log('\nSetting up ETH LSD Index contracts...\n')
  await setupETHLiquidSDIndexPool()
  console.log('\nSetting up accounts...\n')
  await setupAccounts()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
