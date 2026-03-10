import { assert, expect } from 'chai'
import { deploy, deployUpgradeable, fromEther, getAccounts, toEther, getConnection } from '../utils/helpers'
import { ERC677, LSDIndexAdapterMock } from '../../types/ethers-contracts'

const { ethers, loadFixture } = getConnection()

describe('LSDIndexAdapter', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

    const lsd = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Liquid SD Token',
      'LSD',
      100000000,
    ])) as ERC677

    const adapter = (await deployUpgradeable('LSDIndexAdapterMock', [
      lsd.target,
      accounts[0],
      toEther(2),
    ])) as LSDIndexAdapterMock

    await lsd.transfer(adapter.target, toEther(1000))

    return { signers, accounts, lsd, adapter }
  }

  it('getExchangeRate should work correctly', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(fromEther(await adapter.getExchangeRate()), 2)
  })

  it('getLSDByUnderlying should work correctly', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(fromEther(await adapter.getLSDByUnderlying(toEther(100))), 50)
  })

  it('getUnderlyingByLSD should work correctly', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(fromEther(await adapter.getUnderlyingByLSD(toEther(100))), 200)
  })

  it('getTotalDepositsLSD should work correctly', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(fromEther(await adapter.getTotalDepositsLSD()), 1000)
  })

  it('getTotalDeposits should work correctly', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(fromEther(await adapter.getTotalDeposits()), 2000)
  })

  it('index pool should be able to withdraw', async () => {
    const { signers, accounts, adapter, lsd } = await loadFixture(deployFixture)

    await lsd.transferFrom(adapter.target, accounts[1], toEther(500))
    assert.equal(fromEther(await adapter.getTotalDepositsLSD()), 500)
    assert.equal(fromEther(await adapter.getTotalDeposits()), 1000)

    await expect(lsd.connect(signers[1]).transferFrom(adapter.target, accounts[1], toEther(500))).to
      .revert(ethers)
  })
})
