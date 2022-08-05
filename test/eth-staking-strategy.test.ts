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
} from './utils/helpers'
import {
  StakingPool,
  WrappedSDToken,
  EthStakingStrategy,
  WrappedETH,
  DepositContract,
  WLOperatorController,
  NWLOperatorController,
  OperatorWhitelistMock,
} from '../typechain-types'
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
  let nwlOperatorController: NWLOperatorController
  let wlOperatorController: WLOperatorController
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

    nwlOperatorController = (await deploy('NWLOperatorController', [
      strategy.address,
    ])) as NWLOperatorController
    await nwlOperatorController.setKeyValidationOracle(accounts[0])
    await nwlOperatorController.setBeaconOracle(accounts[0])

    let operatorWhitelist = (await deploy('OperatorWhitelistMock', [
      [accounts[0]],
    ])) as OperatorWhitelistMock
    wlOperatorController = (await deploy('WLOperatorController', [
      strategy.address,
      operatorWhitelist.address,
      2,
    ])) as WLOperatorController
    await wlOperatorController.setKeyValidationOracle(accounts[0])
    await wlOperatorController.setBeaconOracle(accounts[0])

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
        await nwlOperatorController.initiateKeyPairValidation(i)
        await nwlOperatorController.reportKeyPairValidation(i, true)
        await wlOperatorController.initiateKeyPairValidation(i)
        await wlOperatorController.reportKeyPairValidation(i, true)
      }
    }

    await strategy.setNWLOperatorController(nwlOperatorController.address)
    await strategy.setWLOperatorController(wlOperatorController.address)
    await stakingPool.addStrategy(strategy.address)
    await wETH.approve(stakingPool.address, ethers.constants.MaxUint256)
  })

  it('should be able to deposit into strategy', async () => {
    await stake(2)
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 2, 'strategy balance incorrect')
  })

  it('should not be able to withdraw from strategy', async () => {
    await stake(2)
    await assertThrowsAsync(async () => {
      await stakingPool.withdraw(accounts[0], accounts[0], toEther(1))
    }, 'revert')
  })

  it('depositEther should work correctly', async () => {
    await stake(1000)
    await strategy.depositEther(5, 0, [], [])

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
    assert.equal(fromEther(await strategy.totalDeposits()), 1000, 'totalDeposits incorrect')
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

    await strategy.depositEther(1, 4, [0, 2], [2, 2])

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
    assert.equal(fromEther(await strategy.totalDeposits()), 1000, 'totalDeposits incorrect')
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

    await strategy.depositEther(0, 4, [4, 0, 2], [2, 1, 1])

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
    assert.equal(fromEther(await strategy.totalDeposits()), 1000, 'totalDeposits incorrect')
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
  })

  it('depositEther validation should work correctly', async () => {
    await stake(100)

    await expect(strategy.depositEther(0, 0, [], [])).to.be.revertedWith('Cannot deposit 0')
    await expect(strategy.depositEther(6, 4, [0, 2], [2, 2])).to.be.revertedWith(
      'Insufficient balance for deposit'
    )
    await expect(strategy.depositEther(0, 2, [0], [2])).to.be.revertedWith(
      'Non-whitelisted queue must be empty to assign whitlisted'
    )
  })

  it('reportBeaconState should work correctly', async () => {
    await stake(1000)
    await strategy.depositEther(6, 2, [0], [2])
    await strategy.reportBeaconState(3, toEther(90))

    assert.equal((await strategy.beaconValidators()).toNumber(), 3, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 90, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.depositChange()), -6, 'depositChange incorrect')

    await strategy.reportBeaconState(4, toEther(132))

    assert.equal((await strategy.beaconValidators()).toNumber(), 4, 'beaconValidators incorrect')
    assert.equal(fromEther(await strategy.beaconBalance()), 132, 'beaconBalance incorrect')
    assert.equal(fromEther(await strategy.depositChange()), 4, 'depositChange incorrect')
  })

  it('reportBeaconState validation should work correctly', async () => {
    await stake(1000)
    await strategy.depositEther(6, 2, [0], [2])
    await strategy.reportBeaconState(3, toEther(90))

    await expect(strategy.connect(signers[1]).reportBeaconState(4, toEther(90))).to.be.revertedWith(
      'Sender is not beacon oracle'
    )
    await expect(strategy.reportBeaconState(9, toEther(90))).to.be.revertedWith(
      'Reported more validators than deposited'
    )
    await expect(strategy.reportBeaconState(2, toEther(90))).to.be.revertedWith(
      'Reported less validators than tracked'
    )
  })

  it('totalDeposits should work correctly', async () => {
    await stake(1000)
    await strategy.depositEther(6, 2, [0], [2])

    assert.equal(fromEther(await strategy.totalDeposits()), 1000, 'totalDeposits incorrect')

    await strategy.reportBeaconState(3, toEther(70))
    assert.equal(fromEther(await strategy.totalDeposits()), 974, 'totalDeposits incorrect')

    await strategy.reportBeaconState(5, toEther(170))
    assert.equal(fromEther(await strategy.totalDeposits()), 1010, 'totalDeposits incorrect')

    await nwlOperatorController.reportStoppedValidators([0], [1], [toEther(5)])
    await strategy.reportBeaconState(5, toEther(165))
    assert.equal(fromEther(await strategy.totalDeposits()), 1010, 'totalDeposits incorrect')
  })

  it('updateDeposits should work correctly', async () => {
    await stake(1000)
    await strategy.depositEther(6, 2, [0], [2])
    await strategy.reportBeaconState(3, toEther(196))

    assert.equal(fromEther(await strategy.depositChange()), 100, 'depositChange incorrect')

    await stakingPool.updateStrategyRewards([0])
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(
          await wsdToken.balanceOf(nwlOperatorController.address)
        )
      ),
      16.25,
      'nwl operator rewards incorrect'
    )
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(
          await wsdToken.balanceOf(wlOperatorController.address)
        )
      ),
      2.5,
      'wl operator rewards incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(ownersRewards))),
      10,
      'owners rewards incorrect'
    )
  })

  it('updateDeposits should distribute nothing if rewards are <= 0', async () => {
    await stake(1000)
    await strategy.depositEther(6, 2, [0], [2])
    await strategy.reportBeaconState(3, toEther(95))

    assert.equal(fromEther(await strategy.depositChange()), -1, 'depositChange incorrect')

    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(
          await wsdToken.balanceOf(wlOperatorController.address)
        )
      ),
      0,
      'wl operator rewards incorrect'
    )
    assert.equal(
      fromEther(
        await wsdToken.getUnderlyingByWrapped(
          await wsdToken.balanceOf(nwlOperatorController.address)
        )
      ),
      0,
      'nwl operator rewards incorrect'
    )
    assert.equal(
      fromEther(await wsdToken.getUnderlyingByWrapped(await wsdToken.balanceOf(ownersRewards))),
      0,
      'owners rewards incorrect'
    )
  })

  it('setWLOperatorController should work correctly', async () => {
    await strategy.setWLOperatorController(accounts[2])

    assert.equal(
      await strategy.wlOperatorController(),
      accounts[2],
      'wlOperatorController incorrect'
    )

    await expect(
      strategy.connect(signers[1]).setWLOperatorController(accounts[2])
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('setNWLOperatorController should work correctly', async () => {
    await strategy.setNWLOperatorController(accounts[2])

    assert.equal(
      await strategy.nwlOperatorController(),
      accounts[2],
      'nwlOperatorController incorrect'
    )

    await expect(
      strategy.connect(signers[1]).setNWLOperatorController(accounts[2])
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('setBeaconOracle should work correctly', async () => {
    await strategy.setBeaconOracle(accounts[2])

    assert.equal(await strategy.beaconOracle(), accounts[2], 'beaconOracle incorrect')

    await expect(strategy.connect(signers[1]).setBeaconOracle(accounts[2])).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('nwlWithdraw should work correctly', async () => {
    await strategy.setNWLOperatorController(accounts[1])

    await expect(strategy.nwlWithdraw(accounts[2], toEther(1))).to.be.revertedWith(
      'Sender is not non-whitelisted operator controller'
    )
    await expect(
      strategy.connect(signers[1]).nwlWithdraw(accounts[2], toEther(1))
    ).to.be.revertedWith('Not implemented yet')
  })
})
