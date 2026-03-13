import { assert, expect } from 'chai'
import { deploy, getAccounts, getConnection, toEther, fromEther } from '../utils/helpers'
import { EspressoRewardsConsumer, EspressoStrategyMock } from '../../types/ethers-contracts'

const { ethers, loadFixture } = getConnection()

describe('EspressoRewardsConsumer', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const strategyMock = (await deploy('EspressoStrategyMock')) as EspressoStrategyMock

    const consumer = (await deploy('EspressoRewardsConsumer', [
      accounts[0],
      strategyMock.target,
    ])) as EspressoRewardsConsumer

    return {
      signers,
      accounts,
      strategyMock,
      consumer,
    }
  }

  it('should deploy with correct state', async () => {
    const { accounts, consumer, strategyMock } = await loadFixture(deployFixture)

    assert.equal(await consumer.forwarder(), accounts[0])
    assert.equal(await consumer.strategy(), strategyMock.target)
  })

  it('onReport should forward lifetime rewards to strategy', async () => {
    const { consumer, strategyMock } = await loadFixture(deployFixture)

    const vaultIds = [0, 1, 2]
    const lifetimeRewards = [toEther(100), toEther(200), toEther(300)]

    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256[]', 'uint256[]'],
      [vaultIds, lifetimeRewards]
    )

    await consumer.onReport('0x', report)

    const lastVaultIds = await strategyMock.getLastVaultIds()
    const lastLifetimeRewards = await strategyMock.getLastLifetimeRewards()

    assert.equal(lastVaultIds.length, 3)
    assert.equal(Number(lastVaultIds[0]), 0)
    assert.equal(Number(lastVaultIds[1]), 1)
    assert.equal(Number(lastVaultIds[2]), 2)
    assert.equal(fromEther(lastLifetimeRewards[0]), 100)
    assert.equal(fromEther(lastLifetimeRewards[1]), 200)
    assert.equal(fromEther(lastLifetimeRewards[2]), 300)
    assert.equal(Number(await strategyMock.updateCount()), 1)
  })

  it('onReport should revert if caller is not forwarder', async () => {
    const { signers, consumer } = await loadFixture(deployFixture)

    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256[]', 'uint256[]'],
      [[0], [toEther(100)]]
    )

    await expect(consumer.connect(signers[1]).onReport('0x', report))
      .to.be.revertedWithCustomError(consumer, 'OnlyForwarder')
      .withArgs(await signers[1].getAddress())
  })

  it('supportsInterface should return true for IReceiver', async () => {
    const { consumer } = await loadFixture(deployFixture)

    // IReceiver interfaceId = bytes4(keccak256("onReport(bytes,bytes)"))
    const iReceiverInterfaceId = ethers.id('onReport(bytes,bytes)').slice(0, 10)

    assert.equal(await consumer.supportsInterface(iReceiverInterfaceId), true)
  })

  it('supportsInterface should return true for IERC165', async () => {
    const { consumer } = await loadFixture(deployFixture)

    // IERC165 interfaceId = 0x01ffc9a7
    assert.equal(await consumer.supportsInterface('0x01ffc9a7'), true)
  })

  it('supportsInterface should return false for unsupported interfaces', async () => {
    const { consumer } = await loadFixture(deployFixture)

    assert.equal(await consumer.supportsInterface('0xffffffff'), false)
    assert.equal(await consumer.supportsInterface('0x00000000'), false)
  })
})
