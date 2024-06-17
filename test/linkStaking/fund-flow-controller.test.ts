import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  deployImplementation,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import {
  ERC677,
  VCSMock,
  StakingMock,
  CommunityVault,
  StakingRewardsMock,
  FundFlowController,
} from '../../typechain-types'
import { time } from '@nomicfoundation/hardhat-network-helpers'

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

describe('FundFlowController', () => {
  let token: ERC677
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
  })

  it('getDepositData should work correctly', async () => {
    await comStrategy.deposit(toEther(1200), encodeVaults([]))
    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(150))), [[], []])

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

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(150))), [
      [],
      [0, 1, 6, 11, 4],
    ])
    await comStrategy.deposit(toEther(150), encodeVaults([0, 1, 6, 11, 4]))

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(200))), [
      [],
      [6, 4, 9, 11, 3, 8, 2],
    ])
    await comStrategy.deposit(toEther(200), encodeVaults([6, 4, 9, 11, 3, 8, 2]))

    await time.increase(claimPeriod)
    await updateVaultGroups([4, 9], 250)
    await comStrategy.withdraw(toEther(100), encodeVaults([0, 5]))

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(50))), [[], [9, 0]])
    await comStrategy.deposit(toEther(50), encodeVaults([9, 0]))

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(500))), [
      [],
      [9, 0, 5, 3, 8, 2, 11],
    ])
    await comStrategy.deposit(toEther(500), encodeVaults([9, 0, 5, 3, 8, 2, 11]))

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(500))), [[], []])
  })

  it('getWithdrawalData should work correctly', async () => {
    await comStrategy.deposit(toEther(1200), encodeVaults([]))
    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(150))), [[], []])

    await updateVaultGroups([0, 5, 10], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([1, 6, 11], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([2, 7], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([3, 8], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([4, 9], 300)

    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(150))), [
      [],
      [0, 5, 10],
    ])
    await comStrategy.withdraw(toEther(150), encodeVaults([0, 5, 10]))
    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(50))), [
      [],
      [5, 10],
    ])
    await comStrategy.deposit(toEther(50), encodeVaults([0]))
    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(50))), [
      [],
      [5, 10],
    ])

    await time.increase(claimPeriod)
    await updateVaultGroups([0, 5, 10], 300)

    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(400))), [
      [],
      [1, 6, 11],
    ])
    await comStrategy.withdraw(toEther(300), encodeVaults([1, 6, 11]))
    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(400))), [[], []])

    await time.increase(claimPeriod)
    await updateVaultGroups([1, 6, 11], 200)
    await time.increase(claimPeriod)
    await updateVaultGroups([2, 7], 200)
    await time.increase(claimPeriod)
    await updateVaultGroups([3, 8], 200)
    await time.increase(claimPeriod)
    await updateVaultGroups([4, 9], 200)

    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(50))), [
      [],
      [5, 0],
    ])
    await comStrategy.deposit(toEther(25), encodeVaults([0]))
    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(50))), [
      [],
      [5, 10],
    ])
  })

  it('checkUpkeep should work correctly', async () => {
    assert.deepEqual(
      await fundFlowController
        .checkUpkeep('0x')
        .then((res) => [
          res[0],
          ethers.utils.defaultAbiCoder
            .decode(['uint256[]', 'uint256', 'uint256[]', 'uint256'], res[1])
            .map((d) => (d.length != undefined ? d.map((v: any) => v.toNumber()) : d.toNumber())),
        ]),
      [true, [[], 0, [], 0]]
    )

    await comStrategy.deposit(toEther(1200), encodeVaults([]))

    assert.deepEqual(
      await fundFlowController
        .checkUpkeep('0x')
        .then((res) => [
          res[0],
          ethers.utils.defaultAbiCoder
            .decode(['uint256[]', 'uint256', 'uint256[]', 'uint256'], res[1])
            .map((d) => (d.length != undefined ? d.map((v: any) => v.toNumber()) : d.toNumber())),
        ]),
      [true, [[], 0, [0, 5, 10], 0]]
    )

    await updateVaultGroups([0, 5, 10], 0)

    assert.deepEqual(await fundFlowController.checkUpkeep('0x'), [false, '0x'])

    await time.increase(claimPeriod + 10)

    assert.deepEqual(
      await fundFlowController
        .checkUpkeep('0x')
        .then((res) => [
          res[0],
          ethers.utils.defaultAbiCoder
            .decode(['uint256[]', 'uint256', 'uint256[]', 'uint256'], res[1])
            .map((d) => (d.length != undefined ? d.map((v: any) => v.toNumber()) : d.toNumber())),
        ]),
      [true, [[], 0, [1, 6, 11], 0]]
    )

    await updateVaultGroups([1, 6, 11], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([2, 7], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([3, 8], 0)
    await time.increase(claimPeriod + 10)

    assert.deepEqual(
      await fundFlowController
        .checkUpkeep('0x')
        .then((res) => [
          res[0],
          ethers.utils.defaultAbiCoder
            .decode(['uint256[]', 'uint256', 'uint256[]', 'uint256'], res[1])
            .map((d) => (d.length != undefined ? d.map((v: any) => v.toNumber()) : fromEther(d))),
        ]),
      [true, [[], 0, [4, 9], 300]]
    )

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
    await time.increase(claimPeriod + 10)

    assert.deepEqual(
      await fundFlowController
        .checkUpkeep('0x')
        .then((res) => [
          res[0],
          ethers.utils.defaultAbiCoder
            .decode(['uint256[]', 'uint256', 'uint256[]', 'uint256'], res[1])
            .map((d) => (d.length != undefined ? d.map((v: any) => v.toNumber()) : fromEther(d))),
        ]),
      [true, [[], 0, [], 250]]
    )

    await comStrategy.deposit(toEther(50), encodeVaults([0, 4]))

    assert.deepEqual(
      await fundFlowController
        .checkUpkeep('0x')
        .then((res) => [
          res[0],
          ethers.utils.defaultAbiCoder
            .decode(['uint256[]', 'uint256', 'uint256[]', 'uint256'], res[1])
            .map((d) => (d.length != undefined ? d.map((v: any) => v.toNumber()) : fromEther(d))),
        ]),
      [true, [[], 0, [4], 250]]
    )

    await updateVaultGroups([4], 250)
    await time.increase(claimPeriod)
    await updateVaultGroups([0, 5, 10], 300)
    await time.increase(claimPeriod)
    await updateVaultGroups([1, 6, 11], 200)
    await time.increase(claimPeriod)
    await updateVaultGroups([2, 7], 200)
    await time.increase(claimPeriod + 10)

    assert.deepEqual(
      await fundFlowController
        .checkUpkeep('0x')
        .then((res) => [
          res[0],
          ethers.utils.defaultAbiCoder
            .decode(['uint256[]', 'uint256', 'uint256[]', 'uint256'], res[1])
            .map((d) => (d.length != undefined ? d.map((v: any) => v.toNumber()) : fromEther(d))),
        ]),
      [true, [[], 0, [8], 50]]
    )

    await comStrategy.deposit(toEther(50), encodeVaults([4]))

    assert.deepEqual(
      await fundFlowController
        .checkUpkeep('0x')
        .then((res) => [
          res[0],
          ethers.utils.defaultAbiCoder
            .decode(['uint256[]', 'uint256', 'uint256[]', 'uint256'], res[1])
            .map((d) => (d.length != undefined ? d.map((v: any) => v.toNumber()) : fromEther(d))),
        ]),
      [true, [[], 0, [8], 0]]
    )
  })

  it('performUpkeep should work correctly', async () => {
    await comStrategy.deposit(toEther(1200), encodeVaults([]))

    await updateVaultGroups([0, 5, 10], 0)
    assert.equal(
      (await fundFlowController.timeOfLastUpdateByGroup(0)).toNumber(),
      (await ethers.provider.getBlock('latest')).timestamp
    )
    assert.equal((await fundFlowController.curUnbondedVaultGroup()).toNumber(), 1)
    assert.equal(fromEther(await comStrategy.canWithdraw()), 0)
    assert.equal((await comStrategy.globalVaultState())[1].toNumber(), 1)

    await expect(
      fundFlowController.performUpkeep(
        ethers.utils.defaultAbiCoder.encode(
          ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
          [[], 0, [1, 6, 11], toEther(0)]
        )
      )
    ).to.be.revertedWith('NoUpdateNeeded()')

    await time.increase(claimPeriod)

    await updateVaultGroups([1, 6, 11], 0)
    assert.equal(
      (await fundFlowController.timeOfLastUpdateByGroup(1)).toNumber(),
      (await ethers.provider.getBlock('latest')).timestamp
    )
    assert.equal((await fundFlowController.curUnbondedVaultGroup()).toNumber(), 2)
    assert.equal(fromEther(await comStrategy.canWithdraw()), 0)
    assert.equal((await comStrategy.globalVaultState())[1].toNumber(), 2)

    await time.increase(claimPeriod)
    await updateVaultGroups([2, 7], 0)
    await time.increase(claimPeriod)
    await updateVaultGroups([3, 8], 0)
    await time.increase(claimPeriod + 10)

    await updateVaultGroups([4, 9], 300)
    assert.equal(
      (await fundFlowController.timeOfLastUpdateByGroup(4)).toNumber(),
      (await ethers.provider.getBlock('latest')).timestamp
    )
    assert.equal((await fundFlowController.curUnbondedVaultGroup()).toNumber(), 0)
    assert.equal(fromEther(await comStrategy.canWithdraw()), 300)
    assert.equal((await comStrategy.globalVaultState())[1].toNumber(), 0)

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
    await time.increase(claimPeriod)

    await comStrategy.deposit(toEther(50), encodeVaults([0, 4]))

    await updateVaultGroups([4], 250)
    assert.equal(
      (await fundFlowController.timeOfLastUpdateByGroup(4)).toNumber(),
      (await ethers.provider.getBlock('latest')).timestamp
    )
    assert.equal((await fundFlowController.curUnbondedVaultGroup()).toNumber(), 0)
    assert.equal(fromEther(await comStrategy.canWithdraw()), 250)
    assert.equal((await comStrategy.globalVaultState())[1].toNumber(), 0)
  })

  it('should work correctly with 2 strategies', async () => {
    let opVaults: any = []
    for (let i = 0; i < 10; i++) {
      let vault = (await deployUpgradeable('CommunityVault', [
        token.address,
        opStrategy.address,
        stakingController.address,
        rewardsController.address,
      ])) as CommunityVault
      await vault.transferOwnership(opStrategy.address)
      opVaults.push(vault.address)
    }
    await opStrategy.addVaults(opVaults)

    await comStrategy.deposit(toEther(1200), encodeVaults([]))
    await opStrategy.deposit(toEther(600), encodeVaults([]))

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(150))), [[], []])

    await fundFlowController.performUpkeep(
      ethers.utils.defaultAbiCoder.encode(
        ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
        [[0, 5], toEther(0), [0, 5, 10], toEther(0)]
      )
    )
    await time.increase(claimPeriod)
    await fundFlowController.performUpkeep(
      ethers.utils.defaultAbiCoder.encode(
        ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
        [[1], toEther(0), [1, 6, 11], toEther(0)]
      )
    )
    await time.increase(claimPeriod)
    await fundFlowController.performUpkeep(
      ethers.utils.defaultAbiCoder.encode(
        ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
        [[2], toEther(0), [2, 7], toEther(0)]
      )
    )
    await time.increase(claimPeriod)
    await fundFlowController.performUpkeep(
      ethers.utils.defaultAbiCoder.encode(
        ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
        [[3], toEther(0), [3, 8], toEther(0)]
      )
    )
    await time.increase(claimPeriod)
    await fundFlowController.performUpkeep(
      ethers.utils.defaultAbiCoder.encode(
        ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
        [[4], toEther(200), [4, 9], toEther(300)]
      )
    )
    await comStrategy.withdraw(toEther(50), encodeVaults([0, 5]))
    await opStrategy.withdraw(toEther(100), encodeVaults([0, 5]))
    await time.increase(claimPeriod)
    await fundFlowController.performUpkeep(
      ethers.utils.defaultAbiCoder.encode(
        ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
        [[0, 5], toEther(100), [0, 5, 10], toEther(300)]
      )
    )
    await comStrategy.withdraw(toEther(270), encodeVaults([1, 6, 11]))
    await time.increase(claimPeriod)
    await fundFlowController.performUpkeep(
      ethers.utils.defaultAbiCoder.encode(
        ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
        [[1], toEther(100), [1, 6, 11], toEther(200)]
      )
    )
    await opStrategy.withdraw(toEther(50), encodeVaults([2]))

    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(1000))), [
      [2],
      [2, 7],
    ])

    await time.increase(claimPeriod + 10)
    assert.deepEqual(
      await fundFlowController
        .checkUpkeep('0x')
        .then((res) => [
          res[0],
          ethers.utils.defaultAbiCoder
            .decode(['uint256[]', 'uint256', 'uint256[]', 'uint256'], res[1])
            .map((d) => (d.length != undefined ? d.map((v: any) => v.toNumber()) : fromEther(d))),
        ]),
      [true, [[2], 100, [2, 7], 200]]
    )

    await fundFlowController.performUpkeep(
      ethers.utils.defaultAbiCoder.encode(
        ['uint256[]', 'uint256', 'uint256[]', 'uint256'],
        [[2], toEther(100), [2, 7], toEther(200)]
      )
    )
    assert.equal(
      (await fundFlowController.timeOfLastUpdateByGroup(2)).toNumber(),
      (await ethers.provider.getBlock('latest')).timestamp
    )
    assert.equal((await fundFlowController.curUnbondedVaultGroup()).toNumber(), 3)
    assert.equal(fromEther(await comStrategy.canWithdraw()), 200)
    assert.equal((await comStrategy.globalVaultState())[1].toNumber(), 3)
    assert.equal(fromEther(await opStrategy.canWithdraw()), 100)
    assert.equal((await opStrategy.globalVaultState())[1].toNumber(), 3)
  })
})
