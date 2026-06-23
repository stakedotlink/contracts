import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { deploy, getAccounts } from '../utils/helpers'
import { EspressoRewardsConsumer, EspressoStrategyMock } from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

// 10-byte (bytes10) CRE workflow name authorized to produce reports
const WORKFLOW_NAME = ethers.hexlify(ethers.toUtf8Bytes('esprewards'))

// Builds the 64-byte Keystone metadata the forwarder passes to onReport:
// workflow_cid(32) || workflow_name(10) || workflow_owner(20) || report_id(2)
function buildMetadata(workflowName: string, workflowOwner: string): string {
  return ethers.concat([
    ethers.ZeroHash, // workflow_cid (32 bytes, unused by the consumer)
    workflowName, // workflow_name (10 bytes)
    workflowOwner, // workflow_owner (20 bytes)
    '0x0001', // report_id (2 bytes)
  ])
}

describe('EspressoRewardsConsumer', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const strategyMock = (await deploy('EspressoStrategyMock')) as EspressoStrategyMock

    // forwarder = accounts[0] so the default signer can deliver reports
    // workflowOwner = accounts[5] is the authorized CRE workflow owner
    const consumer = (await deploy('EspressoRewardsConsumer', [
      accounts[0],
      strategyMock.target,
      accounts[5],
      WORKFLOW_NAME,
    ])) as EspressoRewardsConsumer

    return {
      signers,
      accounts,
      strategyMock,
      consumer,
      workflowOwner: accounts[5],
    }
  }

  it('should deploy with correct state', async () => {
    const { accounts, consumer, strategyMock } = await loadFixture(deployFixture)

    assert.equal(await consumer.forwarder(), accounts[0])
    assert.equal(await consumer.strategy(), strategyMock.target)
    assert.equal(await consumer.workflowOwner(), accounts[5])
    assert.equal(await consumer.workflowName(), WORKFLOW_NAME)
  })

  it('onReport should forward lifetime rewards to strategy for an authorized workflow', async () => {
    const { consumer, strategyMock, workflowOwner } = await loadFixture(deployFixture)

    const vaultIds = [0, 1, 2]
    const lifetimeRewards = [
      ethers.parseEther('100'),
      ethers.parseEther('200'),
      ethers.parseEther('300'),
    ]

    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256[]', 'uint256[]'],
      [vaultIds, lifetimeRewards]
    )

    await consumer.onReport(buildMetadata(WORKFLOW_NAME, workflowOwner), report)

    const lastVaultIds = await strategyMock.getLastVaultIds()
    const lastLifetimeRewards = await strategyMock.getLastLifetimeRewards()

    assert.equal(lastVaultIds.length, 3)
    assert.equal(Number(lastVaultIds[0]), 0)
    assert.equal(Number(lastVaultIds[1]), 1)
    assert.equal(Number(lastVaultIds[2]), 2)
    assert.equal(lastLifetimeRewards[0], ethers.parseEther('100'))
    assert.equal(lastLifetimeRewards[1], ethers.parseEther('200'))
    assert.equal(lastLifetimeRewards[2], ethers.parseEther('300'))
    assert.equal(Number(await strategyMock.updateCount()), 1)
  })

  it('onReport should revert if caller is not forwarder', async () => {
    const { signers, consumer, workflowOwner } = await loadFixture(deployFixture)

    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256[]', 'uint256[]'],
      [[0], [ethers.parseEther('100')]]
    )

    await expect(
      consumer.connect(signers[1]).onReport(buildMetadata(WORKFLOW_NAME, workflowOwner), report)
    )
      .to.be.revertedWithCustomError(consumer, 'OnlyForwarder')
      .withArgs(await signers[1].getAddress())
  })

  // A report can be correctly DON-signed and delivered by the trusted forwarder yet originate from
  // a different (attacker-deployed) workflow on the same shared DON. The forwarder stamps the real
  // workflow owner into the metadata, so the consumer must reject any owner that is not authorized.
  it('onReport should revert if the workflow owner is not authorized (forged report)', async () => {
    const { accounts, consumer, strategyMock } = await loadFixture(deployFixture)

    const attacker = accounts[6]
    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256[]', 'uint256[]'],
      [[0], [ethers.parseEther('1000000')]]
    )

    await expect(consumer.onReport(buildMetadata(WORKFLOW_NAME, attacker), report))
      .to.be.revertedWithCustomError(consumer, 'UnauthorizedWorkflow')
      .withArgs(attacker, WORKFLOW_NAME)

    // strategy must not have been touched
    assert.equal(Number(await strategyMock.updateCount()), 0)
  })

  it('onReport should revert if the workflow name is not authorized', async () => {
    const { consumer, strategyMock, workflowOwner } = await loadFixture(deployFixture)

    const wrongName = ethers.hexlify(ethers.toUtf8Bytes('evilflow00'))
    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256[]', 'uint256[]'],
      [[0], [ethers.parseEther('1000000')]]
    )

    await expect(consumer.onReport(buildMetadata(wrongName, workflowOwner), report))
      .to.be.revertedWithCustomError(consumer, 'UnauthorizedWorkflow')
      .withArgs(workflowOwner, wrongName)

    assert.equal(Number(await strategyMock.updateCount()), 0)
  })

  it('onReport should revert on malformed (empty) metadata', async () => {
    const { consumer } = await loadFixture(deployFixture)

    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256[]', 'uint256[]'],
      [[0], [ethers.parseEther('100')]]
    )

    await expect(consumer.onReport('0x', report)).to.be.revertedWithCustomError(
      consumer,
      'UnauthorizedWorkflow'
    )
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
