import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import { ERC677, OperatorVault, StakingMock } from '../../typechain-types'

describe('Vault', () => {
  let token: ERC677
  let staking: StakingMock
  let vault: OperatorVault
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    staking = (await deploy('StakingMock', [token.address])) as StakingMock

    vault = (await deployUpgradeable('OperatorVault', [
      token.address,
      accounts[0],
      staking.address,
      accounts[0],
    ])) as OperatorVault

    await token.approve(vault.address, ethers.constants.MaxUint256)
    await vault.deposit(toEther(100))
  })

  it('should be able to deposit', async () => {
    await vault.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(staking.address)), 200, 'balance does not match')
    assert.equal(fromEther(await staking.getStake(vault.address)), 200, 'balance does not match')
  })

  it('should not be able to withdraw', async () => {
    await expect(vault.withdraw(toEther(10))).to.be.revertedWith('withdrawals not yet implemented')
  })

  it('getPrincipalBalance should work correctly', async () => {
    await staking.setBaseReward(toEther(100))
    await staking.setDelegationReward(toEther(200))
    await vault.deposit(toEther(50))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 150, 'deposits incorrect')
  })

  it('should be able to migrate and then deposit', async () => {
    let staking2 = (await deploy('StakingMock', [token.address])) as StakingMock

    await staking.setMigration(staking2.address)
    await vault.migrate('0x00')

    await vault.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(staking2.address)), 200, 'balance does not match')
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100, 'balance does not match')
  })
})
