import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  fromEther,
  deployUpgradeable,
  getAccounts,
  setupToken,
} from '../../utils/helpers'
import {
  ERC677,
  SDLPoolMock,
  StakingPool,
  PriorityPool,
  StrategyMock,
} from '../../../typechain-types'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('PriorityPool', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.token = await token.getAddress()
    await setupToken(token, accounts, true)

    const stakingPool = (await deployUpgradeable('StakingPool', [
      adrs.token,
      'Staked LINK',
      'stLINK',
      [],
    ])) as StakingPool
    adrs.stakingPool = await stakingPool.getAddress()

    const strategy = (await deployUpgradeable('StrategyMock', [
      adrs.token,
      adrs.stakingPool,
      toEther(1000),
      toEther(100),
    ])) as StrategyMock
    adrs.strategy = await strategy.getAddress()

    const sdlPool = (await deploy('SDLPoolMock')) as SDLPoolMock
    adrs.sdlPool = await sdlPool.getAddress()

    const sq = (await deployUpgradeable('PriorityPool', [
      adrs.token,
      adrs.stakingPool,
      adrs.sdlPool,
      toEther(100),
      toEther(1000),
    ])) as PriorityPool
    adrs.sq = await sq.getAddress()

    await stakingPool.addStrategy(adrs.strategy)
    await stakingPool.setPriorityPool(adrs.sq)
    await stakingPool.setRebaseController(accounts[0])
    await sq.setDistributionOracle(accounts[0])

    for (let i = 0; i < 14; i++) {
      await token.connect(signers[i]).approve(adrs.sq, ethers.MaxUint256)
    }

    await sq.deposit(1000, false)

    return { signers, accounts, adrs, token, stakingPool, strategy, sdlPool, sq }
  }

  it('deposit should work correctly', async () => {
    const { signers, accounts, adrs, sq, stakingPool, token, strategy } = await loadFixture(
      deployFixture
    )

    await sq.connect(signers[1]).deposit(toEther(500), true)
    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 500)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], 0)), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9500)

    await sq.connect(signers[2]).deposit(toEther(1000), true)
    assert.equal(fromEther(await sq.totalQueued()), 500)
    assert.equal(fromEther(await token.balanceOf(adrs.sq)), 500)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 500)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[2], 0)), 500)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9000)

    await strategy.setMaxDeposits(toEther(1600))
    await sq.depositQueuedTokens(toEther(100), toEther(1000))
    await sq.connect(signers[3]).deposit(toEther(1000), false)
    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.equal(fromEther(await token.balanceOf(adrs.sq)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[3])), 100)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[3], 0)), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[3])), 9900)

    await sq.connect(signers[4]).deposit(toEther(1000), true)
    assert.equal(fromEther(await sq.totalQueued()), 1000)
    assert.equal(fromEther(await token.balanceOf(adrs.sq)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[4], 0)), 1000)
    assert.equal(fromEther(await token.balanceOf(accounts[4])), 9000)

    await sq.connect(signers[1]).deposit(toEther(10), true)
    await sq.connect(signers[2]).deposit(toEther(10), true)
    await sq.connect(signers[3]).deposit(toEther(10), true)
    await sq.connect(signers[4]).deposit(toEther(10), true)
    await sq.connect(signers[1]).deposit(toEther(10), true)
    await sq.connect(signers[2]).deposit(toEther(10), true)
    await sq.connect(signers[3]).deposit(toEther(10), true)
    await sq.connect(signers[4]).deposit(toEther(10), true)

    assert.deepEqual(await sq.getAccounts(), [
      ethers.ZeroAddress,
      accounts[2],
      accounts[4],
      accounts[1],
      accounts[3],
    ])
    assert.equal(Number(await sq.getAccountIndex(accounts[0])), 0)
    assert.equal(Number(await sq.getAccountIndex(accounts[1])), 3)
    assert.equal(Number(await sq.getAccountIndex(accounts[2])), 1)
    assert.equal(Number(await sq.getAccountIndex(accounts[3])), 4)
    assert.equal(Number(await sq.getAccountIndex(accounts[4])), 2)

    await sq.setPoolStatus(2)
    await expect(sq.deposit(toEther(1000), true)).to.be.revertedWithCustomError(
      sq,
      'DepositsDisabled()'
    )
    await sq.setPoolStatus(1)
    await expect(sq.deposit(toEther(1000), true)).to.be.revertedWithCustomError(
      sq,
      'DepositsDisabled()'
    )
    await sq.setPoolStatus(0)
    await sq.pauseForUpdate()
    await expect(sq.deposit(toEther(1000), true)).to.be.revertedWith('Pausable: paused')
  })

  it('depositQueuedTokens should work correctly', async () => {
    const { signers, adrs, sq, stakingPool, token, strategy } = await loadFixture(deployFixture)

    await sq.deposit(toEther(2000), true)
    await sq.withdraw(1000, 0, 0, [], true)
    await token.transfer(adrs.strategy, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await strategy.setMaxDeposits(toEther(3500))

    await sq.depositQueuedTokens(toEther(100), toEther(1000))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3000)
    assert.equal(fromEther(await token.balanceOf(adrs.sq)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.sq)), 1000)
    assert.equal(fromEther(await sq.totalQueued()), 1000)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await token.transfer(adrs.stakingPool, toEther(500))
    await sq.depositQueuedTokens(toEther(100), toEther(1000))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3500)
    assert.equal(fromEther(await token.balanceOf(adrs.sq)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.sq)), 1000)
    assert.equal(fromEther(await sq.totalQueued()), 1000)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await strategy.setMaxDeposits(toEther(4000))
    await token.transfer(adrs.stakingPool, toEther(200))
    await sq.depositQueuedTokens(toEther(100), toEther(1000))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 4000)
    assert.equal(fromEther(await token.balanceOf(adrs.sq)), 700)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.sq)), 1300)
    assert.equal(fromEther(await sq.totalQueued()), 700)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1300, 650]
    )

    await strategy.setMaxDeposits(toEther(4850))
    await token.transfer(adrs.stakingPool, toEther(100))
    await sq.depositQueuedTokens(toEther(100), toEther(1000))
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 4800)
    assert.equal(fromEther(await token.balanceOf(adrs.sq)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.sq)), 2000)
    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [2000, 1000]
    )

    await expect(sq.depositQueuedTokens(toEther(100), toEther(1000))).to.be.revertedWithCustomError(
      sq,
      'InsufficientDepositRoom()'
    )
    await strategy.setMaxDeposits(toEther(4900))
    await expect(sq.depositQueuedTokens(toEther(100), toEther(1000))).to.be.revertedWithCustomError(
      sq,
      'InsufficientQueuedTokens()'
    )
    await sq.deposit(toEther(199), true)
    await strategy.setMaxDeposits(toEther(5000))
    await expect(sq.depositQueuedTokens(toEther(100), toEther(1000))).to.be.revertedWithCustomError(
      sq,
      'InsufficientQueuedTokens()'
    )
    await token.transfer(adrs.stakingPool, toEther(1))
    await sq.depositQueuedTokens(toEther(100), toEther(1000))

    await sq.setPoolStatus(2)
    await expect(sq.depositQueuedTokens(toEther(100), toEther(1000))).to.be.revertedWithCustomError(
      sq,
      'DepositsDisabled()'
    )
    await sq.setPoolStatus(1)
    await expect(sq.depositQueuedTokens(toEther(100), toEther(1000))).to.be.revertedWithCustomError(
      sq,
      'DepositsDisabled()'
    )
  })

  it('checkUpkeep should work correctly', async () => {
    const { adrs, sq, token, strategy } = await loadFixture(deployFixture)

    await strategy.setMaxDeposits(0)
    await sq.deposit(toEther(1000), true)
    await strategy.setMaxDeposits(10)
    assert.deepEqual(await sq.checkUpkeep('0x'), [false, '0x'])

    await strategy.setMaxDeposits(toEther(1500))
    await sq.setQueueDepositParams(toEther(1001), toEther(2000))
    assert.deepEqual(await sq.checkUpkeep('0x'), [false, '0x'])

    await token.transfer(adrs.stakingPool, toEther(1))
    await sq.setPoolStatus(2)
    assert.deepEqual(await sq.checkUpkeep('0x'), [false, '0x'])

    await sq.setPoolStatus(1)
    assert.deepEqual(await sq.checkUpkeep('0x'), [false, '0x'])

    await sq.setPoolStatus(0)
    assert.deepEqual(await sq.checkUpkeep('0x'), [true, '0x'])
  })

  it('performUpkeep should work corectly', async () => {
    const { signers, adrs, sq, stakingPool, token, strategy } = await loadFixture(deployFixture)

    await sq.deposit(toEther(2000), true)
    await sq.withdraw(1000, 0, 0, [], true)
    await token.transfer(adrs.strategy, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await strategy.setMaxDeposits(toEther(3500))

    await sq.performUpkeep('0x')
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3000)
    assert.equal(fromEther(await token.balanceOf(adrs.sq)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.sq)), 1000)
    assert.equal(fromEther(await sq.totalQueued()), 1000)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await token.transfer(adrs.stakingPool, toEther(500))
    await sq.performUpkeep('0x')
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3500)
    assert.equal(fromEther(await token.balanceOf(adrs.sq)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.sq)), 1000)
    assert.equal(fromEther(await sq.totalQueued()), 1000)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await strategy.setMaxDeposits(toEther(4000))
    await token.transfer(adrs.stakingPool, toEther(200))
    await sq.performUpkeep('0x')
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 4000)
    assert.equal(fromEther(await token.balanceOf(adrs.sq)), 700)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.sq)), 1300)
    assert.equal(fromEther(await sq.totalQueued()), 700)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1300, 650]
    )

    await strategy.setMaxDeposits(toEther(4850))
    await token.transfer(adrs.stakingPool, toEther(100))
    await sq.performUpkeep('0x')
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 4800)
    assert.equal(fromEther(await token.balanceOf(adrs.sq)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.sq)), 2000)
    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [2000, 1000]
    )

    await expect(sq.performUpkeep('0x')).to.be.revertedWithCustomError(
      sq,
      'InsufficientDepositRoom()'
    )
    await strategy.setMaxDeposits(toEther(4900))
    await expect(sq.performUpkeep('0x')).to.be.revertedWithCustomError(
      sq,
      'InsufficientQueuedTokens()'
    )
    await sq.deposit(toEther(199), true)
    await strategy.setMaxDeposits(toEther(5000))
    await expect(sq.performUpkeep('0x')).to.be.revertedWithCustomError(
      sq,
      'InsufficientQueuedTokens()'
    )
    await token.transfer(adrs.stakingPool, toEther(1))
    await sq.performUpkeep('0x')

    await sq.setPoolStatus(2)
    await expect(sq.performUpkeep('0x')).to.be.revertedWithCustomError(sq, 'DepositsDisabled()')
    await sq.setPoolStatus(1)
    await expect(sq.performUpkeep('0x')).to.be.revertedWithCustomError(sq, 'DepositsDisabled()')
  })

  it('getAccountData should work correctly', async () => {
    const { signers, accounts, sq, sdlPool } = await loadFixture(deployFixture)

    await sq.deposit(toEther(2000), true)
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await sdlPool.setEffectiveBalance(accounts[0], toEther(1000))
    await sdlPool.setEffectiveBalance(accounts[1], toEther(400))
    await sdlPool.setEffectiveBalance(accounts[2], toEther(300))

    let data = await sq.getAccountData()
    assert.deepEqual(data[0], [ethers.ZeroAddress, accounts[0], accounts[1], accounts[2]])
    assert.deepEqual(
      data[1].map((v: any) => fromEther(v)),
      [0, 1000, 400, 300]
    )
    assert.deepEqual(
      data[2].map((v: any) => fromEther(v)),
      [0, 1000, 500, 500]
    )

    await sq.connect(signers[3]).deposit(toEther(100), true)
    await sdlPool.setEffectiveBalance(accounts[0], toEther(150))

    data = await sq.getAccountData()
    assert.deepEqual(data[0], [
      ethers.ZeroAddress,
      accounts[0],
      accounts[1],
      accounts[2],
      accounts[3],
    ])
    assert.deepEqual(
      data[1].map((v: any) => fromEther(v)),
      [0, 150, 400, 300, 0]
    )
    assert.deepEqual(
      data[2].map((v: any) => fromEther(v)),
      [0, 1000, 500, 500, 100]
    )
  })

  it('updateDistribution should work correctly', async () => {
    const { signers, adrs, sq, stakingPool, token, strategy } = await loadFixture(deployFixture)

    await sq.deposit(toEther(2000), true)
    await token.transfer(adrs.strategy, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await strategy.setMaxDeposits(toEther(2500))
    await sq.depositQueuedTokens(toEther(0), toEther(10000))

    await expect(
      sq.updateDistribution(ethers.encodeBytes32String(''), ethers.encodeBytes32String(''), 0, 0)
    ).to.be.revertedWith('Pausable: not paused')

    await sq.pauseForUpdate()
    await sq.updateDistribution(
      ethers.encodeBytes32String('root'),
      ethers.encodeBytes32String('ipfs'),
      toEther(400),
      toEther(200)
    )

    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [100, 50]
    )
    assert.equal(await sq.merkleRoot(), ethers.encodeBytes32String('root'))
    assert.equal(await sq.ipfsHash(), ethers.encodeBytes32String('ipfs'))
    assert.equal(await sq.paused(), false)

    await strategy.setMaxDeposits(toEther(4000))
    await sq.depositQueuedTokens(toEther(0), toEther(10000))
    await sq.pauseForUpdate()
    await sq.updateDistribution(
      ethers.encodeBytes32String('root2'),
      ethers.encodeBytes32String('ipfs2'),
      toEther(1600),
      toEther(800)
    )

    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [0, 0]
    )
    assert.equal(await sq.merkleRoot(), ethers.encodeBytes32String('root2'))
    assert.equal(await sq.ipfsHash(), ethers.encodeBytes32String('ipfs2'))
    assert.equal(await sq.paused(), false)
  })

  it('claimLSDTokens should work correctly', async () => {
    const { signers, accounts, adrs, sq, stakingPool, token, strategy } = await loadFixture(
      deployFixture
    )

    await sq.deposit(toEther(2000), true)
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await strategy.setMaxDeposits(toEther(1500))
    await sq.depositQueuedTokens(toEther(100), toEther(1000))

    let data = [
      [ethers.ZeroAddress, toEther(0), toEther(0)],
      [accounts[0], toEther(300), toEther(300)],
      [accounts[1], toEther(150), toEther(150)],
      [accounts[2], toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await sq.pauseForUpdate()
    await sq.updateDistribution(
      tree.root,
      ethers.encodeBytes32String('ipfs'),
      toEther(500),
      toEther(500)
    )

    await expect(
      sq.claimLSDTokens(toEther(301), toEther(300), tree.getProof(1))
    ).to.be.revertedWithCustomError(sq, 'InvalidProof()')
    await expect(
      sq.claimLSDTokens(toEther(300), toEther(301), tree.getProof(1))
    ).to.be.revertedWithCustomError(sq, 'InvalidProof()')
    await expect(
      sq.claimLSDTokens(toEther(300), toEther(300), tree.getProof(2))
    ).to.be.revertedWithCustomError(sq, 'InvalidProof()')
    await expect(
      sq.connect(signers[1]).claimLSDTokens(toEther(300), toEther(300), tree.getProof(1))
    ).to.be.revertedWithCustomError(sq, 'InvalidProof()')

    assert.equal(fromEther(await sq.getLSDTokens(accounts[0], data[1][2])), 300)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[0], data[1][1])), 700)

    await sq.claimLSDTokens(toEther(300), toEther(300), tree.getProof(1))
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[0])), 1300)
    assert.equal(fromEther(await sq.getLSDTokens(accounts[0], data[1][2])), 0)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[0], data[1][1])), 700)

    await token.transfer(adrs.strategy, toEther(1500))
    await stakingPool.updateStrategyRewards([0], '0x')

    await sq.connect(signers[1]).claimLSDTokens(toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 300)
    assert.equal(fromEther(await sq.getLSDTokens(accounts[1], data[2][2])), 0)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], data[2][1])), 350)

    await expect(
      sq.connect(signers[1]).claimLSDTokens(toEther(150), toEther(150), tree.getProof(2))
    ).to.be.revertedWithCustomError(sq, 'NothingToClaim()')
  })

  it('unqueueTokens should work correctly', async () => {
    const { signers, accounts, adrs, sq, stakingPool, token, strategy } = await loadFixture(
      deployFixture
    )

    await sq.deposit(toEther(2000), true)
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await strategy.setMaxDeposits(toEther(1500))
    await sq.depositQueuedTokens(toEther(100), toEther(1000))

    await expect(sq.unqueueTokens(toEther(1501), 0, 0, [])).to.be.revertedWithCustomError(
      sq,
      'InsufficientQueuedTokens()'
    )

    await sq.connect(signers[1]).unqueueTokens(toEther(100), 0, 0, [])
    assert.equal(fromEther(await sq.totalQueued()), 1400)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9600)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], 0)), 400)

    let data = [
      [ethers.ZeroAddress, toEther(0), toEther(0)],
      [accounts[0], toEther(300), toEther(300)],
      [accounts[1], toEther(150), toEther(150)],
      [accounts[2], toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await sq.pauseForUpdate()
    await sq.updateDistribution(
      tree.root,
      ethers.encodeBytes32String('ipfs'),
      toEther(500),
      toEther(500)
    )

    await expect(
      sq
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(151), toEther(150), tree.getProof(2))
    ).to.be.revertedWithCustomError(sq, 'InvalidProof()')
    await expect(
      sq
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(150), toEther(151), tree.getProof(2))
    ).to.be.revertedWithCustomError(sq, 'InvalidProof()')
    await expect(
      sq
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(1))
    ).to.be.revertedWithCustomError(sq, 'InvalidProof()')
    await expect(
      sq.unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(1))
    ).to.be.revertedWithCustomError(sq, 'InvalidProof()')

    await sq
      .connect(signers[1])
      .unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await sq.totalQueued()), 1350)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9650)
    assert.equal(fromEther(await sq.getLSDTokens(accounts[1], data[2][2])), 150)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], data[2][1])), 200)

    await expect(
      sq.connect(signers[2]).unqueueTokens(toEther(500), toEther(50), toEther(50), tree.getProof(3))
    ).to.be.revertedWithCustomError(sq, 'InsufficientBalance()')

    await sq
      .connect(signers[2])
      .unqueueTokens(toEther(450), toEther(50), toEther(50), tree.getProof(3))
    assert.equal(fromEther(await sq.totalQueued()), 900)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
    assert.equal(fromEther(await sq.getLSDTokens(accounts[2], data[3][2])), 50)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[2], data[3][1])), 0)

    await token.transfer(adrs.strategy, toEther(1500))
    await stakingPool.updateStrategyRewards([0], '0x')

    await sq
      .connect(signers[1])
      .unqueueTokens(toEther(100), toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await sq.totalQueued()), 800)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9750)
    assert.equal(fromEther(await sq.getLSDTokens(accounts[1], data[2][2])), 300)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], data[2][1])), 100)

    await sq.connect(signers[3]).deposit(toEther(100), true)
    await sq.connect(signers[3]).unqueueTokens(toEther(50), 0, 0, [])
    assert.equal(fromEther(await sq.totalQueued()), 850)
    assert.equal(fromEther(await token.balanceOf(accounts[3])), 9950)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[3], 0)), 50)
  })

  it('withdraw should work correctly', async () => {
    const { signers, accounts, adrs, sq, stakingPool, token, strategy } = await loadFixture(
      deployFixture
    )

    await stakingPool.connect(signers[1]).approve(adrs.sq, ethers.MaxUint256)
    await stakingPool.connect(signers[2]).approve(adrs.sq, ethers.MaxUint256)
    await sq.connect(signers[1]).deposit(toEther(2000), true)
    await token.transfer(adrs.strategy, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await sq.deposit(toEther(100), true)
    await sq.connect(signers[2]).deposit(toEther(100), true)
    await strategy.setMaxDeposits(toEther(2700))
    await sq.depositQueuedTokens(toEther(100), toEther(1000))

    await sq.pauseForUpdate()
    await sq.connect(signers[1]).withdraw(toEther(10), 0, 0, [], false)

    assert.equal(fromEther(await sq.totalQueued()), 490)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [710, 355]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2700)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 8010)

    await sq.updateDistribution(
      ethers.encodeBytes32String(''),
      ethers.encodeBytes32String('ipfs'),
      toEther(700),
      toEther(350)
    )
    await sq.connect(signers[1]).withdraw(toEther(500), 0, 0, [], false)

    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [500, 250]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2690)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 8510)

    await stakingPool.connect(signers[1]).transfer(accounts[2], toEther(50))
    await sq.connect(signers[2]).withdraw(toEther(50), 0, 0, [], false)

    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [500, 250]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2640)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
  })

  it('withdraw should work correctly with queued tokens', async () => {
    const { signers, accounts, adrs, sq, stakingPool, token, strategy } = await loadFixture(
      deployFixture
    )

    await stakingPool.connect(signers[1]).approve(adrs.sq, ethers.MaxUint256)
    await stakingPool.connect(signers[2]).approve(adrs.sq, ethers.MaxUint256)
    await sq.deposit(toEther(1000), true)
    await sq.withdraw(1000, 0, 0, [], true)
    await token.transfer(adrs.strategy, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await sq.connect(signers[1]).deposit(toEther(100), true)
    await sq.connect(signers[2]).deposit(toEther(200), true)
    await strategy.setMaxDeposits(toEther(2150))
    await sq.depositQueuedTokens(toEther(100), toEther(1000))

    await sq.pauseForUpdate()
    await expect(
      sq.connect(signers[1]).withdraw(toEther(10), toEther(1), 0, [], true)
    ).to.be.revertedWith('Pausable: paused')

    let data = [
      [ethers.ZeroAddress, toEther(0), toEther(0)],
      [accounts[0], toEther(0), toEther(0)],
      [accounts[1], toEther(50), toEther(50)],
      [accounts[2], toEther(100), toEther(100)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await sq.updateDistribution(
      tree.root,
      ethers.encodeBytes32String('ipfs'),
      toEther(150),
      toEther(75)
    )
    await sq
      .connect(signers[1])
      .withdraw(toEther(50), toEther(50), toEther(50), tree.getProof(2), true)

    assert.equal(fromEther(await sq.totalQueued()), 100)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [0, 0]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2150)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9950)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], toEther(50))), 0)

    await expect(
      sq
        .connect(signers[2])
        .withdraw(toEther(150), toEther(100), toEther(100), tree.getProof(2), true)
    ).to.be.revertedWithCustomError(sq, 'InvalidProof()')
    await expect(
      sq.connect(signers[2]).withdraw(toEther(150), 0, 0, [], true)
    ).to.be.revertedWithCustomError(sq, 'InvalidProof()')
    await stakingPool.transfer(accounts[2], toEther(100))
    await sq
      .connect(signers[2])
      .withdraw(toEther(150), toEther(100), toEther(100), tree.getProof(3), true)

    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [0, 0]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2100)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[2], toEther(100))), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 50)

    await strategy.setMaxDeposits(toEther(2100))
    await sq.connect(signers[3]).deposit(toEther(100), true)
    await sq.connect(signers[3]).withdraw(toEther(50), 0, 0, [], true)
    assert.equal(fromEther(await sq.totalQueued()), 50)
    assert.deepEqual(
      (await sq.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [0, 0]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2100)
    assert.equal(fromEther(await token.balanceOf(accounts[3])), 9950)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[3], 0)), 50)
  })

  it('canWithdraw should work correctly', async () => {
    const { accounts, sq, strategy } = await loadFixture(deployFixture)

    await strategy.setMinDeposits(0)
    await sq.deposit(toEther(2000), true)
    assert.equal(fromEther(await sq.canWithdraw(accounts[0], 0)), 2000)
    await strategy.setMaxDeposits(toEther(1100))
    await sq.depositQueuedTokens(toEther(100), toEther(1000))
    assert.equal(fromEther(await sq.canWithdraw(accounts[0], 0)), 1900)
    await sq.pauseForUpdate()
    assert.equal(fromEther(await sq.canWithdraw(accounts[0], 0)), 1000)
  })

  it('onTokenTransfer should work correctly', async () => {
    const { signers, accounts, adrs, sq, stakingPool, token } = await loadFixture(deployFixture)

    await expect(sq.onTokenTransfer(accounts[0], 1000, '0x')).to.be.revertedWithCustomError(
      sq,
      'UnauthorizedToken()'
    )
    await expect(token.transferAndCall(adrs.sq, 0, '0x')).to.be.revertedWithCustomError(
      sq,
      'InvalidValue()'
    )

    await token
      .connect(signers[1])
      .transferAndCall(
        adrs.sq,
        toEther(2000),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [false])
      )
    await token
      .connect(signers[1])
      .transferAndCall(
        adrs.sq,
        toEther(2000),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [false])
      )

    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9000)
    assert.equal(fromEther(await sq.totalQueued()), 0)

    await token
      .connect(signers[1])
      .transferAndCall(
        adrs.sq,
        toEther(2000),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [true])
      )
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 7000)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], 0)), 2000)
    assert.equal(fromEther(await sq.totalQueued()), 2000)

    await stakingPool.connect(signers[1]).transferAndCall(adrs.sq, toEther(100), '0x')
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 900)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], 0)), 2000)
    assert.equal(fromEther(await sq.totalQueued()), 1900)
  })
})
