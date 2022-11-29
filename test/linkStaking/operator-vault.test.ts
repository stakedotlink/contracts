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
  deployImplementation,
} from '../utils/helpers'
import { ERC677, OperatorVault, OperatorVaultV0, StakingMock } from '../../typechain-types'
import { Interface } from 'ethers/lib/utils'

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

  it.only('should be able to upgrade from V0 of vault', async () => {
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
      vaultInterface.encodeFunctionData('initialize(address,address,address,address)', [
        token.address,
        accounts[3],
        accounts[4],
        accounts[0],
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
