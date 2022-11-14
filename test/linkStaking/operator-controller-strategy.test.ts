import { ethers } from 'hardhat'
import { assert } from 'chai'
import { Signer } from 'ethers'
import {
  deploy,
  deployUpgradeable,
  fromEther,
  getAccounts,
  setupToken,
  toEther,
} from '../utils/helpers'
import {
  ERC677,
  OperatorControllerStrategy,
  OperatorVault,
  StakingMock,
} from '../../typechain-types'

describe('OperatorControllerStrategy', () => {
  let token: ERC677
  let staking: StakingMock
  let strategy: OperatorControllerStrategy
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    staking = (await deploy('StakingMock', [token.address])) as StakingMock

    strategy = (await deployUpgradeable('OperatorControllerStrategy', [
      token.address,
      accounts[0],
      staking.address,
    ])) as OperatorControllerStrategy

    await token.approve(strategy.address, ethers.constants.MaxUint256)
    await token.connect(signers[1]).approve(strategy.address, ethers.constants.MaxUint256)

    for (let i = 0; i < 3; i++) {
      let opVault = (await deployUpgradeable('OperatorVault', [
        token.address,
        strategy.address,
        staking.address,
      ])) as OperatorVault
      await strategy.addOperatorVault(opVault.address)
    }
  })

  it('should be able to calculate max deposits', async () => {
    assert.equal(fromEther(await strategy.maxDeposits()), 150000, 'max deposits incorrect')
  })

  it('should be able to deposit across all deployed strategies', async () => {
    await strategy.deposit(toEther(150000))
    let opVaults = await strategy.getOperatorVaults()
    assert.equal(fromEther(await staking.getStake(opVaults[0])), 50000, 'deposits incorrect')
    assert.equal(fromEther(await staking.getStake(opVaults[1])), 50000, 'deposits incorrect')
    assert.equal(fromEther(await staking.getStake(opVaults[2])), 50000, 'deposits incorrect')
  })

  it('should be able to deposit partial amounts', async () => {
    await strategy.deposit(toEther(75000))
    let opVaults = await strategy.getOperatorVaults()
    assert.equal(fromEther(await staking.getStake(opVaults[1])), 25000, 'deposits incorrect')
    assert.equal(fromEther(await staking.getStake(opVaults[2])), 50000, 'deposits incorrect')
  })

  it('should be able to calculate min deposit', async () => {
    assert.equal(fromEther(await strategy.minDeposits()), 30, 'min deposit incorrect')
    await strategy.deposit(toEther(75000))
    assert.equal(fromEther(await strategy.minDeposits()), 75030, 'min deposit incorrect')
  })

  it('should be able to calculate deposit change', async () => {
    await strategy.deposit(toEther(150000))
    await staking.setBaseReward(toEther(10))
    await staking.setDelegationReward(toEther(10))
    assert.equal(fromEther(await strategy.depositChange()), 60, 'deposit change incorrect')
  })

  it('should be able to update deposits', async () => {
    await strategy.deposit(toEther(150000))
    await staking.setBaseReward(toEther(10))
    await staking.setDelegationReward(toEther(10))
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.totalDeposits()), 150060, 'total deposits incorrect')
  })

  it('should be able to calculate deposit change on slash', async () => {
    await strategy.deposit(toEther(150000))
    await staking.setBaseReward(toEther(10))
    await staking.setDelegationReward(toEther(10))
    await strategy.updateDeposits()

    await staking.setBaseReward(toEther(5))
    await staking.setDelegationReward(toEther(5))
    await strategy.depositChange()
    assert.equal(fromEther(await strategy.depositChange()), -30, 'deposit change incorrect')

    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.totalDeposits()), 150030, 'total deposits incorrect')
  })
})
