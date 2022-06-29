//@ts-nocheck

import { ethers } from 'hardhat'
import { assert } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  padBytes,
  concatBytes,
  assertThrowsAsync,
} from './utils/helpers'
import {
  StakingPool,
  WrappedSDToken,
  EthStakingStrategy,
  WrappedETH,
  DepositContract,
  WLOperatorControllerMock,
  NWLOperatorControllerMock,
} from '../typechain-types'
import { Signer } from 'ethers'

const wlOps = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96)]),
}

const nwlOps = {
  keys: concatBytes([padBytes('0xc1', 48), padBytes('0xc2', 48), padBytes('0xc3', 48)]),
  signatures: concatBytes([padBytes('0xd1', 96), padBytes('0xd2', 96), padBytes('0xd3', 96)]),
}

const withdrawalCredentials = padBytes('0x12345', 32)

describe('EthStakingStrategy', () => {
  let wETH: WrappedETH
  let wsdToken: WrappedSDToken
  let stakingPool: StakingPool
  let depositContract: DepositContract
  let wlOperatorController: WLOperatorControllerMock
  let nwlOperatorController: NWLOperatorControllerMock
  let strategy: EthStakingStrategy
  let ownersRewards: string
  let accounts: string[]
  let signers: Signer[]

  async function stake(amount: number) {
    await wETH.wrap({ value: toEther(amount) })
    await stakingPool.stake(accounts[0], toEther(amount))
  }

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
    ownersRewards = accounts[4]
  })

  beforeEach(async () => {
    wETH = (await deploy('WrappedETH')) as WrappedETH

    stakingPool = (await deploy('StakingPool', [
      wETH.address,
      'LinkPool ETH',
      'lplETH',
      ownersRewards,
      '1000',
      accounts[0],
    ])) as StakingPool

    wsdToken = (await deploy('WrappedSDToken', [
      stakingPool.address,
      'Wrapped LinkPool ETH',
      'wlplETH',
    ])) as WrappedSDToken
    await stakingPool.setWSDToken(wsdToken.address)

    depositContract = (await deploy('DepositContract')) as DepositContract

    wlOperatorController = (await deploy('WLOperatorControllerMock', [
      wlOps.keys,
      wlOps.signatures,
    ])) as WLOperatorControllerMock
    nwlOperatorController = (await deploy('NWLOperatorControllerMock', [
      nwlOps.keys,
      nwlOps.signatures,
    ])) as NWLOperatorControllerMock

    strategy = (await deployUpgradeable('EthStakingStrategy', [
      wETH.address,
      stakingPool.address,
      toEther(1000),
      toEther(10),
      depositContract.address,
      wlOperatorController.address,
      nwlOperatorController.address,
      accounts[0],
      withdrawalCredentials,
      1000,
    ])) as EthStakingStrategy

    await stakingPool.addStrategy(strategy.address)
    await wETH.approve(stakingPool.address, ethers.constants.MaxUint256)
    await signers[0].sendTransaction({ to: nwlOperatorController.address, value: toEther(48) })
  })
  /*
  it('should be able to deposit into strategy', async () => {
    await stake(2)
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 2, 'strategy balance incorrect')
  })

  it('should not be able to withdraw from strategy', async () => {
    await stake(2)
    await assertThrowsAsync(async () => {
      await stakingPool.withdraw(accounts[0], toEther(1))
    }, 'revert')
  })

  it('depositEther should work correctly', async () => {
    await stake(200)
    await strategy.depositEther(3)
    await strategy.depositEther(2)

    assert.equal(
      fromEther(await wETH.balanceOf(strategy.address)),
      88,
      'strategy balance incorrect'
    )
    assert.equal(
      fromEther(await ethers.provider.getBalance(depositContract.address)),
      160,
      'deposit contract balance incorrect'
    )
    assert.equal(await strategy.depositedWLValidators(), 2, 'depositWLValidators incorrect')
    assert.equal(await strategy.depositedNWLValidators(), 3, 'depositNWLValidators incorrect')
  })

  it('depositEther should respect balance and max deposit limitations', async () => {
    await stake(100)
    await strategy.depositEther(1)

    assert.equal(
      fromEther(await wETH.balanceOf(strategy.address)),
      68,
      'strategy balance incorrect'
    )
    assert.equal(
      fromEther(await ethers.provider.getBalance(depositContract.address)),
      32,
      'deposit contract balance incorrect'
    )

    await strategy.depositEther(2)
    assert.equal(
      fromEther(await wETH.balanceOf(strategy.address)),
      20,
      'strategy balance incorrect'
    )
    assert.equal(
      fromEther(await ethers.provider.getBalance(depositContract.address)),
      96,
      'deposit contract balance incorrect'
    )

    assert.equal(await strategy.depositedWLValidators(), 2, 'depositWLValidators incorrect')
    assert.equal(await strategy.depositedNWLValidators(), 1, 'depositNWLValidators incorrect')

    await assertThrowsAsync(async () => {
      await strategy.depositEther(1)
    }, 'revert')
  })

  it('depositEther should do nothing if there are no more validators in the queue', async () => {
    await stake(200)
    await strategy.depositEther(10)
    await strategy.depositEther(2)
    assert.equal(
      fromEther(await wETH.balanceOf(strategy.address)),
      88,
      'strategy balance incorrect'
    )
    assert.equal(
      fromEther(await ethers.provider.getBalance(depositContract.address)),
      160,
      'deposit contract balance incorrect'
    )
    assert.equal(await strategy.depositedWLValidators(), 2, 'depositWLValidators incorrect')
    assert.equal(await strategy.depositedNWLValidators(), 3, 'depositNWLValidators incorrect')
  })

  it('reportBeaconState should correctly update values', async () => {
    await stake(200)
    await strategy.depositEther(10)
    await strategy.reportBeaconState(1, 2, toEther(90))

    assert.equal(await strategy.beaconWLValidators(), 1, 'beaconWLValidators incorrect')
    assert.equal(await strategy.beaconNWLValidators(), 2, 'beaconNWLValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 90, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.depositChange()), -6, 'depositChange incorrect')

    await strategy.reportBeaconState(2, 2, toEther(132))

    assert.equal(await strategy.beaconWLValidators(), 2, 'beaconWLValidators incorrect')
    assert.equal(await strategy.beaconNWLValidators(), 2, 'beaconNWLValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 132, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.depositChange()), 4, 'depositChange incorrect')
  })

  it('reportBeaconState data validation should work correctly', async () => {
    await stake(200)
    await strategy.depositEther(10)
    await strategy.reportBeaconState(1, 2, toEther(90))

    await assertThrowsAsync(async () => {
      await strategy.reportBeaconState(0, 2, toEther(90))
    }, 'revert')
    await assertThrowsAsync(async () => {
      await strategy.reportBeaconState(1, 1, toEther(90))
    }, 'revert')
    await assertThrowsAsync(async () => {
      await strategy.reportBeaconState(3, 2, toEther(90))
    }, 'revert')
    await assertThrowsAsync(async () => {
      await strategy.reportBeaconState(1, 4, toEther(90))
    }, 'revert')
  })

  it('reportBeaconState should only be callable by oracle', async () => {
    await stake(200)
    await strategy.depositEther(10)

    await assertThrowsAsync(async () => {
      await strategy.connect(signers[1]).reportBeaconState(1, 2, toEther(90))
    }, 'revert')
  })
  

  it('totalDeposits should return the correct amount', async () => {
    await stake(200)
    await strategy.depositEther(10)

    assert.equal(fromEther(await strategy.totalDeposits()), 200, 'totalDeposits incorrect')

    await strategy.reportBeaconState(1, 2, toEther(70))
    assert.equal(fromEther(await strategy.totalDeposits()), 174, 'totalDeposits incorrect')

    await strategy.reportBeaconState(2, 3, toEther(160))
    assert.equal(fromEther(await strategy.totalDeposits()), 200, 'totalDeposits incorrect')
  })
  */

  it('updateDeposits should correctly distribute rewards', async () => {
    await stake(96)
    await strategy.depositEther(10)
    await strategy.reportBeaconState(2, 1, toEther(98))

    assert.equal(fromEther(await strategy.depositChange()), 2, 'depositChange incorrect')

    await stakingPool.updateStrategyRewards([0])
    assert.equal(
      fromEther(await stakingPool.balanceOf(nwlOperatorController.address)),
      2,
      ' incorrect'
    )
  })

  /*
  it('updateDeposits should distribute nothing if rewards are <= 0', async () => {
    await stake(200)
    await strategy.depositEther(10)


    await strategy.reportBeaconState(2, 3, toEther(70))

  })
  */
})
