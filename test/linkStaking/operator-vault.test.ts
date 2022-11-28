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
      accounts[1],
      staking.address,
      accounts[2],
    ])) as OperatorVault

    await token.connect(signers[1]).approve(vault.address, ethers.constants.MaxUint256)
    await vault.connect(signers[1]).deposit(toEther(10000))
    await token.transfer(staking.address, toEther(1000))
  })

  it('raiseAlert should work correctly', async () => {
    await vault.connect(signers[2]).raiseAlert()
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 100)
    await expect(vault.raiseAlert()).to.be.revertedWith('Operator only')
  })

  it('getTotalDeposits should work correctly', async () => {
    assert.equal(fromEther(await vault.getTotalDeposits()), 10000)
    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await vault.getTotalDeposits()), 10010)
    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await vault.getTotalDeposits()), 10015)
  })

  it('setOperator should work correctly', async () => {
    await expect(vault.setOperator(accounts[1])).to.be.revertedWith('Operator is already set')

    let newVault = (await deployUpgradeable('OperatorVault', [
      token.address,
      padBytes('0x0', 20),
      staking.address,
      ethers.constants.AddressZero,
    ])) as OperatorVault
    await newVault.setOperator(accounts[1])
    assert.equal(await newVault.operator(), accounts[1], 'operator address does not match')
  })
})
