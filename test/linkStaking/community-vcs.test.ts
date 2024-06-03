import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import { ERC677, CommunityVCS, StakingMock, StakingRewardsMock } from '../../typechain-types'

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

describe('CommunityVCS', () => {
  let token: ERC677
  let stakingController: StakingMock
  let rewardsController: StakingRewardsMock
  let strategy: CommunityVCS
  let accounts: string[]

  function encodeVaults(vaults: number[]) {
    return ethers.utils.defaultAbiCoder.encode(['uint64[]'], [vaults])
  }

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    rewardsController = (await deploy('StakingRewardsMock', [token.address])) as StakingRewardsMock
    stakingController = (await deploy('StakingMock', [
      token.address,
      rewardsController.address,
      toEther(10),
      toEther(100),
      toEther(10000),
      unbondingPeriod,
      claimPeriod,
    ])) as StakingMock

    let vaultImplementation = await deployImplementation('CommunityVault')

    strategy = (await deployUpgradeable('CommunityVCS', [
      token.address,
      accounts[0],
      stakingController.address,
      vaultImplementation,
      [[accounts[4], 500]],
      9000,
      toEther(10000),
      10,
      20,
    ])) as CommunityVCS

    await token.approve(strategy.address, ethers.constants.MaxUint256)
    await token.transfer(rewardsController.address, toEther(10000))
  })

  it('addVaults should work correctly', async () => {
    await strategy.addVaults(10)
    let vaults = await strategy.getVaults()
    assert.equal(vaults.length, 30)
    for (let i = 0; i < vaults.length; i += 5) {
      let vault = await ethers.getContractAt('CommunityVault', vaults[i])
      assert.equal(await vault.token(), token.address)
      assert.equal(await vault.vaultController(), strategy.address)
      assert.equal(await vault.stakeController(), stakingController.address)
      assert.equal(await vault.rewardsController(), rewardsController.address)
    }
  })

  it('checkUpkeep should work correctly', async () => {
    await strategy.deposit(toEther(1000), encodeVaults([]))
    assert.equal((await strategy.checkUpkeep('0x'))[0], false)

    await strategy.deposit(toEther(90), encodeVaults([]))
    assert.equal((await strategy.checkUpkeep('0x'))[0], false)

    await strategy.deposit(toEther(10), encodeVaults([]))
    assert.equal((await strategy.checkUpkeep('0x'))[0], true)
  })

  it('performUpkeep should work correctly', async () => {
    await strategy.deposit(toEther(1000), encodeVaults([]))
    expect(strategy.performUpkeep('0x')).to.be.revertedWith('VaultsAboveThreshold()')

    await strategy.deposit(toEther(90), encodeVaults([]))
    expect(strategy.performUpkeep('0x')).to.be.revertedWith('VaultsAboveThreshold()')

    await strategy.deposit(toEther(10), encodeVaults([]))
    await strategy.performUpkeep('0x')
    assert.equal((await strategy.getVaults()).length, 40)
    assert.equal((await strategy.checkUpkeep('0x'))[0], false)
  })

  it('claimRewards should work correctly', async () => {
    let vaults = await strategy.getVaults()
    await strategy.deposit(toEther(1000), encodeVaults([]))
    await rewardsController.setReward(vaults[1], toEther(5))
    await rewardsController.setReward(vaults[3], toEther(7))
    await rewardsController.setReward(vaults[5], toEther(8))

    await strategy.claimRewards([1, 3, 5], toEther(10))
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 0)

    await rewardsController.setReward(vaults[6], toEther(10))
    await rewardsController.setReward(vaults[7], toEther(7))
    await rewardsController.setReward(vaults[8], toEther(15))

    await strategy.claimRewards([6, 7, 8], toEther(10))
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 25)

    await rewardsController.setReward(vaults[9], toEther(15))
    await rewardsController.setReward(vaults[10], toEther(15))
    await rewardsController.setReward(vaults[11], toEther(15))

    await strategy.claimRewards([9, 10, 11], toEther(10))
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 70)

    await expect(strategy.claimRewards([100], 0)).to.be.reverted
  })
})
