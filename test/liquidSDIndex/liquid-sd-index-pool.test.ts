import { assert, expect } from 'chai'
import {
  deploy,
  deployUpgradeable,
  fromEther,
  getAccounts,
  setupToken,
  toEther,
} from '../utils/helpers'
import { ERC677, LiquidSDAdapterMock, LiquidSDIndexPool } from '../../typechain-types'
import { Signer } from 'ethers'
import { ethers } from 'hardhat'

describe('LiquidSDIndexPool', () => {
  let pool: LiquidSDIndexPool
  let adapter1: LiquidSDAdapterMock
  let adapter2: LiquidSDAdapterMock
  let lsd1: ERC677
  let lsd2: ERC677
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
  })

  beforeEach(async () => {
    lsd1 = (await deploy('ERC677', ['Liquid SD Token 1', 'LSD1', 100000000])) as ERC677
    lsd2 = (await deploy('ERC677', ['Liquid SD Token 2', 'LSD2', 100000000])) as ERC677
    await setupToken(lsd1, accounts)
    await setupToken(lsd2, accounts)

    pool = (await deployUpgradeable('LiquidSDIndexPool', [
      'Staked ETH Index',
      'iETH',
      5000,
      toEther(10000),
      [
        [accounts[3], 1000],
        [accounts[4], 500],
      ],
    ])) as LiquidSDIndexPool

    adapter1 = (await deployUpgradeable('LiquidSDAdapterMock', [
      lsd1.address,
      pool.address,
      toEther(1),
    ])) as LiquidSDAdapterMock
    adapter2 = (await deployUpgradeable('LiquidSDAdapterMock', [
      lsd2.address,
      pool.address,
      toEther(2),
    ])) as LiquidSDAdapterMock

    await pool.addLSDToken(lsd1.address, adapter1.address, [10000])
    await pool.addLSDToken(lsd2.address, adapter2.address, [7000, 3000])
    await lsd1.approve(pool.address, ethers.constants.MaxUint256)
    await lsd2.approve(pool.address, ethers.constants.MaxUint256)
    await lsd1.connect(signers[1]).approve(pool.address, ethers.constants.MaxUint256)
    await lsd2.connect(signers[1]).approve(pool.address, ethers.constants.MaxUint256)
    await pool.connect(signers[1]).deposit(lsd1.address, toEther(2000))
    await pool.connect(signers[1]).deposit(lsd2.address, toEther(500))
  })

  it('addLSDToken should work correctly', async () => {
    let lsd3 = (await deploy('ERC677', ['Liquid SD Token 2', 'LSD2', 100000000])) as ERC677
    let adapter3 = (await deployUpgradeable('LiquidSDAdapterMock', [
      lsd3.address,
      pool.address,
      toEther(5),
    ])) as LiquidSDAdapterMock

    await pool.addLSDToken(lsd3.address, adapter3.address, [5000, 3000, 2000])
    assert.deepEqual(await pool.getLSDTokens(), [lsd1.address, lsd2.address, lsd3.address])
    assert.deepEqual(
      (await pool.getCompositionTargets()).map((t) => t.toNumber()),
      [5000, 3000, 2000]
    )
    assert.equal(await pool.lsdAdapters(lsd1.address), adapter1.address)
    assert.equal(await pool.lsdAdapters(lsd2.address), adapter2.address)
    assert.equal(await pool.lsdAdapters(lsd3.address), adapter3.address)
  })

  it('deposit should work correctly', async () => {
    await lsd1.connect(signers[2]).approve(pool.address, ethers.constants.MaxUint256)
    await lsd2.connect(signers[2]).approve(pool.address, ethers.constants.MaxUint256)
    await pool.connect(signers[2]).deposit(lsd1.address, toEther(1000))
    await pool.connect(signers[2]).deposit(lsd2.address, toEther(250))

    assert.equal(fromEther(await pool.balanceOf(accounts[1])), 3000)
    assert.equal(fromEther(await pool.balanceOf(accounts[2])), 1500)
    assert.equal(fromEther(await lsd1.balanceOf(adapter1.address)), 3000)
    assert.equal(fromEther(await lsd2.balanceOf(adapter2.address)), 750)
    assert.equal(fromEther(await pool.totalSupply()), 4500)

    await expect(pool.deposit(accounts[1], toEther(100))).to.be.revertedWith(
      'Token is not supported'
    )
    await expect(pool.deposit(lsd2.address, toEther(2000))).to.be.revertedWith(
      'Insufficient deposit room for the selected lsd'
    )
  })

  it('withdraw should work correctly', async () => {
    await lsd1.connect(signers[2]).approve(pool.address, ethers.constants.MaxUint256)
    await lsd2.connect(signers[2]).approve(pool.address, ethers.constants.MaxUint256)
    await pool.connect(signers[2]).deposit(lsd1.address, toEther(1000))
    await pool.connect(signers[2]).deposit(lsd2.address, toEther(250))

    await pool.connect(signers[1]).withdraw(toEther(200))

    assert.equal(fromEther(await pool.balanceOf(accounts[1])), 2800)
    assert.equal(fromEther(await pool.totalSupply()), 4300)
    assert.equal(fromEther(await lsd1.balanceOf(adapter1.address)), 3000)
    assert.equal(fromEther(await lsd2.balanceOf(adapter2.address)), 650)

    await pool.connect(signers[2]).withdraw(toEther(100))

    assert.equal(fromEther(await pool.balanceOf(accounts[2])), 1400)
    assert.equal(fromEther(await pool.totalSupply()), 4200)
    assert.equal(fromEther(await lsd1.balanceOf(adapter1.address)), 2940)
    assert.equal(fromEther(await lsd2.balanceOf(adapter2.address)), 630)

    await pool.connect(signers[2]).deposit(lsd1.address, toEther(500))
    await pool.connect(signers[2]).withdraw(toEther(200))

    assert.equal(fromEther(await pool.balanceOf(accounts[2])), 1700)
    assert.equal(fromEther(await pool.totalSupply()), 4500)
    assert.equal(fromEther(await lsd1.balanceOf(adapter1.address)), 3240)
    assert.equal(fromEther(await lsd2.balanceOf(adapter2.address)), 630)

    assert.equal(Number(fromEther(await lsd1.balanceOf(accounts[1])).toFixed(3)), 8000)
    assert.equal(Number(fromEther(await lsd2.balanceOf(accounts[1])).toFixed(3)), 9600)
    assert.equal(Number(fromEther(await lsd1.balanceOf(accounts[2])).toFixed(3)), 8760)
    assert.equal(Number(fromEther(await lsd2.balanceOf(accounts[2])).toFixed(3)), 9770)

    await expect(pool.connect(signers[1]).withdraw(toEther(5000))).to.be.revertedWith(
      'Burn amount exceeds balance'
    )
  })

  it('getting/setting compositionTargets should work correctly', async () => {
    assert.deepEqual(
      (await pool.getCompositionTargets()).map((t) => t.toNumber()),
      [7000, 3000]
    )
    await pool.setCompositionTargets([1000, 9000])
    assert.deepEqual(
      (await pool.getCompositionTargets()).map((t) => t.toNumber()),
      [1000, 9000]
    )

    await expect(pool.setCompositionTargets([2000, 3000])).to.be.revertedWith(
      'Composition targets must sum to 100%'
    )
    await expect(pool.setCompositionTargets([2000, 9000])).to.be.revertedWith(
      'Composition targets must sum to 100%'
    )
    await expect(pool.setCompositionTargets([10000])).to.be.revertedWith(
      'Invalid composition targets length'
    )
    await expect(pool.setCompositionTargets([1000, 2000, 7000])).to.be.revertedWith(
      'Invalid composition targets length'
    )
  })
  //3000
  //1900
  it.only('getComposition should work correctly', async () => {
    assert.deepEqual(
      (await pool.getComposition()).map((c) => c.toNumber()),
      [6666, 3333]
    )
    await pool.deposit(lsd1.address, toEther(1000))
    assert.deepEqual(
      (await pool.getComposition()).map((c) => c.toNumber()),
      [7500, 2500]
    )
    await pool.deposit(lsd2.address, toEther(500))
    assert.deepEqual(
      (await pool.getComposition()).map((c) => c.toNumber()),
      [6000, 4000]
    )
    await pool.withdraw(toEther(100))
    assert.deepEqual(
      (await pool.getComposition()).map((c) => c.toNumber()),
      [6122, 3877]
    )
    await pool.connect(signers[1]).withdraw(toEther(700))
    assert.deepEqual(
      (await pool.getComposition()).map((c) => c.toNumber()),
      [6999, 3000]
    )
  })

  it('getDepositRoom should work correctly', async () => {
    await adapter2.setExchangeRate(toEther(1))
    assert.equal(fromEther(await pool.getDepositRoom(lsd1.address)), 5000)
    assert.equal(fromEther(await pool.getDepositRoom(lsd2.address)), 2500)

    await pool.deposit(lsd1.address, toEther(5000))
    assert.equal(fromEther(await pool.getDepositRoom(lsd1.address)), 0)
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd2.address)).toFixed(3)), 5227.273)

    await pool.deposit(lsd2.address, toEther(2000))
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd1.address)).toFixed(3)), 7166.667)
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd2.address)).toFixed(3)), 3227.273)

    await pool.deposit(lsd2.address, toEther(3000))
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd1.address)).toFixed(3)), 24166.667)
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd2.address)).toFixed(3)), 227.273)

    await pool.setCompositionTolerance(2500)
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd1.address)).toFixed(3)), 11944.444)
    assert.equal(fromEther(await pool.getDepositRoom(lsd2.address)), 0)

    await pool.deposit(lsd1.address, toEther(6000))
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd1.address)).toFixed(3)), 5944.444)
    assert.equal(fromEther(await pool.getDepositRoom(lsd2.address)), 2300)

    await pool.setCompositionTolerance(8000)
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd1.address)).toFixed(3)), 73166.667)
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd2.address)).toFixed(3)), 9760.87)

    await pool.setCompositionEnforcementThreshold(toEther(30000))
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd1.address)).toFixed(3)), 73166.667)
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd2.address)).toFixed(3)), 9760.87)

    await pool.setCompositionEnforcementThreshold(toEther(100000))
    assert.equal(Number(fromEther(await pool.getDepositRoom(lsd1.address)).toFixed(3)), 73166.667)
    assert.equal(fromEther(await pool.getDepositRoom(lsd2.address)), 24500)

    await pool.setCompositionTargets([10000, 0])
    assert.equal(
      (await pool.getDepositRoom(lsd1.address)).toHexString(),
      ethers.constants.MaxUint256.sub(toEther(18500)).toHexString()
    )
    assert.equal(fromEther(await pool.getDepositRoom(lsd2.address)), 0)
  })

  it('getRewards should work correctly', async () => {
    assert.deepEqual(
      (await pool.getRewards()).map((e) => fromEther(e)),
      [0, 0]
    )

    await adapter1.setExchangeRate(toEther(1.5))
    await adapter2.setExchangeRate(toEther(1))

    assert.deepEqual(
      (await pool.getRewards()).map((e) => fromEther(e)),
      [500, 75]
    )

    pool.updateRewards()
    assert.deepEqual(
      (await pool.getRewards()).map((e) => fromEther(e)),
      [0, 0]
    )

    await adapter1.setExchangeRate(toEther(1))

    assert.deepEqual(
      (await pool.getRewards()).map((e) => fromEther(e)),
      [-1000, 0]
    )
  })

  it('updateRewards should work correctly', async () => {
    await pool.updateRewards()
    assert.equal(fromEther(await pool.totalSupply()), 3000)
    assert.equal(fromEther(await pool.balanceOf(accounts[3])), 0)
    assert.equal(fromEther(await pool.balanceOf(accounts[4])), 0)

    await adapter1.setExchangeRate(toEther(1.5))
    await adapter2.setExchangeRate(toEther(1))

    await pool.updateRewards()
    assert.equal(fromEther(await pool.totalSupply()), 3500)
    assert.equal(fromEther(await pool.balanceOf(accounts[3])), 50)
    assert.equal(fromEther(await pool.balanceOf(accounts[4])), 25)

    await adapter1.setExchangeRate(toEther(1))

    await pool.updateRewards()
    assert.equal(fromEther(await pool.totalSupply()), 2500)
    assert.equal(Number(fromEther(await pool.balanceOf(accounts[3])).toFixed(3)), 35.714)
    assert.equal(Number(fromEther(await pool.balanceOf(accounts[4])).toFixed(3)), 17.857)
  })
})
