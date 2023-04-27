import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  padBytes,
  concatBytes,
  fromEther,
} from '../utils/helpers'
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
  DepositController,
} from '../../typechain-types'
import { Signer } from 'ethers'

const pubkeyLength = 48 * 2

const nwlOps = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96)]),
}

const wlOps = {
  keys: concatBytes([padBytes('0xc1', 48), padBytes('0xc2', 48), padBytes('0xc3', 48)]),
  signatures: concatBytes([padBytes('0xd1', 96), padBytes('0xd2', 96), padBytes('0xd3', 96)]),
}

const withdrawalCredentials = padBytes('0x12345', 32)

describe('DepositController', () => {
  let wETH: WrappedETH
  let wsdToken: WrappedSDToken
  let stakingPool: StakingPool
  let depositContract: DepositContract
  let nwlOperatorController: NWLOperatorController
  let wlOperatorController: WLOperatorController
  let nwlRewardsPool: RewardsPool
  let wlRewardsPool: RewardsPool
  let strategy: EthStakingStrategy
  let depositController: DepositController
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
  })

  beforeEach(async () => {
    wETH = (await deploy('WrappedETH')) as WrappedETH

    stakingPool = (await deployUpgradeable('StakingPool', [
      wETH.address,
      'LinkPool ETH',
      'lplETH',
      [],
      accounts[0],
      accounts[0],
    ])) as StakingPool

    wsdToken = (await deploy('WrappedSDToken', [
      stakingPool.address,
      'Wrapped LinkPool ETH',
      'wlplETH',
    ])) as WrappedSDToken

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
      toEther(16),
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
    ])) as RewardsPool
    wlRewardsPool = (await deploy('RewardsPool', [
      wlOperatorController.address,
      wsdToken.address,
    ])) as RewardsPool

    await nwlOperatorController.setRewardsPool(nwlRewardsPool.address)
    await wlOperatorController.setRewardsPool(wlRewardsPool.address)

    for (let i = 0; i < 5; i++) {
      await nwlOperatorController.addOperator('test')
      await nwlOperatorController.addKeyPairs(i, 2, nwlOps.keys, nwlOps.signatures, {
        value: toEther(16 * 2),
      })
      await wlOperatorController.addOperator('test')
      await wlOperatorController.addKeyPairs(i, 3, wlOps.keys, wlOps.signatures)

      if (i % 3 == 0) {
        await nwlOperatorController.initiateKeyPairValidation(accounts[0], i)
        await nwlOperatorController.reportKeyPairValidation(i, true)
        await wlOperatorController.initiateKeyPairValidation(accounts[0], i)
        await wlOperatorController.reportKeyPairValidation(i, true)
      }
    }

    depositController = (await deploy('DepositController', [
      depositContract.address,
      strategy.address,
    ])) as DepositController

    await strategy.setDepositController(depositController.address)
    await strategy.addOperatorController(nwlOperatorController.address)
    await strategy.addOperatorController(wlOperatorController.address)
    await stakingPool.addStrategy(strategy.address)
    await wETH.approve(stakingPool.address, ethers.constants.MaxUint256)
  })

  it('getNextValidators should work correctly', async () => {
    let [
      depositRoot,
      operatorStateHash,
      depositAmounts,
      validatorsAssigned,
      operatorIds,
      validatorCounts,
      keys,
    ] = await depositController.getNextValidators(7)

    assert.equal(depositRoot, await depositContract.get_deposit_root(), 'depositRoot incorrect')
    assert.equal(
      operatorStateHash,
      ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ['bytes32', 'bytes32'],
          [
            ethers.utils.keccak256(
              ethers.utils.solidityPack(
                ['bytes32', 'bytes32'],
                [
                  ethers.utils.keccak256(ethers.utils.toUtf8Bytes('initialState')),
                  await nwlOperatorController.currentStateHash(),
                ]
              )
            ),
            await wlOperatorController.currentStateHash(),
          ]
        )
      ),
      'operatorStateHash incorrect'
    )
    assert.deepEqual(
      depositAmounts.map((v) => fromEther(v)),
      [16, 0],
      'validatorsAssigned incorrect'
    )
    assert.deepEqual(
      validatorsAssigned.map((v) => v.toNumber()),
      [4, 2],
      'validatorsAssigned incorrect'
    )
    assert.deepEqual(
      operatorIds.map((ids) => ids.map((id) => id.toNumber())),
      [[], [0]],
      'operatorIds incorrect'
    )
    assert.deepEqual(
      validatorCounts.map((counts) => counts.map((count) => count.toNumber())),
      [[], [2]],
      'validatorCounts incorrect'
    )
    assert.equal(
      keys,
      nwlOps.keys + nwlOps.keys.slice(2) + wlOps.keys.slice(2, 2 * pubkeyLength + 2),
      'keys incorrect'
    )

    await expect(depositController.getNextValidators(11)).to.be.revertedWith(
      'InsufficientValidatorsInQueue()'
    )
  })

  it('depositEther should work correctly', async () => {
    type DepositData = [string, string, number[], number[], number[][], number[][]]
    await wETH.wrap({ value: toEther(1000) })
    await stakingPool.stake(accounts[0], toEther(1000))

    let depositData = (await depositController.getNextValidators(1)).slice(0, -1) as DepositData
    await expect(
      depositController.connect(signers[1]).depositEther(...depositData)
    ).to.be.revertedWith('Ownable: caller is not the owner')

    await depositController.depositEther(...depositData)
    await expect(depositController.depositEther(...depositData)).to.be.revertedWith(
      'DepositRootChanged()'
    )

    depositData = (await depositController.getNextValidators(7)).slice(0, -1) as DepositData
    await nwlOperatorController.addKeyPairs(0, 2, nwlOps.keys, nwlOps.signatures, {
      value: toEther(16 * 2),
    })
    await expect(depositController.depositEther(...depositData)).to.be.revertedWith(
      'OperatorStateHashChanged()'
    )

    depositData = (await depositController.getNextValidators(7)).slice(0, -1) as DepositData
    await wlOperatorController.addKeyPairs(0, 3, wlOps.keys, wlOps.signatures)
    await expect(depositController.depositEther(...depositData)).to.be.revertedWith(
      'OperatorStateHashChanged()'
    )
    depositData = (await depositController.getNextValidators(7)).slice(0, -1) as DepositData
    await depositController.depositEther(...depositData)

    assert.equal(await depositContract.get_deposit_count(), '0x0800000000000000')
  })
})
