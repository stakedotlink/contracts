import { ethers } from 'hardhat'
import { assert } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import { ERC677, OperatorVCS, StakingMock } from '../../typechain-types'

const encode = (data: any) => ethers.utils.defaultAbiCoder.encode(['uint'], [data])

describe('OperatorVCS', () => {
  let token: ERC677
  let staking: StakingMock
  let strategy: OperatorVCS
  let vaults: string[]
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    staking = (await deploy('StakingMock', [token.address])) as StakingMock
    let vaultImplementation = await deployImplementation('OperatorVault')

    strategy = (await deployUpgradeable('OperatorVCS', [
      token.address,
      accounts[0],
      staking.address,
      vaultImplementation,
      toEther(1000),
      [[accounts[4], 500]],
      [],
    ])) as OperatorVCS

    for (let i = 0; i < 10; i++) {
      await strategy.addVault(accounts[0])
    }

    vaults = await strategy.getVaults()

    await token.approve(strategy.address, ethers.constants.MaxUint256)
  })

  it('should be able to add vault', async () => {
    await strategy.addVault(accounts[1])
    let vault = await ethers.getContractAt('OperatorVault', (await strategy.getVaults())[10])
    assert.equal(await vault.token(), token.address)
    assert.equal(await vault.stakeController(), staking.address)
    assert.equal(await vault.vaultController(), strategy.address)
    assert.equal(await vault.operator(), accounts[1])
  })

  it('should be able to get vault deposit limits', async () => {
    assert.deepEqual(
      (await strategy.getVaultDepositLimits()).map((v) => fromEther(v)),
      [10, 50000]
    )
  })

  it('depositBufferedTokens should work correctly', async () => {
    await strategy.deposit(toEther(1000))
    await strategy.performUpkeep(encode(0))
    assert.equal(fromEther(await staking.getStake(vaults[0])), 1000)

    await strategy.deposit(toEther(50000))
    await strategy.performUpkeep(encode(0))
    assert.equal(fromEther(await staking.getStake(vaults[0])), 50000)
    assert.equal(fromEther(await staking.getStake(vaults[1])), 1000)

    await strategy.deposit(toEther(99009))
    await strategy.performUpkeep(encode(1))
    assert.equal(fromEther(await staking.getStake(vaults[1])), 50000)
    assert.equal(fromEther(await staking.getStake(vaults[2])), 50000)
    assert.equal(fromEther(await staking.getStake(vaults[3])), 0)

    assert.equal(fromEther(await strategy.getTotalDeposits()), 150009)
  })

  it('getMinDeposits should work correctly', async () => {
    await strategy.deposit(toEther(1000))
    token.transfer(strategy.address, toEther(100))
    assert.equal(fromEther(await strategy.getMinDeposits()), 1000)

    await strategy.performUpkeep(encode(0))
    assert.equal(fromEther(await strategy.getMinDeposits()), 1000)

    await strategy.deposit(toEther(50000))
    assert.equal(fromEther(await strategy.getMinDeposits()), 51000)

    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await strategy.getMinDeposits()), 51000)
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getMinDeposits()), 51200)

    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await strategy.getMinDeposits()), 51200)
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getMinDeposits()), 51250)
  })

  it('getMaxDeposits should work correctly', async () => {
    await strategy.deposit(toEther(1000))
    token.transfer(strategy.address, toEther(100))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500000)

    await strategy.performUpkeep(encode(0))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500000)

    await strategy.deposit(toEther(50000))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500000)

    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500000)
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500200)

    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500200)
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getMaxDeposits()), 500250)
  })
})
