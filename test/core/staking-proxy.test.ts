import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  fromEther,
  deployUpgradeable,
  getAccounts,
  setupToken,
} from '../utils/helpers'
import {
  ERC677,
  SDLPoolMock,
  StakingPool,
  PriorityPool,
  StrategyMock,
  WithdrawalPool,
  StakingAllowance,
  RewardsPoolWSD,
  StakingProxy,
} from '../../typechain-types'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SDLPoolPrimary } from '../../typechain-types'

describe('StakingProxy', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

    const sdlToken = (await deploy('StakingAllowance', ['stake.link', 'SDL'])) as StakingAllowance
    await sdlToken.mint(accounts[0], toEther(10000000))

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts, true)

    const stakingPool = (await deployUpgradeable('StakingPool', [
      token.target,
      'Staked LINK',
      'stLINK',
      [],
      toEther(10000),
    ])) as StakingPool

    const wsdToken = await deploy('WrappedSDToken', [
      stakingPool.target,
      'Wrapped stLINK',
      'wstLINK',
    ])

    const strategy = (await deployUpgradeable('StrategyMock', [
      token.target,
      stakingPool.target,
      toEther(1000),
      toEther(100),
    ])) as StrategyMock

    const boostController = await deploy('LinearBoostController', [10, 4 * 365 * 86400, 4])

    const sdlPool = await deployUpgradeable('SDLPoolPrimary', [
      'Reward Escrowed SDL',
      'reSDL',
      sdlToken.target,
      boostController.target,
    ])

    const rewardsPool = (await deploy('RewardsPoolWSD', [
      sdlPool.target,
      stakingPool.target,
      wsdToken.target,
    ])) as RewardsPoolWSD

    const priorityPool = (await deployUpgradeable('PriorityPool', [
      token.target,
      stakingPool.target,
      sdlPool.target,
      toEther(100),
      toEther(1000),
      false,
    ])) as PriorityPool

    const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
      token.target,
      stakingPool.target,
      priorityPool.target,
      toEther(10),
      0,
    ])) as WithdrawalPool

    const stakingProxy = (await deployUpgradeable('StakingProxy', [
      token.target,
      stakingPool.target,
      priorityPool.target,
      withdrawalPool.target,
      sdlPool.target,
      accounts[0],
    ])) as StakingProxy

    await stakingPool.addStrategy(strategy.target)
    await stakingPool.setPriorityPool(priorityPool.target)
    await stakingPool.setRebaseController(accounts[0])
    await priorityPool.setDistributionOracle(accounts[0])
    await priorityPool.setWithdrawalPool(withdrawalPool.target)
    await sdlPool.addToken(stakingPool.target, rewardsPool.target)

    await token.connect(signers[1]).approve(priorityPool.target, ethers.MaxUint256)
    await token.approve(priorityPool.target, ethers.MaxUint256)
    await token.approve(stakingProxy.target, ethers.MaxUint256)
    await priorityPool.deposit(1000, false, ['0x'])

    return {
      signers,
      accounts,
      token,
      stakingPool,
      strategy,
      sdlPool,
      priorityPool,
      withdrawalPool,
      stakingProxy,
      sdlToken,
    }
  }

  it('deposit should work correctly', async () => {
    const { stakingProxy, stakingPool, priorityPool, signers } = await loadFixture(deployFixture)

    await expect(
      stakingProxy.connect(signers[1]).deposit(toEther(1500), ['0x'])
    ).to.be.revertedWithCustomError(stakingProxy, 'SenderNotAuthorized()')

    await stakingProxy.deposit(toEther(1500), ['0x'])
    assert.equal(fromEther(await stakingPool.balanceOf(stakingProxy.target)), 1000)
    assert.equal(fromEther(await priorityPool.getQueuedTokens(stakingProxy.target, 0)), 500)
    assert.equal(fromEther(await stakingProxy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await stakingProxy.getTotalQueuedForDeposit(0)), 500)
  })

  it('deposit should work correctly using onTokenTransfer', async () => {
    const { stakingProxy, stakingPool, priorityPool, token, signers, accounts } = await loadFixture(
      deployFixture
    )

    await expect(
      stakingProxy.onTokenTransfer(
        accounts[0],
        toEther(1500),
        ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']])
      )
    ).to.be.revertedWithCustomError(stakingProxy, 'InvalidToken()')
    await expect(
      token
        .connect(signers[1])
        .transferAndCall(
          stakingProxy.target,
          toEther(1500),
          ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']])
        )
    ).to.be.revertedWithCustomError(stakingProxy, 'SenderNotAuthorized()')
    await expect(
      token.transferAndCall(
        stakingProxy.target,
        0,
        ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']])
      )
    ).to.be.revertedWithCustomError(stakingProxy, 'InvalidValue()')

    await token.transferAndCall(
      stakingProxy.target,
      toEther(1500),
      ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [['0x']])
    )
    assert.equal(fromEther(await stakingPool.balanceOf(stakingProxy.target)), 1000)
    assert.equal(fromEther(await priorityPool.getQueuedTokens(stakingProxy.target, 0)), 500)
    assert.equal(fromEther(await stakingProxy.getTotalDeposits()), 1000)
    assert.equal(fromEther(await stakingProxy.getTotalQueuedForDeposit(0)), 500)
  })

  it('claimLSTs should work correctly', async () => {
    const { stakingProxy, stakingPool, priorityPool, strategy } = await loadFixture(deployFixture)

    await stakingProxy.deposit(toEther(1500), ['0x'])
    await strategy.setMaxDeposits(toEther(1200))
    await priorityPool.depositQueuedTokens(0, toEther(500), ['0x'])

    let data = [
      [ethers.ZeroAddress, toEther(0), toEther(0)],
      [stakingProxy.target, toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await priorityPool.pauseForUpdate()
    await priorityPool.updateDistribution(
      tree.root,
      ethers.encodeBytes32String('ipfs'),
      toEther(50),
      toEther(50)
    )

    assert.equal(fromEther(await stakingProxy.getTotalClaimableLSTs(toEther(50))), 50)

    await stakingProxy.claimLSTs(toEther(50), toEther(50), tree.getProof(1))
    assert.equal(fromEther(await stakingProxy.getTotalClaimableLSTs(toEther(50))), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(stakingProxy.target)), 1050)
    assert.equal(fromEther(await stakingProxy.getTotalDeposits()), 1050)
    assert.equal(fromEther(await stakingProxy.getTotalQueuedForDeposit(toEther(50))), 450)
  })

  it('claimLSTs should work correctly', async () => {
    const { stakingProxy, stakingPool, priorityPool, strategy } = await loadFixture(deployFixture)

    await stakingProxy.deposit(toEther(1500), ['0x'])
    await strategy.setMaxDeposits(toEther(1200))
    await priorityPool.depositQueuedTokens(0, toEther(500), ['0x'])

    let data = [
      [ethers.ZeroAddress, toEther(0), toEther(0)],
      [stakingProxy.target, toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await priorityPool.pauseForUpdate()
    await priorityPool.updateDistribution(
      tree.root,
      ethers.encodeBytes32String('ipfs'),
      toEther(50),
      toEther(50)
    )

    assert.equal(fromEther(await stakingProxy.getTotalClaimableLSTs(toEther(50))), 50)

    await stakingProxy.claimLSTs(toEther(50), toEther(50), tree.getProof(1))
    assert.equal(fromEther(await stakingProxy.getTotalClaimableLSTs(toEther(50))), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(stakingProxy.target)), 1050)
    assert.equal(fromEther(await stakingProxy.getTotalDeposits()), 1050)
    assert.equal(fromEther(await stakingProxy.getTotalQueuedForDeposit(toEther(50))), 450)
  })

  it('withdraw should work correctly', async () => {
    const { stakingProxy, stakingPool, priorityPool, signers, strategy, accounts, token } =
      await loadFixture(deployFixture)

    await stakingProxy.deposit(toEther(1500), ['0x'])
    await strategy.setMaxDeposits(toEther(1050))
    await priorityPool.depositQueuedTokens(0, toEther(50), ['0x'])
    await priorityPool.connect(signers[1]).deposit(toEther(200), true, ['0x'])

    let data = [
      [ethers.ZeroAddress, toEther(0), toEther(0)],
      [stakingProxy.target, toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await priorityPool.pauseForUpdate()
    await priorityPool.updateDistribution(
      tree.root,
      ethers.encodeBytes32String('ipfs'),
      toEther(50),
      toEther(50)
    )

    assert.deepEqual(
      (await stakingProxy.getTotalWithdrawable(toEther(50))).map((d: any, i) => {
        if (i < 2) return fromEther(d)
        return d
      }),
      [650, 0, [], []]
    )

    let balance = fromEther(await token.balanceOf(accounts[0]))
    await stakingProxy.withdraw(
      toEther(800),
      toEther(50),
      toEther(50),
      tree.getProof(1),
      [],
      [],
      ['0x']
    )
    assert.equal(fromEther(await stakingPool.balanceOf(stakingProxy.target)), 650)
    assert.equal(fromEther(await token.balanceOf(accounts[0])), balance + 650)
    assert.equal(fromEther(await stakingProxy.getTotalDeposits()), 650)
    assert.equal(fromEther(await stakingProxy.getTotalQueuedForDeposit(toEther(50))), 0)
    assert.equal(fromEther(await stakingProxy.getTotalQueuedForWithdrawal()), 150)
    assert.deepEqual(
      (await stakingProxy.getTotalWithdrawable(toEther(50))).map((d: any, i) => {
        if (i < 2) return fromEther(d)
        return d
      }),
      [0, 0, [], []]
    )

    await priorityPool.deposit(toEther(100), true, ['0x'])

    assert.deepEqual(
      (await stakingProxy.getTotalWithdrawable(toEther(50))).map((d: any, i) => {
        if (i < 2) return fromEther(d)
        return d.map((v: any) => Number(v))
      }),
      [0, 100, [1], [0]]
    )

    balance = fromEther(await token.balanceOf(accounts[0]))
    await stakingProxy.withdraw(
      toEther(100),
      toEther(50),
      toEther(50),
      tree.getProof(1),
      [1],
      [0],
      ['0x']
    )
    assert.equal(fromEther(await stakingPool.balanceOf(stakingProxy.target)), 650)
    assert.equal(fromEther(await token.balanceOf(accounts[0])), balance + 100)
    assert.equal(fromEther(await stakingProxy.getTotalDeposits()), 650)
    assert.equal(fromEther(await stakingProxy.getTotalQueuedForDeposit(toEther(50))), 0)
    assert.equal(fromEther(await stakingProxy.getTotalQueuedForWithdrawal()), 50)
    assert.deepEqual(
      (await stakingProxy.getTotalWithdrawable(toEther(50))).map((d: any, i) => {
        if (i < 2) return fromEther(d)
        return d
      }),
      [0, 0, [], []]
    )

    await priorityPool.deposit(toEther(125), true, ['0x'])

    assert.deepEqual(
      (await stakingProxy.getTotalWithdrawable(toEther(50))).map((d: any, i) => {
        if (i < 2) return fromEther(d)
        return d.map((v: any) => Number(v))
      }),
      [75, 50, [1], [2]]
    )

    balance = fromEther(await token.balanceOf(accounts[0]))
    await stakingProxy.withdraw(
      toEther(120),
      toEther(50),
      toEther(50),
      tree.getProof(1),
      [1],
      [2],
      ['0x']
    )
    assert.equal(fromEther(await stakingPool.balanceOf(stakingProxy.target)), 580)
    assert.equal(fromEther(await token.balanceOf(accounts[0])), balance + 120)
    assert.equal(fromEther(await stakingProxy.getTotalDeposits()), 580)
    assert.equal(fromEther(await stakingProxy.getTotalQueuedForDeposit(toEther(50))), 0)
    assert.equal(fromEther(await stakingProxy.getTotalQueuedForWithdrawal()), 0)
    assert.deepEqual(
      (await stakingProxy.getTotalWithdrawable(toEther(50))).map((d: any, i) => {
        if (i < 2) return fromEther(d)
        return d
      }),
      [5, 0, [], []]
    )
  })

  it('should be able to deposit reSDL tokens', async () => {
    const { stakingProxy, sdlPool, sdlToken, accounts } = await loadFixture(deployFixture)

    await sdlToken.transferAndCall(
      sdlPool.target,
      toEther(1000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.target,
      toEther(1000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.target,
      toEther(1000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )

    await sdlPool.transferFrom(accounts[0], stakingProxy.target, 1)
    await sdlPool.safeTransferFrom(accounts[0], stakingProxy.target, 3)

    assert.deepEqual(await stakingProxy.getRESDLTokenIds(), [1n, 3n])
  })

  it('should be able to claim reSDL rewards', async () => {
    const { stakingProxy, sdlPool, sdlToken, accounts, stakingPool, priorityPool, token } =
      await loadFixture(deployFixture)

    await sdlToken.transferAndCall(
      sdlPool.target,
      toEther(500),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.target,
      toEther(500),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.target,
      toEther(1000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )
    await priorityPool.deposit(toEther(1000), true, ['0x'])
    await sdlPool.transferFrom(accounts[0], stakingProxy.target, 1)
    await sdlPool.transferFrom(accounts[0], stakingProxy.target, 2)
    await stakingPool.transferAndCall(sdlPool.target, toEther(100), '0x')
    await stakingProxy.claimRESDLRewards([stakingPool.target])

    assert.deepEqual(
      (await sdlPool.withdrawableRewards(stakingProxy.target)).map((d: any) => fromEther(d)),
      [25]
    )
  })

  it('should be able to withdraw reSDL tokens', async () => {
    const { stakingProxy, sdlPool, sdlToken, accounts } = await loadFixture(deployFixture)

    await sdlToken.transferAndCall(
      sdlPool.target,
      toEther(1000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.target,
      toEther(1000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )
    await sdlToken.transferAndCall(
      sdlPool.target,
      toEther(1000),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint64'], [0, 0])
    )

    await sdlPool.transferFrom(accounts[0], stakingProxy.target, 1)
    await sdlPool.safeTransferFrom(accounts[0], stakingProxy.target, 3)

    await expect(stakingProxy.withdrawRESDLToken(2, accounts[2])).to.be.revertedWithCustomError(
      stakingProxy,
      'InvalidTokenId()'
    )

    await stakingProxy.withdrawRESDLToken(1, accounts[2])
    assert.deepEqual(await stakingProxy.getRESDLTokenIds(), [3n])
    assert.equal(await sdlPool.ownerOf(1), accounts[2])

    await stakingProxy.withdrawRESDLToken(3, accounts[3])
    assert.deepEqual(await stakingProxy.getRESDLTokenIds(), [])
    assert.equal(await sdlPool.ownerOf(3), accounts[3])
  })
})
