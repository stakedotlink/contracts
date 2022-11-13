import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { Signer } from 'ethers'
import {
  attach,
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
  OperatorStrategy,
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

    await strategy.deployOperatorStrategy()
    await strategy.deployOperatorStrategy()
    await strategy.deployOperatorStrategy()
  })

  it('should have correct parameters in deployed strategy', async () => {
    let deployedStrategy = (await attach(
      'OperatorStrategy',
      await strategy.getOperatorStrategy(0)
    )) as OperatorStrategy

    assert.equal(await deployedStrategy.owner(), accounts[0], 'contract owner does not match')
    assert.equal(await deployedStrategy.token(), token.address, 'token does not match')
    assert.equal(
      await deployedStrategy.stakingPool(),
      strategy.address,
      'staking pool does not match'
    )
    assert.equal(
      await deployedStrategy.stakeController(),
      staking.address,
      'staking controller does not match'
    )
  })

  it('should not be able to initialize deployed operator strategy twice', async () => {
    let deployedStrategy = (await attach(
      'OperatorStrategy',
      await strategy.getOperatorStrategy(0)
    )) as OperatorStrategy

    await expect(
      deployedStrategy.initialize(token.address, accounts[0], strategy.address)
    ).to.be.revertedWith('Initializable: contract is already initialized')
  })

  it('should be able to calculate max deposits', async () => {
    assert.equal(fromEther(await strategy.maxDeposits()), 150000, 'max deposits incorrect')
  })

  it('should be able to deposit across all deployed strategies', async () => {
    await strategy.deposit(toEther(150000))
    assert.equal(
      fromEther(await staking.getStake(await strategy.getOperatorStrategy(0))),
      50000,
      'deposits incorrect'
    )
    assert.equal(
      fromEther(await staking.getStake(await strategy.getOperatorStrategy(1))),
      50000,
      'deposits incorrect'
    )
    assert.equal(
      fromEther(await staking.getStake(await strategy.getOperatorStrategy(2))),
      50000,
      'deposits incorrect'
    )
  })

  it('should be able to deposit partial amounts', async () => {
    await strategy.deposit(toEther(75000))
    assert.equal(
      fromEther(await staking.getStake(await strategy.getOperatorStrategy(1))),
      25000,
      'deposits incorrect'
    )
    assert.equal(
      fromEther(await staking.getStake(await strategy.getOperatorStrategy(2))),
      50000,
      'deposits incorrect'
    )
  })

  it('should be able to calculate min deposit', async () => {
    assert.equal(fromEther(await strategy.minDeposits()), 30, 'min deposit incorrect')
    await strategy.deposit(toEther(75000))
    assert.equal(fromEther(await strategy.minDeposits()), 75010, 'min deposit incorrect')
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
