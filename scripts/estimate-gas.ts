import { ethers } from 'hardhat'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  padBytes,
  concatBytes,
} from '../test/utils/helpers'
import {
  StakingPool,
  WrappedSDToken,
  EthStakingStrategy,
  WrappedETH,
  DepositContract,
  WLOperatorController,
  NWLOperatorController,
  OperatorWhitelistMock,
  RewardsPool,
} from '../typechain-types'

const wlOps = {
  keys: [padBytes('0xc1', 48), padBytes('0xc2', 48), padBytes('0xc3', 48)],
  signatures: [padBytes('0xd1', 96), padBytes('0xd2', 96), padBytes('0xd3', 96)],
}

const withdrawalCredentials = padBytes('0x12345', 32)

let wETH: WrappedETH
let wsdToken: WrappedSDToken
let stakingPool: StakingPool
let depositContract: DepositContract
let nwlOperatorController: NWLOperatorController
let wlOperatorController: WLOperatorController
let nwlRewardsPool: RewardsPool
let wlRewardsPool: RewardsPool
let strategy: EthStakingStrategy
let ownersRewards: string
let accounts: string[]

async function stake(amount: number) {
  await wETH.wrap({ value: toEther(amount) })
  await stakingPool.stake(accounts[0], toEther(amount))
}

async function setup() {
  ;({ accounts } = await getAccounts())
  ownersRewards = accounts[4]

  wETH = (await deploy('WrappedETH')) as WrappedETH

  stakingPool = (await deploy('StakingPool', [
    wETH.address,
    'LinkPool ETH',
    'lplETH',
    [[ownersRewards, '1000']],
    accounts[0],
  ])) as StakingPool

  wsdToken = (await deploy('WrappedSDToken', [
    stakingPool.address,
    'Wrapped LinkPool ETH',
    'wlplETH',
  ])) as WrappedSDToken
  await stakingPool.setWSDToken(wsdToken.address)

  depositContract = (await deploy('DepositContract')) as DepositContract

  strategy = (await deployUpgradeable('EthStakingStrategy', [
    wETH.address,
    stakingPool.address,
    toEther(1000),
    toEther(10),
    depositContract.address,
    withdrawalCredentials,
    1000,
  ])) as EthStakingStrategy
  await strategy.setBeaconOracle(accounts[0])

  nwlOperatorController = (await deployUpgradeable('NWLOperatorController', [
    strategy.address,
    wsdToken.address,
  ])) as NWLOperatorController
  await nwlOperatorController.setKeyValidationOracle(accounts[0])
  await nwlOperatorController.setBeaconOracle(accounts[0])

  let operatorWhitelist = (await deploy('OperatorWhitelistMock', [
    [accounts[0]],
  ])) as OperatorWhitelistMock
  wlOperatorController = (await deployUpgradeable('WLOperatorController', [
    strategy.address,
    wsdToken.address,
    operatorWhitelist.address,
    2,
  ])) as WLOperatorController
  await wlOperatorController.setKeyValidationOracle(accounts[0])
  await wlOperatorController.setBeaconOracle(accounts[0])

  nwlRewardsPool = (await deploy('RewardsPool', [
    nwlOperatorController.address,
    wsdToken.address,
    'test',
    'test',
  ])) as RewardsPool
  wlRewardsPool = (await deploy('RewardsPool', [
    wlOperatorController.address,
    wsdToken.address,
    'test',
    'test',
  ])) as RewardsPool

  await nwlOperatorController.setRewardsPool(nwlRewardsPool.address)
  await wlOperatorController.setRewardsPool(wlRewardsPool.address)

  for (let i = 0; i < 5; i++) {
    await wlOperatorController.addOperator('test')
  }

  await strategy.setNWLOperatorController(nwlOperatorController.address)
  await strategy.setWLOperatorController(wlOperatorController.address)
  await strategy.setDepositController(accounts[0])
  await stakingPool.addStrategy(strategy.address)
  await wETH.approve(stakingPool.address, ethers.constants.MaxUint256)
}

async function main() {
  await setup()

  console.log(
    'addKeyPairs (18 pairs) -> ',
    (
      await wlOperatorController.estimateGas.addKeyPairs(
        0,
        18,
        concatBytes([
          ...wlOps.keys,
          ...wlOps.keys,
          ...wlOps.keys,
          ...wlOps.keys,
          ...wlOps.keys,
          ...wlOps.keys,
        ]),
        concatBytes([
          ...wlOps.signatures,
          ...wlOps.signatures,
          ...wlOps.signatures,
          ...wlOps.signatures,
          ...wlOps.signatures,
          ...wlOps.signatures,
        ])
      )
    )
      .toNumber()
      .toLocaleString()
  )

  await wlOperatorController.addKeyPairs(
    0,
    18,
    concatBytes([
      ...wlOps.keys,
      ...wlOps.keys,
      ...wlOps.keys,
      ...wlOps.keys,
      ...wlOps.keys,
      ...wlOps.keys,
    ]),
    concatBytes([
      ...wlOps.signatures,
      ...wlOps.signatures,
      ...wlOps.signatures,
      ...wlOps.signatures,
      ...wlOps.signatures,
      ...wlOps.signatures,
    ])
  )
  await wlOperatorController.initiateKeyPairValidation(accounts[0], 0)
  await wlOperatorController.reportKeyPairValidation(0, true)

  await stake(700)

  console.log(
    'depositEther (18 validators) -> ',
    (await strategy.estimateGas.depositEther(0, 18, [0], [18])).toNumber().toLocaleString()
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
