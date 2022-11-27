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
import { ERC677, CommunityVCS, StakingMock } from '../../typechain-types'

const encode = (data: any) => ethers.utils.defaultAbiCoder.encode(['uint'], [data])

describe('CommunityVCS', () => {
  let token: ERC677
  let staking: StakingMock
  let strategy: CommunityVCS
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    staking = (await deploy('StakingMock', [token.address])) as StakingMock
    let vaultImplementation = await deployImplementation('CommunityVault')

    strategy = (await deployUpgradeable('CommunityVCS', [
      token.address,
      accounts[0],
      staking.address,
      vaultImplementation,
      toEther(1000),
      [[accounts[4], 500]],
      toEther(10000000),
      5,
    ])) as CommunityVCS

    await token.approve(strategy.address, ethers.constants.MaxUint256)
  })

  it('should be able to get vault deposit limits', async () => {
    assert.deepEqual(
      (await strategy.getVaultDepositLimits()).map((v) => fromEther(v)),
      [10, 7000]
    )
  })

  it('depositBufferedTokens should work correctly', async () => {
    await strategy.deposit(toEther(1000))
    await strategy.performUpkeep(encode(0))
    let vaults = await strategy.getVaults()
    assert.equal(vaults.length, 1)
    assert.equal(fromEther(await staking.getStake(vaults[0])), 1000)

    await strategy.deposit(toEther(7000))
    await strategy.performUpkeep(encode(0))
    vaults = await strategy.getVaults()
    assert.equal(vaults.length, 2)
    assert.equal(fromEther(await staking.getStake(vaults[0])), 7000)
    assert.equal(fromEther(await staking.getStake(vaults[1])), 1000)

    await strategy.deposit(toEther(13009))
    await strategy.performUpkeep(encode(1))
    vaults = await strategy.getVaults()
    assert.equal(vaults.length, 3)
    assert.equal(fromEther(await staking.getStake(vaults[1])), 7000)
    assert.equal(fromEther(await staking.getStake(vaults[2])), 7000)

    assert.equal(fromEther(await strategy.getTotalDeposits()), 21009)
  })

  it('no more than maxVaultDeployments vaults should be deployed at once', async () => {
    await strategy.deposit(toEther(70000))
    await strategy.performUpkeep(encode(0))
    let vaults = await strategy.getVaults()
    assert.equal(vaults.length, 6)
  })

  it('getMinDeposits should work correctly', async () => {
    await strategy.deposit(toEther(1000))
    token.transfer(strategy.address, toEther(100))
    assert.equal(fromEther(await strategy.getMinDeposits()), 1000)

    await strategy.performUpkeep(encode(0))
    assert.equal(fromEther(await strategy.getMinDeposits()), 1000)

    await strategy.deposit(toEther(7000))
    assert.equal(fromEther(await strategy.getMinDeposits()), 8000)

    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await strategy.getMinDeposits()), 8000)
    await strategy.updateDeposits()
    assert.equal(fromEther(await strategy.getMinDeposits()), 8110)
  })

  it('getMaxDeposits should work correctly', async () => {
    assert.equal(fromEther(await strategy.getMaxDeposits()), 10000000)
  })
})
