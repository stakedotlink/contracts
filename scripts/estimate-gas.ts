import { Signer } from 'ethers'
import { deploy, getAccounts, setupToken, toEther } from './utils/helpers'
import {
  Allowance,
  ERC677,
  OwnersRewardsPool,
  OwnersTimeRewardsPool,
  PoolOwners,
  PoolRouter,
  StakingPool,
} from '../typechain-types'
import { ethers } from 'hardhat'

let token: ERC677
let token2: ERC677
let ownersToken: ERC677
let allowanceToken: Allowance
let poolOwners: PoolOwners
let ownersRewards: OwnersRewardsPool
let ownersTimeRewards: OwnersTimeRewardsPool
let poolRouter: PoolRouter
let stakingPool: StakingPool
let strategies: Array<string>
let accounts: string[]
let signers: Signer[]

async function setup() {
  token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
  token2 = (await deploy('ERC677', ['Token 2', 'T2', 1000000000])) as ERC677
  ;({ signers, accounts } = await getAccounts())

  ownersToken = (await deploy('ERC677', ['LinkPool', 'LPL', '100000000'])) as ERC677
  allowanceToken = (await deploy('Allowance', ['Linkpool Allowance', 'LPLA'])) as Allowance

  poolOwners = (await deploy('PoolOwners', [
    ownersToken.address,
    allowanceToken.address,
  ])) as PoolOwners

  ownersRewards = (await deploy('OwnersRewardsPool', [
    poolOwners.address,
    token.address,
    'LinkPool Owners LINK',
    'lpoLINK',
  ])) as OwnersRewardsPool

  ownersTimeRewards = (await deploy('OwnersTimeRewardsPool', [
    poolOwners.address,
    token.address,
    'LinkPool Owners T2',
    'lpoT2',
  ])) as OwnersTimeRewardsPool

  poolRouter = (await deploy('PoolRouter', [allowanceToken.address])) as PoolRouter

  stakingPool = (await deploy('StakingPool', [
    token.address,
    'LinkPool LINK',
    'lpLINK',
    ownersRewards.address,
    '2500',
    poolRouter.address,
  ])) as StakingPool

  strategies = []
  for (let i = 0; i < 5; i++) {
    let strategy = await deploy('ExampleStrategy', [
      token.address,
      stakingPool.address,
      accounts[0],
      toEther(1000),
      toEther(10),
    ])
    await stakingPool.addStrategy(strategy.address)
    strategies.push(strategy.address)
  }

  await allowanceToken.setPoolOwners(poolOwners.address)
  await poolOwners.addToken(token.address, ownersRewards.address)
  await poolOwners.addToken(token2.address, ownersTimeRewards.address)
  await poolRouter.addToken(token.address, stakingPool.address, toEther(10))

  await setupToken(token, accounts)
  await setupToken(ownersToken, accounts)
}

async function main() {
  await setup()
  console.log('**** MAX GAS ESTIMATES (5 strategies) ****\n')

  // PoolOwners
  console.log(
    '\nPoolOwners (OwnersRewardsPool + OwnersTimeRewardsPool)\n****************************'
  )
  console.log(
    'stake (onTokenTransfer) -> ',
    (await ownersToken.estimateGas.transferAndCall(poolOwners.address, toEther(1000), '0x00'))
      .toNumber()
      .toLocaleString()
  )
  await ownersToken.transferAndCall(poolOwners.address, toEther(1000), '0x00')
  await ownersToken.connect(signers[1]).transferAndCall(poolOwners.address, toEther(1000), '0x00')
  await token.transferAndCall(ownersRewards.address, toEther(100), '0x00')
  await token.transferAndCall(
    ownersTimeRewards.address,
    toEther(100),
    ethers.utils.defaultAbiCoder.encode(['uint'], [100])
  )
  console.log(
    'withdrawAllRewards -> ',
    (await poolOwners.estimateGas.withdrawAllRewards()).toNumber().toLocaleString()
  )
  console.log(
    'withdraw -> ',
    (await poolOwners.estimateGas.withdraw(toEther(2))).toNumber().toLocaleString()
  )
  console.log(
    'exit -> ',
    (await poolOwners.connect(accounts[1]).estimateGas.exit()).toNumber().toLocaleString()
  )

  // PoolRouter
  console.log('\nPoolRouter\n****************************')
  console.log(
    'stake - allowance (onTokenTransfer) -> ',
    (await allowanceToken.estimateGas.transferAndCall(poolRouter.address, toEther(1000), '0x00'))
      .toNumber()
      .toLocaleString()
  )
  await allowanceToken.transferAndCall(poolRouter.address, toEther(1000), '0x00')
  console.log(
    'withdrawAllowance -> ',
    (await poolRouter.estimateGas.withdrawAllowance(toEther(10))).toNumber().toLocaleString()
  )
  console.log(
    'stake - asset (onTokenTransfer) -> ',
    (await token.estimateGas.transferAndCall(poolRouter.address, toEther(10000), '0x00'))
      .toNumber()
      .toLocaleString()
  )
  await token.transferAndCall(poolRouter.address, toEther(10000), '0x00')
  console.log(
    'withdraw -> ',
    (await poolRouter.estimateGas.withdraw(token.address, toEther(5000)))
      .toNumber()
      .toLocaleString()
  )

  // StakingPool
  console.log('\nStakingPool\n****************************')
  for (let i = 0; i < strategies.length; i++) {
    await token.transfer(strategies[i], toEther(100))
  }
  console.log(
    'claimStrategyRewards -> ',
    (await stakingPool.estimateGas.claimStrategyRewards()).toNumber().toLocaleString()
  )
  console.log(
    'claimSingleStrategyRewards -> ',
    (await stakingPool.estimateGas.claimSingleStrategyRewards('0')).toNumber().toLocaleString()
  )
  console.log(
    'reorderStrategies -> ',
    (await stakingPool.estimateGas.reorderStrategies([4, 0, 1, 3, 2])).toNumber().toLocaleString()
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
