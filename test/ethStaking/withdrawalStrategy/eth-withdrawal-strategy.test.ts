import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { Signer } from 'ethers'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../../utils/helpers'
import {
  EthWithdrawalStrategy,
  StakingPool,
  WithdrawalAdapterMock,
  WrappedETH,
} from '../../../typechain-types'

describe('EthWithdrawalStrategy', () => {
  let wETH: WrappedETH
  let strategy: EthWithdrawalStrategy
  let adapters: WithdrawalAdapterMock[]
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    wETH = (await deploy('WrappedETH')) as WrappedETH

    strategy = (await deployUpgradeable('EthWithdrawalStrategy', [
      wETH.address,
      accounts[0],
      toEther(50),
    ])) as EthWithdrawalStrategy

    await wETH.wrap({ value: toEther(100) })
    await wETH.approve(strategy.address, toEther(100))
    await strategy.deposit(toEther(25))

    adapters = []
    for (let i = 0; i < 3; i++) {
      let adapter = (await deployUpgradeable('WithdrawalAdapterMock', [
        strategy.address,
      ])) as WithdrawalAdapterMock
      adapters.push(adapter)
      await strategy.addAdapter(adapter.address)
    }
  })

  it('addAdapter should work correctly', async () => {
    await expect(strategy.addAdapter(adapters[0].address)).to.be.revertedWith(
      'AdapterAlreadyExists('
    )

    let adapter = (await deployUpgradeable('WithdrawalAdapterMock', [
      strategy.address,
    ])) as WithdrawalAdapterMock
    await strategy.addAdapter(adapter.address)

    assert.deepEqual(
      await strategy.getAdapters(),
      [...adapters, adapter].map((a) => a.address)
    )
    await expect(strategy.addAdapter(adapter.address)).to.be.revertedWith('AdapterAlreadyExists()')
  })

  it('removeAdapter should work correctly', async () => {
    await adapters[0].withdrawFromController(10)
    await expect(strategy.removeAdapter(accounts[0])).to.be.revertedWith('AdapterNotFound()')
    await expect(strategy.removeAdapter(adapters[0].address)).to.be.revertedWith(
      'AdapterContainsDeposits()'
    )

    await strategy.removeAdapter(adapters[1].address)
    assert.deepEqual(
      await strategy.getAdapters(),
      [adapters[0], adapters[2]].map((a) => a.address)
    )
    await expect(strategy.removeAdapter(adapters[1].address)).to.be.revertedWith(
      'AdapterNotFound()'
    )

    await strategy.removeAdapter(adapters[2].address)
    assert.deepEqual(await strategy.getAdapters(), [adapters[0].address])
    await expect(strategy.removeAdapter(adapters[2].address)).to.be.revertedWith(
      'AdapterNotFound()'
    )
  })

  it('deposit/withdraw should work correctly', async () => {
    await strategy.deposit(toEther(5))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 30)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 30)
    await expect(strategy.deposit(toEther(21))).to.be.revertedWith(
      'InsufficientDepositRoom(21000000000000000000, 20000000000000000000)'
    )

    await strategy.withdraw(toEther(10))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 20)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 20)
    await adapters[0].withdrawFromController(toEther(15))
    await expect(strategy.withdraw(toEther(6))).to.be.revertedWith(
      'InsufficientWithdrawalRoom(6000000000000000000, 5000000000000000000)'
    )

    await expect(strategy.connect(signers[1]).deposit(toEther(1))).to.be.revertedWith(
      'StakingPool only'
    )
    await expect(strategy.connect(signers[1]).withdraw(toEther(1))).to.be.revertedWith(
      'StakingPool only'
    )
  })

  it('adapterDeposit/adapterWithdraw should work correctly', async () => {
    await adapters[0].withdrawFromController(toEther(5))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 20)
    assert.equal(fromEther(await ethers.provider.getBalance(adapters[0].address)), 5)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 25)

    await adapters[2].withdrawFromController(toEther(10))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 10)
    assert.equal(fromEther(await ethers.provider.getBalance(adapters[2].address)), 10)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 25)

    await adapters[0].depositToController(toEther(2))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 12)
    assert.equal(fromEther(await ethers.provider.getBalance(adapters[0].address)), 3)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 25)

    await adapters[2].depositToController(toEther(3))
    assert.equal(fromEther(await wETH.balanceOf(strategy.address)), 15)
    assert.equal(fromEther(await ethers.provider.getBalance(adapters[2].address)), 7)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 25)

    await expect(strategy.adapterDeposit({ value: toEther(1) })).to.be.revertedWith('OnlyAdapter()')
    await expect(strategy.adapterWithdraw(accounts[0], toEther(1))).to.be.revertedWith(
      'OnlyAdapter()'
    )
  })

  it('depositChange should work correctly', async () => {
    assert.equal(fromEther(await strategy.depositChange()), 0)
    await strategy.deposit(toEther(10))
    assert.equal(fromEther(await strategy.depositChange()), 0)
    await strategy.withdraw(toEther(5))
    assert.equal(fromEther(await strategy.depositChange()), 0)
    await adapters[0].setTotalDeposits(toEther(1))
    assert.equal(fromEther(await strategy.depositChange()), 1)
    await adapters[2].setTotalDeposits(toEther(2))
    assert.equal(fromEther(await strategy.depositChange()), 3)
    await adapters[1].withdrawFromController(toEther(5))
    await adapters[1].setTotalDeposits(toEther(1))
    assert.equal(fromEther(await strategy.depositChange()), -1)
    await wETH.transfer(strategy.address, toEther(10))
    assert.equal(fromEther(await strategy.depositChange()), 9)
  })

  it('updateDeposits should work correctly', async () => {
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getTotalDeposits()), 25)

    await wETH.transfer(strategy.address, toEther(5))
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getTotalDeposits()), 30)

    await adapters[1].withdrawFromController(toEther(5))
    await adapters[1].setTotalDeposits(toEther(1))
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getTotalDeposits()), 26)
  })

  it('getMinDeposits should work correctly', async () => {
    await adapters[0].withdrawFromController(toEther(2))
    assert.equal(fromEther(await strategy.getMinDeposits()), 2)
    await adapters[1].withdrawFromController(toEther(3))
    assert.equal(fromEther(await strategy.getMinDeposits()), 5)
    await adapters[1].depositToController(toEther(1))
    assert.equal(fromEther(await strategy.getMinDeposits()), 4)
  })

  it('fee distribution should work correctly', async () => {
    let stakingPool = (await deployUpgradeable('StakingPool', [
      wETH.address,
      'LinkPool ETH',
      'lplETH',
      [[accounts[3], 1000]],
      accounts[0],
      accounts[0],
    ])) as StakingPool

    let strategy2 = (await deployUpgradeable('EthWithdrawalStrategy', [
      wETH.address,
      stakingPool.address,
      toEther(50),
    ])) as EthWithdrawalStrategy

    await wETH.wrap({ value: toEther(100) })
    await wETH.approve(stakingPool.address, toEther(100))
    await stakingPool.addStrategy(strategy2.address)

    await stakingPool.stake(accounts[0], toEther(25))
    await wETH.transfer(strategy2.address, toEther(5))
    await stakingPool.updateStrategyRewards([0])

    assert.equal(fromEther(await strategy2.getTotalDeposits()), 30)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[3])), 0.5)
  })
})
