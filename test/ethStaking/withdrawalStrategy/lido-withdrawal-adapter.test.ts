import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { BigNumber, Signer } from 'ethers'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../../utils/helpers'
import {
  EthWithdrawalStrategy,
  LidoWithdrawalAdapter,
  LidoWithdrawalQueueMock,
  WrappedETH,
} from '../../../typechain-types'

describe('LidoWithdrawalAdapter', () => {
  let wETH: WrappedETH
  let lidoWQ: LidoWithdrawalQueueMock
  let controller: EthWithdrawalStrategy
  let adapter: LidoWithdrawalAdapter
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    wETH = (await deploy('WrappedETH')) as WrappedETH

    lidoWQ = (await deploy('LidoWithdrawalQueueMock', [
      [
        [toEther(1), 0, accounts[0], 0, true, false],
        [toEther(2), 0, accounts[1], 0, true, false],
        [toEther(3), 0, accounts[0], 0, true, false],
        [toEther(4), 0, accounts[1], 0, false, false],
        [toEther(5), 0, accounts[2], 0, false, false],
        [toEther(6), 0, accounts[0], 0, false, false],
        [toEther(50), 0, accounts[0], 0, false, false],
        [10, 0, accounts[0], 0, false, false],
      ],
    ])) as LidoWithdrawalQueueMock

    await signers[4].sendTransaction({
      from: accounts[4],
      to: lidoWQ.address,
      value: toEther(21),
    })

    controller = (await deployUpgradeable('EthWithdrawalStrategy', [
      wETH.address,
      accounts[4],
      ethers.constants.MaxUint256,
    ])) as EthWithdrawalStrategy

    await wETH.connect(signers[4]).wrap({ value: toEther(25) })
    await wETH.connect(signers[4]).approve(controller.address, toEther(25))
    await controller.connect(signers[4]).deposit(toEther(25))

    adapter = (await deployUpgradeable('LidoWithdrawalAdapter', [
      controller.address,
      lidoWQ.address,
      9000,
      100,
    ])) as LidoWithdrawalAdapter

    await controller.addAdapter(adapter.address)

    await lidoWQ.approve(adapter.address, 0)
    await lidoWQ.connect(signers[1]).approve(adapter.address, 1)
    await lidoWQ.connect(signers[1]).approve(adapter.address, 3)
    await lidoWQ.connect(signers[2]).approve(adapter.address, 4)
    await lidoWQ.approve(adapter.address, 5)

    await lidoWQ.approve(adapter.address, 2)

    await adapter.initiateWithdrawal(0)
    await adapter.connect(signers[1]).initiateWithdrawal(1)
    await adapter.connect(signers[1]).initiateWithdrawal(3)
    await adapter.connect(signers[2]).initiateWithdrawal(4)
    await adapter.initiateWithdrawal(5)

    // controller wETH balance: 8.8
    // adapter totalDeposits: 16.2
  })

  it('pausing should work correctly', async () => {
    await adapter.setPaused(true)
    await expect(adapter.initiateWithdrawal(2)).to.be.revertedWith('ContractIsPaused()')
    await expect(adapter.setPaused(true)).to.be.revertedWith('CannotSetSamePauseStatus()')

    await adapter.setPaused(false)
    await adapter.initiateWithdrawal(2)
  })

  it('getRequestIds should work correctly', async () => {
    assert.deepEqual(
      (await adapter.getRequestIds()).map((n) => n.toNumber()),
      [0, 1, 3, 4, 5]
    )
  })

  it('getRequestIdsByOwner should work correctly', async () => {
    assert.deepEqual(
      (await adapter.getRequestIdsByOwner(accounts[0])).map((n) => n.toNumber()),
      [0, 5]
    )
    assert.deepEqual(
      (await adapter.getRequestIdsByOwner(accounts[1])).map((n) => n.toNumber()),
      [1, 3]
    )
    assert.deepEqual(
      (await adapter.getRequestIdsByOwner(accounts[2])).map((n) => n.toNumber()),
      [4]
    )
  })

  it('initiateWithdrawal should work correctly', async () => {
    await expect(adapter.initiateWithdrawal(5)).to.be.revertedWith('DuplicateRequestId()')
    await expect(adapter.initiateWithdrawal(6)).to.be.revertedWith(
      'InsufficientFundsForWithdrawal()'
    )
    await expect(adapter.initiateWithdrawal(7)).to.be.revertedWith('WithdrawalAmountTooSmall()')

    const initialBalance = fromEther(await signers[0].getBalance())

    await adapter.initiateWithdrawal(2)
    assert.equal(fromEther(await adapter.getTotalDeposits()), 18.9)
    assert.deepEqual(
      (await adapter.getRequestIdsByOwner(accounts[0])).map((n) => n.toNumber()),
      [0, 5, 2]
    )
    assert.deepEqual(await adapter.withdrawals(2), [
      BigNumber.from(toEther(3)),
      BigNumber.from(toEther(2.7)),
      accounts[0],
    ])
    assert.equal(fromEther(await wETH.balanceOf(controller.address)), 6.1)
    assert.equal(
      Number((fromEther(await signers[0].getBalance()) - initialBalance).toFixed(2)),
      2.7
    )
  })

  it('finalizeWithdrawals should work correctly', async () => {
    let initialBalance = fromEther(await signers[1].getBalance())
    await adapter.finalizeWithdrawals([1], [1])

    assert.equal(fromEther(await adapter.getTotalDeposits()), 14.4)
    assert.equal(fromEther(await wETH.balanceOf(controller.address)), 10.62)
    assert.equal(
      Number((fromEther(await signers[1].getBalance()) - initialBalance).toFixed(2)),
      0.18
    )

    initialBalance = fromEther(await signers[2].getBalance())
    await lidoWQ.finalizeRequest(4, toEther(4.9))
    await adapter.finalizeWithdrawals([4], [4])

    assert.equal(fromEther(await adapter.getTotalDeposits()), 9.9)
    assert.equal(fromEther(await wETH.balanceOf(controller.address)), 15.169)
    assert.equal(
      Number((fromEther(await signers[2].getBalance()) - initialBalance).toFixed(3)),
      0.351
    )

    initialBalance = fromEther(await signers[1].getBalance())
    await lidoWQ.finalizeRequest(3, toEther(3.5))
    await adapter.finalizeWithdrawals([3], [3])

    assert.equal(fromEther(await adapter.getTotalDeposits()), 6.3)
    assert.equal(fromEther(await wETH.balanceOf(controller.address)), 18.669)
    assert.equal(fromEther(await signers[1].getBalance()), initialBalance)
  })

  it('finalizing multiple withdrawals should work correctly', async () => {
    let initialBalance1 = fromEther(await signers[1].getBalance())
    let initialBalance2 = fromEther(await signers[2].getBalance())

    await lidoWQ.finalizeRequest(4, toEther(4.9))
    await lidoWQ.finalizeRequest(3, toEther(3.5))
    await adapter.finalizeWithdrawals([1, 4, 3], [1, 4, 3])

    assert.equal(fromEther(await adapter.getTotalDeposits()), 6.3)
    assert.equal(fromEther(await wETH.balanceOf(controller.address)), 18.669)
    assert.equal(
      Number((fromEther(await signers[1].getBalance()) - initialBalance1).toFixed(2)),
      0.18
    )
    assert.equal(
      Number((fromEther(await signers[2].getBalance()) - initialBalance2).toFixed(3)),
      0.351
    )
  })

  it('getClaimableEther should work correctly', async () => {
    await expect(adapter.getClaimableEther([0, 1, 2, 4, 5])).to.be.revertedWith(
      'RequestNotFound(2)'
    )
    assert.deepEqual(
      (await adapter.getClaimableEther([0, 1, 3, 4, 5])).map((v) => fromEther(v)),
      [1, 2, 0, 0, 0]
    )
    await lidoWQ.finalizeRequest(4, toEther(5))
    assert.deepEqual(
      (await adapter.getClaimableEther([0, 1, 3, 4, 5])).map((v) => fromEther(v)),
      [1, 2, 0, 5, 0]
    )
    await adapter.finalizeWithdrawals([1], [1])
    assert.deepEqual(
      (await adapter.getClaimableEther([0, 1, 3, 4, 5])).map((v) => fromEther(v)),
      [1, 0, 0, 5, 0]
    )
    assert.deepEqual(
      (await adapter.getClaimableEther([4])).map((v) => fromEther(v)),
      [5]
    )
  })

  it('getWithdrawableEther should work correctly', async () => {
    await expect(adapter.getWithdrawableEther([0, 1, 2, 4, 5])).to.be.revertedWith(
      'RequestNotFound(2)'
    )
    assert.deepEqual(
      (await adapter.getWithdrawableEther([0, 1, 3, 4, 5])).map((v) => fromEther(v)),
      [0.09, 0.18, 0, 0, 0]
    )
    await lidoWQ.finalizeRequest(4, toEther(4.9))
    assert.deepEqual(
      (await adapter.getWithdrawableEther([0, 1, 3, 4, 5])).map((v) => fromEther(v)),
      [0.09, 0.18, 0, 0.351, 0]
    )
    await lidoWQ.finalizeRequest(5, toEther(4.4))
    assert.deepEqual(
      (await adapter.getWithdrawableEther([0, 1, 3, 4, 5])).map((v) => fromEther(v)),
      [0.09, 0.18, 0, 0.351, 0]
    )
    await adapter.finalizeWithdrawals([1], [1])
    assert.deepEqual(
      (await adapter.getWithdrawableEther([0, 1, 3, 4, 5])).map((v) => fromEther(v)),
      [0.09, 0, 0, 0.351, 0]
    )
    assert.deepEqual(
      (await adapter.getWithdrawableEther([4])).map((v) => fromEther(v)),
      [0.351]
    )
  })

  it('getTotalDeposits should work correctly', async () => {
    assert.equal(fromEther(await adapter.getTotalDeposits()), 16.2)
    await adapter.initiateWithdrawal(2)
    assert.equal(fromEther(await adapter.getTotalDeposits()), 18.9)
    await adapter.finalizeWithdrawals([0], [0])
    assert.equal(fromEther(await adapter.getTotalDeposits()), 18)
  })
})
