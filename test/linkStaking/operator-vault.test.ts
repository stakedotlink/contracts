import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { Signer } from 'ethers'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  padBytes,
} from '../utils/helpers'
import { ERC677, OperatorVault, StakingMock } from '../../typechain-types'

describe('OperatorVault', () => {
  let token: ERC677
  let staking: StakingMock
  let vault: OperatorVault
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    staking = (await deploy('StakingMock', [token.address])) as StakingMock

    vault = (await deployUpgradeable('OperatorVault', [
      token.address,
      accounts[0],
      staking.address,
    ])) as OperatorVault

    await token.approve(vault.address, ethers.constants.MaxUint256)
    await token.connect(signers[1]).approve(vault.address, ethers.constants.MaxUint256)

    await vault.deposit(toEther(100))
  })

  it('should be able to deposit', async () => {
    assert.equal(fromEther(await token.balanceOf(staking.address)), 100, 'balance does not match')
    assert.equal(fromEther(await vault.totalDeposits()), 100, 'balance does not match')

    await vault.deposit(toEther(1000))
    assert.equal(fromEther(await token.balanceOf(staking.address)), 1100, 'balance does not match')
    assert.equal(fromEther(await vault.totalDeposits()), 1100, 'balance does not match')
  })

  it('total balance should reflect rewards', async () => {
    await staking.setBaseReward(toEther(100))
    await staking.setDelegationReward(toEther(200))

    assert.equal(fromEther(await vault.totalBalance()), 400, 'deposit change does not match')
  })

  it('withdrawing should revert', async () => {
    await expect(vault.withdraw(toEther(10))).to.be.revertedWith('withdrawals not yet implemented')
  })

  it('should be able to migrate and then deposit', async () => {
    let staking2 = (await deploy('StakingMock', [token.address])) as StakingMock

    await staking.setMigration(staking2.address)
    await vault.migrate('0x00')

    await vault.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(staking2.address)), 200, 'balance does not match')
    assert.equal(fromEther(await vault.totalDeposits()), 100, 'balance does not match') // balance decrease due to mock not transferring staked balances
  })

  it('should be able to change vault controller address if deployed empty', async () => {
    let newVault = (await deployUpgradeable('OperatorVault', [
      token.address,
      padBytes('0x0', 20),
      staking.address,
    ])) as OperatorVault
    await newVault.setVaultController(accounts[0])
    assert.equal(
      await vault.vaultController(),
      accounts[0],
      'vault controller address does not match'
    )
  })

  it('should not be able to change vault controller address if already set', async () => {
    await expect(vault.setVaultController(accounts[1])).to.be.revertedWith(
      'Vault controller cannot be empty/controller is already set'
    )
  })
})
