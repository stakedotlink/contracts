import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { Signer } from 'ethers'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import {
  ERC677,
  OperatorVCSMock,
  OperatorVault,
  OperatorVaultV0,
  StakingMock,
} from '../../typechain-types'
import { Interface } from 'ethers/lib/utils'

describe('OperatorVault', () => {
  let token: ERC677
  let staking: StakingMock
  let strategy: OperatorVCSMock
  let vault: OperatorVault
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677

    staking = (await deploy('StakingMock', [token.address])) as StakingMock
    strategy = (await deploy('OperatorVCSMock', [token.address, 1000, 5000])) as OperatorVCSMock

    vault = (await deployUpgradeable('OperatorVault', [
      token.address,
      strategy.address,
      staking.address,
      accounts[1],
      accounts[2],
    ])) as OperatorVault

    await strategy.addVault(vault.address)
    await token.transfer(strategy.address, toEther(10000))
    await strategy.deposit(toEther(100))
    await token.transfer(staking.address, toEther(1000))
  })

  it('deposit should work correctly', async () => {
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(staking.address)), 1200)
    assert.equal(fromEther(await staking.getStake(vault.address)), 200)
    assert.equal(fromEther(await vault.getRewards()), 0)
  })

  it('raiseAlert should work correctly', async () => {
    await vault.connect(signers[1]).raiseAlert()
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 10000)
    assert.equal(fromEther(await vault.getRewards()), 10)
    await expect(vault.raiseAlert()).to.be.revertedWith('OnlyOperator()')
  })

  it('getTotalDeposits should work correctly', async () => {
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)
    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await vault.getTotalDeposits()), 110)
    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await vault.getTotalDeposits()), 115)
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getTotalDeposits()), 215)
  })

  it('getRewards and withdrawRewards should work correctly', async () => {
    assert.equal(fromEther(await vault.getRewards()), 0)
    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await vault.getRewards()), 1)
    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await vault.getRewards()), 1.5)
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getRewards()), 1.5)
    await staking.setDelegationReward(toEther(0))
    assert.equal(fromEther(await vault.getRewards()), 1)

    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 0.5)
    assert.equal(fromEther(await vault.getRewards()), 0.5)
    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await vault.getRewards()), 1)
    await staking.setDelegationReward(toEther(0))
    assert.equal(fromEther(await vault.getRewards()), 0.5)

    await staking.setBaseReward(toEther(20))
    await strategy.setWithdrawalPercentage(10000)
    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 2)
    assert.equal(fromEther(await vault.getRewards()), 0)

    await expect(vault.withdrawRewards()).to.be.revertedWith('OnlyRewardsReceiver()')
  })

  it('updateRewards should work correctly', async () => {
    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await vault.getRewards()), 1)
    await staking.setBaseReward(toEther(0))
    assert.equal(fromEther(await vault.getRewards()), 0)

    await staking.setBaseReward(toEther(10))
    await vault.updateRewards()
    await staking.setBaseReward(toEther(0))
    assert.equal(fromEther(await vault.getRewards()), 1)

    await staking.setDelegationReward(toEther(20))
    assert.equal(fromEther(await vault.getRewards()), 2)
    await vault.updateRewards()
    assert.equal(fromEther(await vault.getRewards()), 2)
  })

  it('setRewardsReceiver should work correctly', async () => {
    let newVault = (await deployUpgradeable('OperatorVault', [
      token.address,
      strategy.address,
      staking.address,
      accounts[1],
      ethers.constants.AddressZero,
    ])) as OperatorVault

    await expect(newVault.connect(signers[1]).setRewardsReceiver(accounts[1])).to.be.revertedWith(
      'OnlyRewardsReceiver()'
    )
    await newVault.setRewardsReceiver(accounts[1])

    await expect(newVault.setRewardsReceiver(accounts[0])).to.be.revertedWith(
      'OnlyRewardsReceiver()'
    )
    await newVault.connect(signers[1]).setRewardsReceiver(accounts[0])
    assert.equal(await newVault.rewardsReceiver(), accounts[0])
  })

  it('should be able to upgrade from V0 of vault', async () => {
    let vault = (await deployUpgradeable('OperatorVaultV0', [
      token.address,
      accounts[1],
      accounts[2],
    ])) as OperatorVaultV0

    assert.equal(await vault.token(), token.address)
    assert.equal(await vault.vaultController(), accounts[1])
    assert.equal(await vault.stakeController(), accounts[2])

    let vaultImp = (await deployImplementation('OperatorVault')) as string
    const vaultInterface = (await ethers.getContractFactory('OperatorVault')).interface as Interface

    await vault.upgradeToAndCall(
      vaultImp,
      vaultInterface.encodeFunctionData('initialize(address,address,address,address,address)', [
        token.address,
        accounts[3],
        accounts[4],
        accounts[0],
        accounts[1],
      ])
    )
    let vaultUpgraded = (await ethers.getContractAt(
      'OperatorVault',
      vault.address
    )) as OperatorVault

    assert.equal(await vaultUpgraded.token(), token.address)
    assert.equal(await vaultUpgraded.vaultController(), accounts[3])
    assert.equal(await vaultUpgraded.stakeController(), accounts[4])
    assert.equal(await vaultUpgraded.operator(), accounts[0])
  })
})
