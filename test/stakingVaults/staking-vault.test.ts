import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  getConnection,
} from '../utils/helpers'
import type {
  ERC677,
  StakingVault,
  VaultHubMock,
  StakingVaultFactoryMock,
  StakingAdapterMock,
} from '../../types/ethers-contracts'

const { ethers, loadFixture } = getConnection()

describe('StakingVault', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    const hub = (await deploy('VaultHubMock', [])) as VaultHubMock
    const factory = (await deploy('StakingVaultFactoryMock', [])) as StakingVaultFactoryMock

    const vault = (await deployUpgradeable(
      'StakingVault',
      [accounts[0], accounts[0], accounts[0]],
      {
        constructorArgs: [token.target, hub.target, factory.target],
        unsafeAllow: ['state-variable-immutable', 'constructor'],
      }
    )) as StakingVault

    const adapter = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock

    await factory.setDeployedAdapter(adapter.target, true)
    await token.transfer(adapter.target, toEther(1000))
    await token.approve(vault.target, ethers.MaxUint256)

    await vault.addAdapter(adapter.target)

    return { signers, accounts, token, hub, factory, vault, adapter }
  }

  it('initialize should work correctly', async () => {
    const { vault, token, hub, factory, accounts } = await loadFixture(deployFixture)

    assert.equal(await vault.token(), token.target)
    assert.equal(await vault.hub(), hub.target)
    assert.equal(await vault.factory(), factory.target)
    assert.equal(await vault.owner(), accounts[0])
    assert.equal(await vault.operator(), accounts[0])
    assert.equal(await vault.allocator(), accounts[0])
    assert.equal(await vault.ossified(), false)
    assert.equal(await token.allowance(vault.target, hub.target), ethers.MaxUint256)
  })

  it('version should work correctly', async () => {
    const { vault } = await loadFixture(deployFixture)
    assert.equal(await vault.version(), 1)
  })

  it('getAdapters should work correctly', async () => {
    const { vault, adapter } = await loadFixture(deployFixture)

    const adapters = await vault.getAdapters()
    assert.equal(adapters.length, 1)
    assert.equal(adapters[0], adapter.target)
  })

  it('idleBalance should work correctly', async () => {
    const { vault } = await loadFixture(deployFixture)

    assert.equal(fromEther(await vault.idleBalance()), 0)
    await vault.deposit(toEther(100))
    assert.equal(fromEther(await vault.idleBalance()), 100)
  })

  it('stakedBalance should work correctly', async () => {
    const { vault, adapter, token, factory } = await loadFixture(deployFixture)

    assert.equal(fromEther(await vault.stakedBalance()), 0)

    // Deploy a second adapter
    const adapter2 = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock
    await factory.setDeployedAdapter(adapter2.target, true)

    await vault.addAdapter(adapter2.target)
    await vault.deposit(toEther(200))

    assert.equal(fromEther(await vault.stakedBalance()), 0)

    await vault.stake(adapter.target, toEther(80))
    await vault.stake(adapter2.target, toEther(50))

    // Should sum deposits across both adapters (80 + 50 = 130)
    assert.equal(fromEther(await vault.stakedBalance()), 130)
    // Idle should be 200 - 130 = 70
    assert.equal(fromEther(await vault.idleBalance()), 70)
  })

  it('deposit should work correctly', async () => {
    const { vault, token, hub, accounts, signers } = await loadFixture(deployFixture)

    const balanceBefore = await token.balanceOf(accounts[0])
    await vault.deposit(toEther(100))

    // Tokens transferred to vault
    assert.equal(fromEther(await token.balanceOf(vault.target)), 100)
    assert.equal(fromEther(balanceBefore - (await token.balanceOf(accounts[0]))), 100)

    // Hub inOutDelta updated
    assert.equal(fromEther(await hub.inOutDelta()), 100)

    // Emits Deposited event
    await expect(vault.deposit(toEther(50)))
      .to.emit(vault, 'Deposited')
      .withArgs(accounts[0], toEther(50))

    // Second deposit accumulates
    assert.equal(fromEther(await token.balanceOf(vault.target)), 150)
    assert.equal(fromEther(await hub.inOutDelta()), 150)

    // Reverts on zero amount
    await expect(vault.deposit(0)).to.be.revertedWithCustomError(vault, 'ZeroAmount')

    // Reverts if caller is not owner
    await expect(
      (vault.connect(signers[1]) as any).deposit(toEther(10))
    ).to.be.revertedWithCustomError(vault, 'OnlyOwner')
  })

  it('stake should work correctly', async () => {
    const { vault, adapter, token, hub, factory, signers, accounts } = await loadFixture(
      deployFixture
    )

    await vault.deposit(toEther(200))

    // Stake transfers tokens from vault to adapter
    await vault.stake(adapter.target, toEther(80))
    assert.equal(fromEther(await adapter.getTotalDeposits()), 80)
    assert.equal(fromEther(await vault.idleBalance()), 120)

    // Stake more accumulates
    await vault.stake(adapter.target, toEther(50))
    assert.equal(fromEther(await adapter.getTotalDeposits()), 130)
    assert.equal(fromEther(await vault.idleBalance()), 70)

    // Stake into second adapter
    const adapter2 = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock
    await factory.setDeployedAdapter(adapter2.target, true)
    await vault.addAdapter(adapter2.target)

    await vault.stake(adapter2.target, toEther(30))
    assert.equal(fromEther(await adapter2.getTotalDeposits()), 30)
    assert.equal(fromEther(await vault.idleBalance()), 40)

    // Emits Staked event with viaAllocator=false
    await expect(vault.stake(adapter.target, toEther(10)))
      .to.emit(vault, 'Staked')
      .withArgs(adapter.target, toEther(10), false)

    // Reverts if caller is not operator
    await expect(
      (vault.connect(signers[1]) as any).stake(adapter.target, toEther(10))
    ).to.be.revertedWithCustomError(vault, 'OnlyOperator')

    // Reverts if adapter is not registered
    await expect(vault.stake(accounts[5], toEther(10))).to.be.revertedWithCustomError(
      vault,
      'AdapterNotRegistered'
    )

    // Reverts if amount is zero
    await expect(vault.stake(adapter.target, 0)).to.be.revertedWithCustomError(vault, 'ZeroAmount')

    // Reverts if hub blocks staking
    await hub.setStakeableAmount(0)
    await expect(vault.stake(adapter.target, toEther(10))).to.be.revertedWithCustomError(
      vault,
      'StakeBlockedByHub'
    )
  })

  it('stakeViaAllocator should work correctly', async () => {
    const { vault, adapter, signers } = await loadFixture(deployFixture)

    await vault.deposit(toEther(100))

    // Emits Staked event with viaAllocator=true
    await expect(vault.stakeViaAllocator(adapter.target, toEther(50)))
      .to.emit(vault, 'Staked')
      .withArgs(adapter.target, toEther(50), true)

    assert.equal(fromEther(await adapter.getTotalDeposits()), 50)

    // Reverts if caller is not allocator
    await expect(
      (vault.connect(signers[1]) as any).stakeViaAllocator(adapter.target, toEther(10))
    ).to.be.revertedWithCustomError(vault, 'OnlyAllocator')
  })

  it('withdraw should work correctly', async () => {
    const { vault, token, hub, signers, accounts } = await loadFixture(deployFixture)

    await vault.deposit(toEther(200))

    // Withdraw transfers tokens to recipient
    const balBefore = await token.balanceOf(accounts[5])
    await vault.withdraw(toEther(60), accounts[5])
    assert.equal(fromEther((await token.balanceOf(accounts[5])) - balBefore), 60)
    assert.equal(fromEther(await vault.idleBalance()), 140)

    // Hub inOutDelta updated: +200 deposit - 60 withdrawal = 140
    assert.equal(fromEther(await hub.inOutDelta()), 140)

    // Withdraw to a different recipient
    const balBefore2 = await token.balanceOf(accounts[6])
    await vault.withdraw(toEther(40), accounts[6])
    assert.equal(fromEther((await token.balanceOf(accounts[6])) - balBefore2), 40)
    assert.equal(fromEther(await vault.idleBalance()), 100)
    assert.equal(fromEther(await hub.inOutDelta()), 100)

    // Emits Withdrawn event
    await expect(vault.withdraw(toEther(10), accounts[5]))
      .to.emit(vault, 'Withdrawn')
      .withArgs(accounts[5], toEther(10))

    // Reverts if amount exceeds canWithdraw
    await hub.setWithdrawableAmount(toEther(5))
    await expect(vault.withdraw(toEther(10), accounts[5])).to.be.revertedWithCustomError(
      vault,
      'WithdrawBlockedByHub'
    )

    // Succeeds at exactly canWithdraw amount
    const balBefore3 = await token.balanceOf(accounts[5])
    await vault.withdraw(toEther(5), accounts[5])
    assert.equal(fromEther((await token.balanceOf(accounts[5])) - balBefore3), 5)

    // Reverts if amount is zero
    await expect(vault.withdraw(0, accounts[3])).to.be.revertedWithCustomError(vault, 'ZeroAmount')

    // Reverts if recipient is zero address
    await hub.setWithdrawableAmount(toEther(100))
    await expect(vault.withdraw(toEther(1), ethers.ZeroAddress)).to.be.revertedWithCustomError(
      vault,
      'ZeroAddress'
    )

    // Reverts if caller is not owner
    await expect(
      (vault.connect(signers[1]) as any).withdraw(toEther(1), accounts[3])
    ).to.be.revertedWithCustomError(vault, 'OnlyOwner')
  })

  it('unstake should work correctly', async () => {
    const { vault, adapter, token, factory, signers } = await loadFixture(deployFixture)

    await vault.deposit(toEther(200))
    await vault.stake(adapter.target, toEther(200))

    // Unstake moves tokens from adapter back to vault idle
    await vault.unstake(adapter.target, toEther(60))
    assert.equal(fromEther(await adapter.getTotalDeposits()), 140)
    assert.equal(fromEther(await vault.idleBalance()), 60)

    // Unstake more
    await vault.unstake(adapter.target, toEther(40))
    assert.equal(fromEther(await adapter.getTotalDeposits()), 100)
    assert.equal(fromEther(await vault.idleBalance()), 100)

    // Unstake from a second adapter
    const adapter2 = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock
    await factory.setDeployedAdapter(adapter2.target, true)
    await vault.addAdapter(adapter2.target)

    await vault.stake(adapter2.target, toEther(50))
    await vault.unstake(adapter2.target, toEther(30))
    assert.equal(fromEther(await adapter2.getTotalDeposits()), 20)
    assert.equal(fromEther(await vault.idleBalance()), 80)

    // Emits Unstaked event
    await expect(vault.unstake(adapter.target, toEther(10)))
      .to.emit(vault, 'Unstaked')
      .withArgs(adapter.target, toEther(10))

    // Reverts if caller is not operator
    await expect(
      (vault.connect(signers[1]) as any).unstake(adapter.target, toEther(10))
    ).to.be.revertedWithCustomError(vault, 'OnlyOperator')

    // Reverts if adapter is not registered
    await expect(vault.unstake(signers[3].address, toEther(10))).to.be.revertedWithCustomError(
      vault,
      'AdapterNotRegistered'
    )

    // Reverts if amount is zero
    await expect(vault.unstake(adapter.target, 0)).to.be.revertedWithCustomError(
      vault,
      'ZeroAmount'
    )
  })

  it('unbond should work correctly', async () => {
    const { vault, adapter, signers } = await loadFixture(deployFixture)

    // Emits Unbonded event
    await expect(vault.unbond(adapter.target)).to.emit(vault, 'Unbonded').withArgs(adapter.target)

    // Reverts if caller is not operator
    await expect(
      (vault.connect(signers[1]) as any).unbond(adapter.target)
    ).to.be.revertedWithCustomError(vault, 'OnlyOperator')

    // Reverts if adapter is not registered
    await expect(vault.unbond(signers[3].address)).to.be.revertedWithCustomError(
      vault,
      'AdapterNotRegistered'
    )
  })

  it('claimRewards should work correctly', async () => {
    const { vault, adapter, token, factory, signers } = await loadFixture(deployFixture)

    // Set up rewards on adapter
    await adapter.setRewards(toEther(25))

    // Claim rewards — tokens stay in vault as idle
    const idleBefore = await vault.idleBalance()
    await vault.claimRewards([adapter.target])
    assert.equal(fromEther((await vault.idleBalance()) - idleBefore), 25)

    // Emits RewardsClaimed event
    await adapter.setRewards(toEther(10))
    await expect(vault.claimRewards([adapter.target]))
      .to.emit(vault, 'RewardsClaimed')
      .withArgs(adapter.target, toEther(10))

    // No event emitted if rewards are zero
    await expect(vault.claimRewards([adapter.target])).to.not.emit(vault, 'RewardsClaimed')

    // Works with a second adapter
    const adapter2 = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock
    await factory.setDeployedAdapter(adapter2.target, true)
    await token.transfer(adapter2.target, toEther(1000))
    await vault.addAdapter(adapter2.target)

    await adapter2.setRewards(toEther(15))
    const idleBefore2 = await vault.idleBalance()
    await expect(vault.claimRewards([adapter2.target]))
      .to.emit(vault, 'RewardsClaimed')
      .withArgs(adapter2.target, toEther(15))
    assert.equal(fromEther((await vault.idleBalance()) - idleBefore2), 15)

    // Claim from multiple adapters in one call
    await adapter.setRewards(toEther(8))
    await adapter2.setRewards(toEther(12))
    const idleBefore3 = await vault.idleBalance()
    await vault.claimRewards([adapter.target, adapter2.target])
    assert.equal(fromEther((await vault.idleBalance()) - idleBefore3), 20)

    // Reverts if caller is not operator
    await adapter.setRewards(toEther(5))
    await expect(
      (vault.connect(signers[1]) as any).claimRewards([adapter.target])
    ).to.be.revertedWithCustomError(vault, 'OnlyOperator')

    // Reverts if adapter is not registered
    await expect(vault.claimRewards([signers[3].address])).to.be.revertedWithCustomError(
      vault,
      'AdapterNotRegistered'
    )
  })

  it('addAdapter should work correctly', async () => {
    const { vault, adapter, token, factory, signers, accounts } = await loadFixture(deployFixture)

    // Adapter already added in fixture — verify state
    assert.equal(await vault.isAdapter(adapter.target), true)
    assert.equal((await vault.getAdapters()).length, 1)
    assert.equal(await token.allowance(vault.target, adapter.target), ethers.MaxUint256)

    // Add a second adapter
    const adapter2 = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock
    await factory.setDeployedAdapter(adapter2.target, true)

    await expect(vault.addAdapter(adapter2.target))
      .to.emit(vault, 'AdapterAdded')
      .withArgs(adapter2.target)

    assert.equal(await vault.isAdapter(adapter2.target), true)
    assert.equal((await vault.getAdapters()).length, 2)
    assert.equal(await token.allowance(vault.target, adapter2.target), ethers.MaxUint256)

    // Reverts if adapter already registered
    await expect(vault.addAdapter(adapter.target)).to.be.revertedWithCustomError(
      vault,
      'AdapterAlreadyRegistered'
    )

    // Reverts if adapter not from factory
    const rogue = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock
    await expect(vault.addAdapter(rogue.target)).to.be.revertedWithCustomError(
      vault,
      'AdapterNotFromFactory'
    )

    // Reverts if adapter vault mismatch
    const wrongAdapter = (await deploy('StakingAdapterMock', [
      accounts[5],
      token.target,
    ])) as StakingAdapterMock
    await factory.setDeployedAdapter(wrongAdapter.target, true)
    await expect(vault.addAdapter(wrongAdapter.target)).to.be.revertedWithCustomError(
      vault,
      'AdapterVaultMismatch'
    )

    // Reverts if caller is not owner
    const adapter3 = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock
    await factory.setDeployedAdapter(adapter3.target, true)
    await expect(
      (vault.connect(signers[1]) as any).addAdapter(adapter3.target)
    ).to.be.revertedWithCustomError(vault, 'OnlyOwner')
  })

  it('removeAdapter should work correctly', async () => {
    const { vault, adapter, token, factory, signers } = await loadFixture(deployFixture)

    // Remove adapter — check state and approval revoked
    await expect(vault.removeAdapter(adapter.target))
      .to.emit(vault, 'AdapterRemoved')
      .withArgs(adapter.target)

    assert.equal(await vault.isAdapter(adapter.target), false)
    assert.equal((await vault.getAdapters()).length, 0)
    assert.equal(await token.allowance(vault.target, adapter.target), 0n)

    // Add two adapters, remove the first — check swap-and-pop works
    const adapter2 = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock
    const adapter3 = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock
    await factory.setDeployedAdapter(adapter.target, true)
    await factory.setDeployedAdapter(adapter2.target, true)
    await factory.setDeployedAdapter(adapter3.target, true)

    await vault.addAdapter(adapter.target)
    await vault.addAdapter(adapter2.target)
    await vault.addAdapter(adapter3.target)

    await vault.removeAdapter(adapter.target)
    const remaining = await vault.getAdapters()
    assert.equal(remaining.length, 2)
    assert.equal(await vault.isAdapter(adapter.target), false)
    assert.equal(await vault.isAdapter(adapter2.target), true)
    assert.equal(await vault.isAdapter(adapter3.target), true)

    // Reverts if adapter has deposits
    await vault.deposit(toEther(100))
    await vault.stake(adapter2.target, toEther(50))
    await expect(vault.removeAdapter(adapter2.target)).to.be.revertedWithCustomError(
      vault,
      'AdapterHasDeposits'
    )

    // Reverts if adapter is not registered
    await expect(vault.removeAdapter(adapter.target)).to.be.revertedWithCustomError(
      vault,
      'AdapterNotRegistered'
    )

    // Reverts if caller is not owner
    await expect(
      (vault.connect(signers[1]) as any).removeAdapter(adapter3.target)
    ).to.be.revertedWithCustomError(vault, 'OnlyOwner')
  })

  it('initiateAdapterExit should work correctly', async () => {
    const { vault, adapter, signers } = await loadFixture(deployFixture)

    // Calls adapter.initiateExit and emits event
    await expect(vault.initiateAdapterExit(adapter.target))
      .to.emit(vault, 'AdapterExitInitiated')
      .withArgs(adapter.target)

    assert.equal(await adapter.exitInitiated(), true)

    // Reverts if adapter is not registered
    await expect(vault.initiateAdapterExit(signers[3].address)).to.be.revertedWithCustomError(
      vault,
      'AdapterNotRegistered'
    )

    // Reverts if caller is not owner
    await expect(
      (vault.connect(signers[1]) as any).initiateAdapterExit(adapter.target)
    ).to.be.revertedWithCustomError(vault, 'OnlyOwner')
  })

  it('finalizeAdapterExit should work correctly', async () => {
    const { vault, adapter, signers } = await loadFixture(deployFixture)

    // Stake tokens then finalize exit — tokens return to vault
    await vault.deposit(toEther(100))
    await vault.stake(adapter.target, toEther(100))
    assert.equal(fromEther(await vault.idleBalance()), 0)

    await expect(vault.finalizeAdapterExit(adapter.target))
      .to.emit(vault, 'AdapterExitFinalized')
      .withArgs(adapter.target, toEther(100))

    assert.equal(await adapter.exitFinalized(), true)
    assert.equal(fromEther(await vault.idleBalance()), 100)
    assert.equal(fromEther(await adapter.getTotalDeposits()), 0)

    // Works with rewards included — adapter returns principal + rewards
    await vault.stake(adapter.target, toEther(80))
    await adapter.setRewards(toEther(10))

    const idleBefore = await vault.idleBalance()
    await vault.finalizeAdapterExit(adapter.target)
    // Should recover 80 principal + 10 rewards = 90
    assert.equal(fromEther((await vault.idleBalance()) - idleBefore), 90)

    // Reverts if adapter is not registered
    await expect(vault.finalizeAdapterExit(signers[3].address)).to.be.revertedWithCustomError(
      vault,
      'AdapterNotRegistered'
    )

    // Reverts if caller is not owner
    await expect(
      (vault.connect(signers[1]) as any).finalizeAdapterExit(adapter.target)
    ).to.be.revertedWithCustomError(vault, 'OnlyOwner')
  })

  it('updateTotalValue should work correctly', async () => {
    const { vault, adapter, token, hub, factory, signers } = await loadFixture(deployFixture)

    // Reports idle balance only (no staked)
    await vault.deposit(toEther(100))
    await expect(vault.updateTotalValue())
      .to.emit(vault, 'TotalValueUpdated')
      .withArgs(toEther(100))
    assert.equal(fromEther(await hub.lastReportedValue()), 100)

    // Reports idle + staked across multiple adapters
    const adapter2 = (await deploy('StakingAdapterMock', [
      vault.target,
      token.target,
    ])) as StakingAdapterMock
    await factory.setDeployedAdapter(adapter2.target, true)
    await vault.addAdapter(adapter2.target)

    await vault.stake(adapter.target, toEther(40))
    await vault.stake(adapter2.target, toEther(30))
    // idle: 30, adapter1: 40, adapter2: 30 = 100
    await vault.updateTotalValue()
    assert.equal(fromEther(await hub.lastReportedValue()), 100)

    // Callable by anyone (permissionless)
    await (vault.connect(signers[5]) as any).updateTotalValue()
  })

  it('rebalance should work correctly', async () => {
    const { vault, adapter, token, hub, signers } = await loadFixture(deployFixture)

    const hubSigner = await ethers.getImpersonatedSigner(hub.target as string)
    await signers[0].sendTransaction({ to: hub.target, value: toEther(1) })

    await vault.deposit(toEther(200))
    await vault.stake(adapter.target, toEther(150))

    // Uses idle tokens first — transfers to hub
    const hubBalBefore = await token.balanceOf(hub.target)
    await (vault.connect(hubSigner) as any).rebalance(toEther(30))
    assert.equal(fromEther((await token.balanceOf(hub.target)) - hubBalBefore), 30)
    assert.equal(fromEther(await vault.idleBalance()), 20) // 50 - 30
    assert.equal(fromEther(await adapter.getTotalDeposits()), 150) // adapter unchanged

    // Unstakes from adapters when idle is insufficient
    await adapter.setUnstakeableAmount(toEther(150))
    const hubBal2 = await token.balanceOf(hub.target)
    await (vault.connect(hubSigner) as any).rebalance(toEther(50))
    // idle was 20, needed 50, so unstaked 30 from adapter, all 50 sent to hub
    assert.equal(fromEther((await token.balanceOf(hub.target)) - hubBal2), 50)
    assert.equal(fromEther(await adapter.getTotalDeposits()), 120)

    // Partial recovery — adapter can't fully cover, gets unbonded for next attempt
    await adapter.setUnstakeableAmount(0)
    assert.equal(await adapter.unbonded(), false)
    const hubBal3 = await token.balanceOf(hub.target)
    const idleBefore = await vault.idleBalance()
    await (vault.connect(hubSigner) as any).rebalance(toEther(200))
    // Only idle recovered (no unstake possible), adapter got unbonded
    assert.equal(fromEther((await token.balanceOf(hub.target)) - hubBal3), fromEther(idleBefore))
    assert.equal(fromEther(await vault.idleBalance()), 0)
    assert.equal(await adapter.unbonded(), true)

    // Emits Rebalanced event with actual recovered amount
    await adapter.setUnstakeableAmount(toEther(50))
    await expect((vault.connect(hubSigner) as any).rebalance(toEther(30)))
      .to.emit(vault, 'Rebalanced')
      .withArgs(toEther(30))

    // Reverts if caller is not hub
    await expect(vault.rebalance(toEther(10))).to.be.revertedWithCustomError(vault, 'OnlyHub')

    // Reverts if amount is zero
    await expect((vault.connect(hubSigner) as any).rebalance(0)).to.be.revertedWithCustomError(
      vault,
      'ZeroAmount'
    )
  })

  it('transferOwnership should work correctly', async () => {
    const { vault, signers, accounts } = await loadFixture(deployFixture)

    // Sets pending owner
    await vault.transferOwnership(accounts[3])
    assert.equal(await vault.pendingOwner(), accounts[3])
    assert.equal(await vault.owner(), accounts[0]) // unchanged until accepted

    // Emits OwnershipTransferStarted event
    await expect(vault.transferOwnership(accounts[4]))
      .to.emit(vault, 'OwnershipTransferStarted')
      .withArgs(accounts[0], accounts[4])

    // Reverts if new owner is zero address
    await expect(vault.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      vault,
      'ZeroAddress'
    )

    // Reverts if caller is not owner
    await expect(
      (vault.connect(signers[1]) as any).transferOwnership(accounts[3])
    ).to.be.revertedWithCustomError(vault, 'OnlyOwner')
  })

  it('acceptOwnership should work correctly', async () => {
    const { vault, signers, accounts } = await loadFixture(deployFixture)

    await vault.transferOwnership(accounts[3])

    // Completes transfer and clears pending owner
    await expect((vault.connect(signers[3]) as any).acceptOwnership())
      .to.emit(vault, 'OwnershipTransferred')
      .withArgs(accounts[0], accounts[3])

    assert.equal(await vault.owner(), accounts[3])
    assert.equal(await vault.pendingOwner(), ethers.ZeroAddress)

    // New owner can perform owner actions
    await (vault.connect(signers[3]) as any).setOperator(accounts[5])
    assert.equal(await vault.operator(), accounts[5])

    // Old owner can no longer act
    await expect(vault.setOperator(accounts[1])).to.be.revertedWithCustomError(vault, 'OnlyOwner')

    // Reverts if caller is not pending owner
    await (vault.connect(signers[3]) as any).transferOwnership(accounts[5])
    await expect(vault.acceptOwnership()).to.be.revertedWithCustomError(vault, 'OnlyPendingOwner')
  })

  it('setOperator should work correctly', async () => {
    const { vault, signers, accounts } = await loadFixture(deployFixture)

    // Updates operator
    await expect(vault.setOperator(accounts[3]))
      .to.emit(vault, 'OperatorUpdated')
      .withArgs(accounts[3])
    assert.equal(await vault.operator(), accounts[3])

    // New operator can stake
    await vault.deposit(toEther(50))
    await (vault.connect(signers[3]) as any).stake(vault.getAdapters().then((a: any) => a[0]), toEther(10))

    // Old operator (accounts[0]) is also owner so still works — test with a non-owner
    await vault.setOperator(accounts[4])
    await expect(
      (vault.connect(signers[3]) as any).stake(vault.getAdapters().then((a: any) => a[0]), toEther(10))
    ).to.be.revertedWithCustomError(vault, 'OnlyOperator')

    // Reverts if zero address
    await expect(vault.setOperator(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      vault,
      'ZeroAddress'
    )

    // Reverts if caller is not owner
    await expect(
      (vault.connect(signers[1]) as any).setOperator(accounts[3])
    ).to.be.revertedWithCustomError(vault, 'OnlyOwner')
  })

  it('setAllocator should work correctly', async () => {
    const { vault, signers, accounts } = await loadFixture(deployFixture)

    // Updates allocator
    await expect(vault.setAllocator(accounts[3]))
      .to.emit(vault, 'AllocatorUpdated')
      .withArgs(accounts[3])
    assert.equal(await vault.allocator(), accounts[3])

    // Allows zero address to disable
    await vault.setAllocator(ethers.ZeroAddress)
    assert.equal(await vault.allocator(), ethers.ZeroAddress)

    // Reverts if caller is not owner
    await expect(
      (vault.connect(signers[1]) as any).setAllocator(accounts[3])
    ).to.be.revertedWithCustomError(vault, 'OnlyOwner')
  })

  it('ossify should work correctly', async () => {
    const { vault, token, hub, factory, signers } = await loadFixture(deployFixture)

    assert.equal(await vault.ossified(), false)

    // Ossifies the vault
    await expect(vault.ossify()).to.emit(vault, 'Ossified')
    assert.equal(await vault.ossified(), true)

    // Blocks upgrades after ossification
    const { upgradesApi } = getConnection()
    const V2 = await ethers.getContractFactory('StakingVault', {
      libraries: {},
    })
    await expect(
      upgradesApi.upgradeProxy(vault.target, V2, {
        constructorArgs: [token.target, hub.target, factory.target],
        unsafeAllow: ['state-variable-immutable', 'constructor'],
      })
    ).to.be.revertedWithCustomError(vault, 'VaultOssified')

    // Reverts if caller is not owner
    await expect((vault.connect(signers[1]) as any).ossify()).to.be.revertedWithCustomError(
      vault,
      'OnlyOwner'
    )
  })

  it('recoverERC20 should work correctly', async () => {
    const { vault, token, signers, accounts } = await loadFixture(deployFixture)

    // Deploy a separate token to recover
    const otherToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Other',
      'OTH',
      1000000000,
    ])) as ERC677

    // Send other token to vault accidentally
    await otherToken.transfer(vault.target, toEther(50))

    // Recover tokens to recipient
    const balBefore = await otherToken.balanceOf(accounts[5])
    await expect(vault.recoverERC20(otherToken.target, accounts[5], toEther(50)))
      .to.emit(vault, 'ERC20Recovered')
      .withArgs(otherToken.target, accounts[5], toEther(50))
    assert.equal(fromEther((await otherToken.balanceOf(accounts[5])) - balBefore), 50)

    // Reverts if recovering staking token
    await expect(
      vault.recoverERC20(token.target, accounts[5], toEther(1))
    ).to.be.revertedWithCustomError(vault, 'CannotRecoverStakingToken')

    // Reverts if token address is zero
    await expect(
      vault.recoverERC20(ethers.ZeroAddress, accounts[5], toEther(1))
    ).to.be.revertedWithCustomError(vault, 'ZeroAddress')

    // Reverts if recipient is zero address
    await expect(
      vault.recoverERC20(otherToken.target, ethers.ZeroAddress, toEther(1))
    ).to.be.revertedWithCustomError(vault, 'ZeroAddress')

    // Reverts if amount is zero
    await expect(
      vault.recoverERC20(otherToken.target, accounts[5], 0)
    ).to.be.revertedWithCustomError(vault, 'ZeroAmount')

    // Reverts if caller is not owner
    await expect(
      (vault.connect(signers[1]) as any).recoverERC20(otherToken.target, accounts[5], toEther(1))
    ).to.be.revertedWithCustomError(vault, 'OnlyOwner')
  })
})
