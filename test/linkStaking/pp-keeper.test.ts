import { ethers } from 'hardhat'
import { assert } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  deployImplementation,
  getAccounts,
  setupToken,
} from '../utils/helpers'
import {
  ERC677,
  VCSMock,
  StakingMock,
  CommunityVault,
  StakingRewardsMock,
  FundFlowController,
  PPKeeper,
  PriorityPoolMock,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

function encodeVaults(vaults: number[]) {
  return ethers.AbiCoder.defaultAbiCoder().encode(['uint64[]'], [vaults])
}

function decodeData(data: any) {
  return [
    ethers.AbiCoder.defaultAbiCoder()
      .decode(['uint64[]'], data[0])[0]
      .map((v: any) => Number(v)),
    ethers.AbiCoder.defaultAbiCoder()
      .decode(['uint64[]'], data[1])[0]
      .map((v: any) => Number(v)),
  ]
}

describe('PPKeeper', () => {
  async function deployFixture() {
    const { accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    const rewardsController = (await deploy('StakingRewardsMock', [
      token.target,
    ])) as StakingRewardsMock

    const stakingController = (await deploy('StakingMock', [
      token.target,
      rewardsController.target,
      toEther(10),
      toEther(100),
      toEther(10000),
      unbondingPeriod,
      claimPeriod,
    ])) as StakingMock

    const priorityPool = (await deploy('PriorityPoolMock', [0])) as PriorityPoolMock

    let vaultImplementation = await deployImplementation('CommunityVault')

    const opStrategy = (await deployUpgradeable('VCSMock', [
      token.target,
      accounts[0],
      stakingController.target,
      vaultImplementation,
      [[accounts[4], 500]],
      toEther(100),
    ])) as VCSMock

    const comStrategy = (await deployUpgradeable('VCSMock', [
      token.target,
      accounts[0],
      stakingController.target,
      vaultImplementation,
      [[accounts[4], 500]],
      toEther(100),
    ])) as VCSMock

    const vaults = []
    const vaultContracts = []
    for (let i = 0; i < 15; i++) {
      let vault = (await deployUpgradeable('CommunityVault', [
        token.target,
        comStrategy.target,
        stakingController.target,
        rewardsController.target,
      ])) as CommunityVault
      vaultContracts.push(vault)
      vaults.push(vault.target)
    }

    for (let i = 0; i < 15; i++) {
      await vaultContracts[i].transferOwnership(comStrategy.target)
    }

    await comStrategy.addVaults(vaults)
    await token.approve(comStrategy.target, ethers.MaxUint256)
    await token.approve(opStrategy.target, ethers.MaxUint256)

    const fundFlowController = (await deployUpgradeable('FundFlowController', [
      opStrategy.target,
      comStrategy.target,
      unbondingPeriod,
      claimPeriod,
      5,
    ])) as FundFlowController

    await opStrategy.setFundFlowController(fundFlowController.target)
    await comStrategy.setFundFlowController(fundFlowController.target)

    const ppKeeper = (await deploy('PPKeeper', [
      priorityPool.target,
      fundFlowController.target,
    ])) as PPKeeper

    await token.approve(priorityPool.target, ethers.MaxUint256)

    async function updateVaultGroups(
      curGroupVaultsToUnbond: number[],
      nextGroupVaultsTotalUnbonded: number
    ) {
      return await fundFlowController.performUpkeep(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
          [[], 0, curGroupVaultsToUnbond, toEther(nextGroupVaultsTotalUnbonded)]
        )
      )
    }

    return {
      accounts,
      token,
      rewardsController,
      stakingController,
      priorityPool,
      opStrategy,
      comStrategy,
      vaultContracts,
      vaults,
      fundFlowController,
      ppKeeper,
      updateVaultGroups,
    }
  }

  it('checkUpkeep should work correctly', async () => {
    const { comStrategy, ppKeeper, priorityPool, updateVaultGroups } = await loadFixture(
      deployFixture
    )

    await comStrategy.deposit(toEther(1200), encodeVaults([]))
    assert.equal((await ppKeeper.checkUpkeep('0x'))[0], false)

    await updateVaultGroups([0, 5, 10], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([1, 6, 11], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([2, 7], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([3, 8], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([4, 9], 300)
    await comStrategy.withdraw(toEther(50), encodeVaults([0, 5]))
    await time.increase(claimPeriod)
    await updateVaultGroups([0, 5, 10], 300)
    await comStrategy.withdraw(toEther(270), encodeVaults([1, 6, 11]))
    await time.increase(claimPeriod)
    await updateVaultGroups([1, 6, 11], 200)
    await comStrategy.withdraw(toEther(100), encodeVaults([2, 7]))
    await time.increase(claimPeriod)
    await updateVaultGroups([2, 7], 200)
    await comStrategy.withdraw(toEther(120), encodeVaults([3, 8]))
    await time.increase(claimPeriod)
    await updateVaultGroups([3, 8], 200)
    await comStrategy.withdraw(toEther(200), encodeVaults([4, 9]))
    await priorityPool.setUpkeepNeeded(true)

    let data: any = await ppKeeper.checkUpkeep('0x')
    assert.equal(data[0], true)
    assert.deepEqual(
      decodeData(ethers.AbiCoder.defaultAbiCoder().decode(['bytes[]'], data[1])[0]),
      [[], [0, 1, 6, 11, 4]]
    )

    await ppKeeper.performUpkeep(data[1])
    assert.deepEqual(
      decodeData(
        ethers.AbiCoder.defaultAbiCoder().decode(
          ['bytes[]'],
          await priorityPool.lastPerformData()
        )[0]
      ),
      [[], [0, 1, 6, 11, 4]]
    )
  })
})
