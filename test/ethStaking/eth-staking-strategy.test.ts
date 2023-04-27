import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  padBytes,
  concatBytes,
  assertThrowsAsync,
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
  RewardsReceiver,
  DelegatorPoolMock,
} from '../../typechain-types'
import { Signer } from 'ethers'

const depositAmount = '0x0040597307000000'

const nwlOps = {
  keys: [padBytes('0xa1', 48), padBytes('0xa2', 48)],
  signatures: [padBytes('0xb1', 96), padBytes('0xb2', 96)],
}

const wlOps = {
  keys: [padBytes('0xc1', 48), padBytes('0xc2', 48), padBytes('0xc3', 48)],
  signatures: [padBytes('0xd1', 96), padBytes('0xd2', 96), padBytes('0xd3', 96)],
}

const withdrawalCredentials = padBytes('0x12345', 32)

describe('EthStakingStrategy', () => {
  let wETH: WrappedETH
  let wsdToken: WrappedSDToken
  let stakingPool: StakingPool
  let depositContract: DepositContract
  let rewardsReceiver: RewardsReceiver
  let nwlOperatorController: NWLOperatorController
  let wlOperatorController: WLOperatorController
  let nwlRewardsPool: RewardsPool
  let wlRewardsPool: RewardsPool
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

    let delegatorPool = (await deploy('DelegatorPoolMock', [wETH.address, 0])) as DelegatorPoolMock

    stakingPool = (await deployUpgradeable('StakingPool', [
      wETH.address,
      'LinkPool ETH',
      'lplETH',
      [
        [ownersRewards, 1000],
        [delegatorPool.address, 2000],
      ],
      accounts[0],
      delegatorPool.address,
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
      stakingPool.address,
      toEther(16),
    ])) as NWLOperatorController
    await nwlOperatorController.setKeyValidationOracle(accounts[0])
    await nwlOperatorController.setBeaconOracle(accounts[0])

    let operatorWhitelist = (await deploy('OperatorWhitelistMock', [
      [accounts[0]],
    ])) as OperatorWhitelistMock
    wlOperatorController = (await deployUpgradeable('WLOperatorController', [
      strategy.address,
      stakingPool.address,
      operatorWhitelist.address,
      2,
    ])) as WLOperatorController
    await wlOperatorController.setKeyValidationOracle(accounts[0])
    await wlOperatorController.setBeaconOracle(accounts[0])

    nwlRewardsPool = (await deploy('RewardsPoolWSD', [
      nwlOperatorController.address,
      stakingPool.address,
      wsdToken.address,
    ])) as RewardsPool
    wlRewardsPool = (await deploy('RewardsPoolWSD', [
      wlOperatorController.address,
      stakingPool.address,
      wsdToken.address,
    ])) as RewardsPool

    await nwlOperatorController.setRewardsPool(nwlRewardsPool.address)
    await wlOperatorController.setRewardsPool(wlRewardsPool.address)

    for (let i = 0; i < 5; i++) {
      await nwlOperatorController.addOperator('test')
      await nwlOperatorController.addKeyPairs(
        i,
        2,
        concatBytes(nwlOps.keys),
        concatBytes(nwlOps.signatures),
        {
          value: toEther(16 * 2),
        }
      )
      await wlOperatorController.addOperator('test')
      await wlOperatorController.addKeyPairs(
        i,
        3,
        concatBytes(wlOps.keys),
        concatBytes(wlOps.signatures)
      )

      if (i % 2 == 0) {
        await nwlOperatorController.initiateKeyPairValidation(accounts[0], i)
        await nwlOperatorController.reportKeyPairValidation(i, true)
        await wlOperatorController.initiateKeyPairValidation(accounts[0], i)
        await wlOperatorController.reportKeyPairValidation(i, true)
      }
    }

    rewardsReceiver = (await deploy('RewardsReceiver', [
      strategy.address,
      toEther(4),
      toEther(5),
    ])) as RewardsReceiver

    await strategy.addOperatorController(nwlOperatorController.address)
    await strategy.addOperatorController(wlOperatorController.address)
    await strategy.setDepositController(accounts[0])
    await strategy.setRewardsReceiver(rewardsReceiver.address)
    await stakingPool.addStrategy(strategy.address)
    await wETH.approve(stakingPool.address, ethers.constants.MaxUint256)
  })

  it('should be able to deposit into strategy', async () => {
    await stake(2)
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 2, 'strategy balance incorrect')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 2, 'getTotalDeposits incorrect')
    assert.equal(fromEther(await strategy.bufferedETH()), 2)
  })

  it('should not be able to withdraw from strategy', async () => {
    await stake(2)
    await assertThrowsAsync(async () => {
      await stakingPool.withdraw(accounts[0], accounts[0], toEther(1))
    }, 'revert')
  })

  it('depositEther should work correctly', async () => {
    await stake(1000)
    await strategy.depositEther([toEther(16), 0], [5, 0], [[], []], [[], []])

    let keys = [...nwlOps.keys, ...nwlOps.keys, nwlOps.keys[0]]
    let signatures = [...nwlOps.signatures, ...nwlOps.signatures, nwlOps.signatures[0]]
    let events = await depositContract.queryFilter(depositContract.filters.DepositEvent())
    events.forEach((event, index) => {
      assert.equal(event.args[0], keys[index], 'Incorrect key')
      assert.equal(event.args[1], withdrawalCredentials, 'Incorrect withdrawal credentials')
      assert.equal(event.args[2], depositAmount, 'Incorrect amount')
      assert.equal(event.args[3], signatures[index], 'Incorrect signature')
    })

    assert.equal(
      fromEther(await wETH.balanceOf(strategy.address)),
      920,
      'strategy balance incorrect'
    )
    assert.equal(
      fromEther(await ethers.provider.getBalance(depositContract.address)),
      160,
      'deposit contract balance incorrect'
    )
    assert.equal(
      (await strategy.depositedValidators()).toNumber(),
      5,
      'depositedValidators incorrect'
    )
    assert.equal(
      (await nwlOperatorController.queueLength()).toNumber(),
      1,
      'nwl queueLength incorrect'
    )
    assert.equal(
      (await wlOperatorController.queueLength()).toNumber(),
      9,
      'wl queueLength incorrect'
    )
    assert.equal(fromEther(await strategy.bufferedETH()), 920)

    await strategy.depositEther([toEther(16), 0], [1, 4], [[], [0, 2]], [[], [2, 2]])

    keys = [nwlOps.keys[1], wlOps.keys[0], wlOps.keys[1], wlOps.keys[0], wlOps.keys[1]]
    signatures = [
      nwlOps.signatures[1],
      wlOps.signatures[0],
      wlOps.signatures[1],
      wlOps.signatures[0],
      wlOps.signatures[1],
    ]
    events = (await depositContract.queryFilter(depositContract.filters.DepositEvent())).slice(5)
    events.forEach((event, index) => {
      assert.equal(event.args[0], keys[index], 'Incorrect key')
      assert.equal(event.args[1], withdrawalCredentials, 'Incorrect withdrawal credentials')
      assert.equal(event.args[2], depositAmount, 'Incorrect amount')
      assert.equal(event.args[3], signatures[index], 'Incorrect signature')
    })

    assert.equal(
      fromEther(await wETH.balanceOf(strategy.address)),
      776,
      'strategy balance incorrect'
    )
    assert.equal(
      fromEther(await ethers.provider.getBalance(depositContract.address)),
      320,
      'deposit contract balance incorrect'
    )
    assert.equal(
      (await strategy.depositedValidators()).toNumber(),
      10,
      'depositedValidators incorrect'
    )
    assert.equal(
      (await nwlOperatorController.queueLength()).toNumber(),
      0,
      'nwl queueLength incorrect'
    )
    assert.equal(
      (await wlOperatorController.queueLength()).toNumber(),
      5,
      'wl queueLength incorrect'
    )
    assert.equal(fromEther(await strategy.bufferedETH()), 776)

    await strategy.depositEther([toEther(16), 0], [0, 4], [[], [4, 0, 2]], [[], [2, 1, 1]])

    keys = [wlOps.keys[0], wlOps.keys[1], wlOps.keys[2], wlOps.keys[2]]
    signatures = [
      wlOps.signatures[0],
      wlOps.signatures[1],
      wlOps.signatures[2],
      wlOps.signatures[2],
    ]
    events = (await depositContract.queryFilter(depositContract.filters.DepositEvent())).slice(10)
    events.forEach((event, index) => {
      assert.equal(event.args[0], keys[index], 'Incorrect key')
      assert.equal(event.args[1], withdrawalCredentials, 'Incorrect withdrawal credentials')
      assert.equal(event.args[2], depositAmount, 'Incorrect amount')
      assert.equal(event.args[3], signatures[index], 'Incorrect signature')
    })

    assert.equal(
      fromEther(await wETH.balanceOf(strategy.address)),
      648,
      'strategy balance incorrect'
    )
    assert.equal(
      fromEther(await ethers.provider.getBalance(depositContract.address)),
      448,
      'deposit contract balance incorrect'
    )
    assert.equal(
      (await strategy.depositedValidators()).toNumber(),
      14,
      'depositedValidators incorrect'
    )
    assert.equal(
      (await nwlOperatorController.queueLength()).toNumber(),
      0,
      'nwl queueLength incorrect'
    )
    assert.equal(
      (await wlOperatorController.queueLength()).toNumber(),
      1,
      'wl queueLength incorrect'
    )
    assert.equal(fromEther(await strategy.bufferedETH()), 648)
  })

  it('depositEther validation should work correctly', async () => {
    await stake(100)

    await expect(
      strategy.connect(signers[1]).depositEther([toEther(16), 0], [1, 0], [[], []], [[], []])
    ).to.be.revertedWith('OnlyDepositController()')
    await expect(
      strategy.depositEther([toEther(16), 0], [0, 0], [[], []], [[], []])
    ).to.be.revertedWith('InvalidTotalDepositAmount()')
    await expect(
      strategy.depositEther([toEther(16), 0], [6, 4], [[], [0, 2]], [[], [2, 2]])
    ).to.be.revertedWith('InvalidTotalDepositAmount()')
    await expect(
      strategy.depositEther([toEther(16), 0], [0, 2], [[], [0]], [[], [2]])
    ).to.be.revertedWith('InvalidQueueOrder()')
  })

  it('reportBeaconState should work correctly', async () => {
    await stake(1000)
    await strategy.depositEther([toEther(16), 0], [6, 2], [[], [0]], [[], [2]])
    await strategy.reportBeaconState(3, toEther(90), toEther(0))

    assert.equal((await strategy.beaconValidators()).toNumber(), 3, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 90, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.depositChange()), -6, 'depositChange incorrect')

    await strategy.reportBeaconState(4, toEther(132), toEther(0))

    assert.equal((await strategy.beaconValidators()).toNumber(), 4, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 132, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.depositChange()), 4, 'depositChange incorrect')

    await strategy.reportBeaconState(5, toEther(163), toEther(2))

    assert.equal((await strategy.beaconValidators()).toNumber(), 5, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 163, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.depositChange()), 5, 'depositChange incorrect')

    await strategy.reportBeaconState(5, toEther(155), toEther(2))

    assert.equal((await strategy.beaconValidators()).toNumber(), 5, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 155, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.depositChange()), -3, 'depositChange incorrect')

    await strategy.reportBeaconState(5, toEther(156), toEther(1))

    assert.equal((await strategy.beaconValidators()).toNumber(), 5, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 156, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.depositChange()), -3, 'depositChange incorrect')
  })

  it('reportBeaconState validation should work correctly', async () => {
    await stake(1000)
    await strategy.depositEther([toEther(16), 0], [6, 2], [[], [0]], [[], [2]])
    await strategy.reportBeaconState(3, toEther(90), toEther(0))

    await expect(
      strategy.connect(signers[1]).reportBeaconState(4, toEther(90), toEther(0))
    ).to.be.revertedWith('OnlyBeaconOracle()')
    await expect(strategy.reportBeaconState(9, toEther(90), toEther(0))).to.be.revertedWith(
      'MoreValidatorsThanDeposited()'
    )
    await expect(strategy.reportBeaconState(2, toEther(90), toEther(0))).to.be.revertedWith(
      'LessValidatorsThanTracked()'
    )
  })

  it('updateDeposits should work correctly with positive rewards', async () => {
    await stake(1000)
    await signers[0].sendTransaction({ to: rewardsReceiver.address, value: toEther(8) })
    await strategy.depositEther([toEther(16), 0], [6, 2], [[], [0]], [[], [2]])
    await strategy.reportBeaconState(3, toEther(196), toEther(0))

    assert.equal(fromEther(await strategy.depositChange()), 105, 'depositChange incorrect')

    await stakingPool.updateStrategyRewards([0])
    assert.equal(
      Number(
        fromEther(
          await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(nwlRewardsPool.address))
        ).toFixed(3)
      ),
      17.072,
      'nwl operator rewards incorrect'
    )
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(wlRewardsPool.address))
      ),
      2.625,
      'wl operator rewards incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(ownersRewards)),
      10.5,
      'owners rewards incorrect'
    )
    assert.equal(fromEther(await strategy.depositChange()), 0, 'depositChange incorrect')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1105, 'getTotalDeposits incorrect')
    assert.equal(fromEther(await stakingPool.totalSupply()), 1105, 'totalSupply incorrect')
  })

  it('updateDeposits should work correctly with multiple nwl operator controllers', async () => {
    let controller = (await deployUpgradeable('NWLOperatorController', [
      strategy.address,
      stakingPool.address,
      toEther(8),
    ])) as NWLOperatorController
    await controller.setKeyValidationOracle(accounts[0])
    await controller.setBeaconOracle(accounts[0])
    await strategy.addOperatorController(controller.address)

    let rewardsPool = (await deploy('RewardsPoolWSD', [
      controller.address,
      stakingPool.address,
      wsdToken.address,
    ])) as RewardsPool
    await controller.setRewardsPool(rewardsPool.address)

    for (let i = 0; i < 5; i++) {
      await controller.addOperator('test')
      await controller.addKeyPairs(i, 2, concatBytes(nwlOps.keys), concatBytes(nwlOps.signatures), {
        value: toEther(8 * 2),
      })

      if (i % 2 == 0) {
        await controller.initiateKeyPairValidation(accounts[0], i)
        await controller.reportKeyPairValidation(i, true)
      }
    }

    await stake(1000)
    await signers[0].sendTransaction({ to: rewardsReceiver.address, value: toEther(8) })
    await strategy.depositEther(
      [toEther(16), 0, toEther(8)],
      [6, 9, 3],
      [[], [0, 2, 4], []],
      [[], [3, 3, 3], []]
    )
    await strategy.reportBeaconState(3, toEther(196), toEther(0))

    assert.equal(fromEther(await strategy.depositChange()), 105, 'depositChange incorrect')

    await stakingPool.updateStrategyRewards([0])
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(nwlRewardsPool.address))
      ),
      12.5,
      'nwl operator rewards incorrect'
    )
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(rewardsPool.address))
      ),
      4,
      'nwl2 operator rewards incorrect'
    )
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(wlRewardsPool.address))
      ),
      5.25,
      'wl operator rewards incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(ownersRewards)),
      10.5,
      'owners rewards incorrect'
    )
    assert.equal(fromEther(await strategy.depositChange()), 0, 'depositChange incorrect')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1105, 'getTotalDeposits incorrect')
    assert.equal(fromEther(await stakingPool.totalSupply()), 1105, 'totalSupply incorrect')
  })

  it('updateDeposits should work correctly with negative rewards', async () => {
    await stake(1000)
    await strategy.depositEther([toEther(16), 0], [6, 2], [[], [0]], [[], [2]])
    await strategy.reportBeaconState(3, toEther(95), toEther(0))

    assert.equal(fromEther(await strategy.depositChange()), -1, 'depositChange incorrect')

    await stakingPool.updateStrategyRewards([0])
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(nwlRewardsPool.address))
      ),
      0,
      'nwl operator rewards incorrect'
    )
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(wlRewardsPool.address))
      ),
      0,
      'wl operator rewards incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(ownersRewards))),
      0,
      'owners rewards incorrect'
    )
    assert.equal(fromEther(await strategy.depositChange()), 0, 'depositChange incorrect')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 999, 'getTotalDeposits incorrect')
    assert.equal(fromEther(await stakingPool.totalSupply()), 999, 'totalSupply incorrect')
  })

  it('rewards receiver should work correctly', async () => {
    await signers[0].sendTransaction({ to: rewardsReceiver.address, value: toEther(8) })
    await stake(32)
    await strategy.depositEther([toEther(16), 0], [2, 0], [[], []], [[], []])

    await strategy.reportBeaconState(2, toEther(64), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 0)
    assert.equal(fromEther(await strategy.depositChange()), 0)
    assert.equal(fromEther(await strategy.bufferedETH()), 0)

    await strategy.reportBeaconState(2, toEther(63), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 0)
    assert.equal(fromEther(await strategy.depositChange()), -1)
    assert.equal(fromEther(await strategy.bufferedETH()), 0)

    await strategy.reportBeaconState(2, toEther(65), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 5)
    assert.equal(fromEther(await strategy.depositChange()), 6)
    assert.equal(fromEther(await strategy.bufferedETH()), 5)

    await strategy.reportBeaconState(2, toEther(66), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 5)
    assert.equal(fromEther(await strategy.depositChange()), 7)
    assert.equal(fromEther(await strategy.bufferedETH()), 5)

    await rewardsReceiver.setWithdrawalLimits(toEther(0), toEther(4))

    await strategy.reportBeaconState(2, toEther(67), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 8)
    assert.equal(fromEther(await strategy.depositChange()), 11)
    assert.equal(fromEther(await strategy.bufferedETH()), 8)

    await strategy.reportBeaconState(2, toEther(68), toEther(0))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 8)
    assert.equal(fromEther(await strategy.depositChange()), 12)
    assert.equal(fromEther(await strategy.bufferedETH()), 8)
  })

  it('addOperatorController should work correctly', async () => {
    await strategy.addOperatorController(accounts[2])

    assert.deepEqual(
      await strategy.getOperatorControllers(),
      [nwlOperatorController.address, wlOperatorController.address, accounts[2]],
      'operator controllers incorrect'
    )

    await expect(strategy.addOperatorController(accounts[2])).to.be.revertedWith(
      'ControllerAlreadyAdded()'
    )
    await expect(strategy.addOperatorController(ethers.constants.AddressZero)).to.be.revertedWith(
      'CannotSetZeroAddress()'
    )
    await expect(
      strategy.connect(signers[1]).addOperatorController(accounts[3])
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('removeOperatorController should work correctly', async () => {
    await strategy.addOperatorController(accounts[2])
    await strategy.removeOperatorController(wlOperatorController.address)

    assert.deepEqual(
      await strategy.getOperatorControllers(),
      [nwlOperatorController.address, accounts[2]],
      'operator controllers incorrect'
    )

    await strategy.removeOperatorController(nwlOperatorController.address)

    assert.deepEqual(
      await strategy.getOperatorControllers(),
      [accounts[2]],
      'operator controllers incorrect'
    )

    await expect(
      strategy.removeOperatorController(wlOperatorController.address)
    ).to.be.revertedWith('ControllerNotFound()')
    await expect(
      strategy.connect(signers[1]).removeOperatorController(accounts[2])
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('setBeaconOracle should work correctly', async () => {
    await strategy.setBeaconOracle(accounts[2])

    assert.equal(await strategy.beaconOracle(), accounts[2], 'beaconOracle incorrect')

    await expect(strategy.connect(signers[1]).setBeaconOracle(accounts[2])).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('setDepositController should work correctly', async () => {
    await strategy.setDepositController(accounts[2])

    assert.equal(await strategy.depositController(), accounts[2], 'beaconOracle incorrect')

    await expect(strategy.connect(signers[1]).setBeaconOracle(accounts[2])).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('operatorControllerWithdraw should work correctly', async () => {
    await strategy.addOperatorController(accounts[0])

    await expect(
      strategy.connect(signers[3]).operatorControllerWithdraw(accounts[2], toEther(1))
    ).to.be.revertedWith('OnlyOperatorController()')
    await expect(strategy.operatorControllerWithdraw(accounts[2], toEther(1))).to.be.revertedWith(
      'Not implemented yet'
    )
  })

  it('setMaxDeposits and setMinDeposits should work correctly', async () => {
    await strategy.setMaxDeposits(toEther(33))
    await strategy.setMinDeposits(toEther(44))

    assert.equal(fromEther(await strategy.getMaxDeposits()), 33, 'maxDeposits incorrect')
    assert.equal(fromEther(await strategy.getMinDeposits()), 44, 'minDeposits incorrect')

    await expect(strategy.connect(signers[1]).setMaxDeposits(toEther(1))).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
    await expect(strategy.connect(signers[1]).setMinDeposits(toEther(1))).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })
})
