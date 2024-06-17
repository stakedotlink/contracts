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
import { time } from '@nomicfoundation/hardhat-network-helpers'

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

describe('PPKeeper', () => {
  let token: ERC677
  let ppKeeper: PPKeeper
  let priorityPool: PriorityPoolMock
  let stakingController: StakingMock
  let rewardsController: StakingRewardsMock
  let fundFlowController: FundFlowController
  let opStrategy: VCSMock
  let comStrategy: VCSMock
  let vaults: string[]
  let vaultContracts: CommunityVault[]
  let accounts: string[]

  async function updateVaultGroups(
    curGroupVaultsToUnbond: number[],
    nextGroupVaultsTotalUnbonded: number
  ) {
    return await fundFlowController.performUpkeep(
      ethers.utils.defaultAbiCoder.encode(
        ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
        [[], 0, curGroupVaultsToUnbond, toEther(nextGroupVaultsTotalUnbonded)]
      )
    )
  }

  function encodeVaults(vaults: number[]) {
    return ethers.utils.defaultAbiCoder.encode(['uint64[]'], [vaults])
  }

  function decodeData(data: any) {
    return [
      ethers.utils.defaultAbiCoder.decode(['uint64[]'], data[0])[0].map((v: any) => v.toNumber()),
      ethers.utils.defaultAbiCoder.decode(['uint64[]'], data[1])[0].map((v: any) => v.toNumber()),
    ]
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

    priorityPool = (await deploy('PriorityPoolMock', [0])) as PriorityPoolMock

    let vaultImplementation = await deployImplementation('CommunityVault')

    opStrategy = (await deployUpgradeable('VCSMock', [
      token.address,
      accounts[0],
      stakingController.address,
      vaultImplementation,
      [[accounts[4], 500]],
      toEther(100),
    ])) as VCSMock

    comStrategy = (await deployUpgradeable('VCSMock', [
      token.address,
      accounts[0],
      stakingController.address,
      vaultImplementation,
      [[accounts[4], 500]],
      toEther(100),
    ])) as VCSMock

    vaults = []
    vaultContracts = []
    for (let i = 0; i < 15; i++) {
      let vault = (await deployUpgradeable('CommunityVault', [
        token.address,
        comStrategy.address,
        stakingController.address,
        rewardsController.address,
      ])) as CommunityVault
      vaultContracts.push(vault)
      vaults.push(vault.address)
    }

    for (let i = 0; i < 15; i++) {
      await vaultContracts[i].transferOwnership(comStrategy.address)
    }

    await comStrategy.addVaults(vaults)
    await token.approve(comStrategy.address, ethers.constants.MaxUint256)
    await token.approve(opStrategy.address, ethers.constants.MaxUint256)

    fundFlowController = (await deployUpgradeable('FundFlowController', [
      opStrategy.address,
      comStrategy.address,
      unbondingPeriod,
      claimPeriod,
      5,
    ])) as FundFlowController
    await opStrategy.setFundFlowController(fundFlowController.address)
    await comStrategy.setFundFlowController(fundFlowController.address)

    ppKeeper = (await deploy('PPKeeper', [
      priorityPool.address,
      fundFlowController.address,
    ])) as PPKeeper

    await token.approve(priorityPool.address, ethers.constants.MaxUint256)
  })

  it('checkUpkeep should work correctly', async () => {
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
    assert.deepEqual(decodeData(ethers.utils.defaultAbiCoder.decode(['bytes[]'], data[1])[0]), [
      [],
      [0, 1, 6, 11, 4],
    ])

    await ppKeeper.performUpkeep(data[1])
    assert.deepEqual(
      decodeData(
        ethers.utils.defaultAbiCoder.decode(['bytes[]'], await priorityPool.lastPerformData())[0]
      ),
      [[], [0, 1, 6, 11, 4]]
    )
  })
})
