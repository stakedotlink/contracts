import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  fromEther,
  deployUpgradeable,
  getAccounts,
  setupToken,
} from '../utils/helpers'
import { ERC677, SDLPoolMock, StakingPool, StakingQueue, StrategyMock } from '../../typechain-types'
import { ethers } from 'hardhat'
import { Signer } from 'ethers'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'

describe('StakingQueue', () => {
  let sq: StakingQueue
  let stakingPool: StakingPool
  let strategy: StrategyMock
  let token: ERC677
  let sdlPool: SDLPoolMock
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts, true)

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'Staked LINK',
      'stLINK',
      [],
    ])) as StakingPool

    strategy = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(1000),
      toEther(100),
    ])) as StrategyMock

    sdlPool = (await deploy('SDLPoolMock')) as SDLPoolMock

    sq = (await deployUpgradeable('StakingQueue', [
      token.address,
      stakingPool.address,
      sdlPool.address,
      toEther(100),
    ])) as StakingQueue

    await stakingPool.addStrategy(strategy.address)
    await stakingPool.setStakingQueue(sq.address)
    await sq.setDistributionOracle(accounts[0])

    for (let i = 0; i < signers.length; i++) {
      await token.connect(signers[i]).approve(sq.address, ethers.constants.MaxUint256)
    }
  })

  it('deposit should work correctly', async () => {
    await sq.connect(signers[1]).deposit(toEther(500), true)
    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 500)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], 0)), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9500)

    await sq.connect(signers[2]).deposit(toEther(1000), true)
    assert.equal(fromEther(await sq.totalQueued()), 500)
    assert.equal(fromEther(await token.balanceOf(sq.address)), 500)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 500)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[2], 0)), 500)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9000)

    await strategy.setMaxDeposits(toEther(1600))
    await sq.depositQueuedTokens()
    await sq.connect(signers[3]).deposit(toEther(1000), false)
    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.equal(fromEther(await token.balanceOf(sq.address)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[3])), 100)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[3], 0)), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[3])), 9900)

    await sq.connect(signers[4]).deposit(toEther(1000), true)
    assert.equal(fromEther(await sq.totalQueued()), 1000)
    assert.equal(fromEther(await token.balanceOf(sq.address)), 1000)
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
      ethers.constants.AddressZero,
      accounts[2],
      accounts[4],
      accounts[1],
      accounts[3],
    ])
    assert.equal((await sq.getAccountIndex(accounts[0])).toNumber(), 0)
    assert.equal((await sq.getAccountIndex(accounts[1])).toNumber(), 3)
    assert.equal((await sq.getAccountIndex(accounts[2])).toNumber(), 1)
    assert.equal((await sq.getAccountIndex(accounts[3])).toNumber(), 4)
    assert.equal((await sq.getAccountIndex(accounts[4])).toNumber(), 2)

    await sq.setPoolStatusClosed()
    await expect(sq.deposit(toEther(1000), true)).to.be.revertedWith('DepositsDisabled()')
    await sq.setPoolStatus(1)
    await expect(sq.deposit(toEther(1000), true)).to.be.revertedWith('DepositsDisabled()')
    await sq.setPoolStatus(0)
    await sq.pauseForUpdate()
    await expect(sq.deposit(toEther(1000), true)).to.be.revertedWith('Pausable: paused')
  })

  it('depositQueuedTokens should work correctly', async () => {
    await sq.deposit(toEther(2000), true)
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await strategy.setMaxDeposits(toEther(1500))

    await sq.depositQueuedTokens()
    assert.equal(fromEther(await token.balanceOf(sq.address)), 1500)
    assert.equal(fromEther(await stakingPool.balanceOf(sq.address)), 500)
    assert.equal(fromEther(await sq.totalQueued()), 1500)
    assert.equal(fromEther(await sq.depositsSinceLastUpdate()), 500)

    await strategy.setMaxDeposits(toEther(10000))
    await sq.depositQueuedTokens()
    assert.equal(fromEther(await token.balanceOf(sq.address)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(sq.address)), 2000)
    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.equal(fromEther(await sq.depositsSinceLastUpdate()), 2000)

    await expect(sq.depositQueuedTokens()).to.be.revertedWith('InsufficientQueuedTokens()')
    await sq.deposit(toEther(10000), true)
    await expect(sq.depositQueuedTokens()).to.be.revertedWith('InsufficientDepositRoom()')

    await sq.setPoolStatusClosed()
    await expect(sq.depositQueuedTokens()).to.be.revertedWith('DepositsDisabled()')
    await sq.setPoolStatus(1)
    await expect(sq.depositQueuedTokens()).to.be.revertedWith('DepositsDisabled()')
  })

  it('checkUpkeep should work correctly', async () => {
    await strategy.setMaxDeposits(0)
    await sq.deposit(toEther(1000), true)
    assert.deepEqual(await sq.checkUpkeep('0x'), [false, '0x'])

    await strategy.setMaxDeposits(toEther(1500))
    await sq.setQueueDepositThreshold(toEther(1001))
    assert.deepEqual(await sq.checkUpkeep('0x'), [false, '0x'])

    await sq.deposit(toEther(1), true)
    await sq.setPoolStatusClosed()
    assert.deepEqual(await sq.checkUpkeep('0x'), [false, '0x'])

    await sq.setPoolStatus(1)
    assert.deepEqual(await sq.checkUpkeep('0x'), [false, '0x'])

    await sq.setPoolStatus(0)
    assert.deepEqual(await sq.checkUpkeep('0x'), [true, '0x'])
  })

  it('performUpkeep should work corectly', async () => {
    await sq.deposit(toEther(2000), true)
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await strategy.setMaxDeposits(toEther(1500))

    await sq.performUpkeep('0x')
    assert.equal(fromEther(await token.balanceOf(sq.address)), 1500)
    assert.equal(fromEther(await stakingPool.balanceOf(sq.address)), 500)
    assert.equal(fromEther(await sq.totalQueued()), 1500)
    assert.equal(fromEther(await sq.depositsSinceLastUpdate()), 500)

    await strategy.setMaxDeposits(toEther(4000))
    await sq.performUpkeep('0x')
    assert.equal(fromEther(await token.balanceOf(sq.address)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(sq.address)), 2000)
    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.equal(fromEther(await sq.depositsSinceLastUpdate()), 2000)

    await sq.deposit(toEther(1099), true)
    await strategy.setMaxDeposits(toEther(5000))
    await expect(sq.performUpkeep('0x')).to.be.revertedWith('InsufficientQueuedTokens()')

    await sq.deposit(toEther(1), true)
    await strategy.setMaxDeposits(toEther(4099))
    await expect(sq.performUpkeep('0x')).to.be.revertedWith('InsufficientDepositRoom()')

    await strategy.setMaxDeposits(toEther(4100))
    await sq.performUpkeep('0x')

    await sq.setPoolStatusClosed()
    await expect(sq.performUpkeep('0x')).to.be.revertedWith('DepositsDisabled()')
    await sq.setPoolStatus(1)
    await expect(sq.performUpkeep('0x')).to.be.revertedWith('DepositsDisabled()')
  })

  it('getAccountData should work correctly', async () => {
    await sq.deposit(toEther(2000), true)
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await sdlPool.setEffectiveBalance(accounts[0], toEther(1000))
    await sdlPool.setEffectiveBalance(accounts[1], toEther(400))
    await sdlPool.setEffectiveBalance(accounts[2], toEther(300))

    let data = await sq.getAccountData()
    assert.deepEqual(data[0], [ethers.constants.AddressZero, accounts[0], accounts[1], accounts[2]])
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
      ethers.constants.AddressZero,
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
    await sq.deposit(toEther(2000), true)
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await strategy.setMaxDeposits(toEther(1500))
    await sq.depositQueuedTokens()

    await expect(
      sq.updateDistribution(
        ethers.utils.formatBytes32String(''),
        ethers.utils.formatBytes32String(''),
        0,
        0
      )
    ).to.be.revertedWith('Pausable: not paused')

    await sq.pauseForUpdate()
    await sq.updateDistribution(
      ethers.utils.formatBytes32String('root'),
      ethers.utils.formatBytes32String('ipfs'),
      toEther(400),
      toEther(100)
    )

    assert.equal(fromEther(await sq.depositsSinceLastUpdate()), 100)
    assert.equal(fromEther(await sq.totalDistributed()), 400)
    assert.equal(fromEther(await sq.totalSharesDistributed()), 100)
    assert.equal(await sq.merkleRoot(), ethers.utils.formatBytes32String('root'))
    assert.equal(await sq.ipfsHash(), ethers.utils.formatBytes32String('ipfs'))
    assert.equal(await sq.paused(), false)

    await strategy.setMaxDeposits(toEther(3000))
    await sq.depositQueuedTokens()
    await sq.pauseForUpdate()
    await sq.updateDistribution(
      ethers.utils.formatBytes32String('root2'),
      ethers.utils.formatBytes32String('ipfs2'),
      toEther(2000),
      toEther(300)
    )

    assert.equal(fromEther(await sq.depositsSinceLastUpdate()), 0)
    assert.equal(fromEther(await sq.totalDistributed()), 2000)
    assert.equal(fromEther(await sq.totalSharesDistributed()), 300)
    assert.equal(await sq.merkleRoot(), ethers.utils.formatBytes32String('root2'))
    assert.equal(await sq.ipfsHash(), ethers.utils.formatBytes32String('ipfs2'))
    assert.equal(await sq.paused(), false)
  })

  it('claimLSDTokens should work correctly', async () => {
    await sq.deposit(toEther(2000), true)
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await strategy.setMaxDeposits(toEther(1500))
    await sq.depositQueuedTokens()

    let data = [
      [ethers.constants.AddressZero, toEther(0), toEther(0)],
      [accounts[0], toEther(300), toEther(300)],
      [accounts[1], toEther(150), toEther(150)],
      [accounts[2], toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await sq.pauseForUpdate()
    await sq.updateDistribution(
      tree.root,
      ethers.utils.formatBytes32String('ipfs'),
      toEther(500),
      toEther(500)
    )

    await expect(
      sq.claimLSDTokens(toEther(301), toEther(300), tree.getProof(1))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      sq.claimLSDTokens(toEther(300), toEther(301), tree.getProof(1))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      sq.claimLSDTokens(toEther(300), toEther(300), tree.getProof(2))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      sq.connect(signers[1]).claimLSDTokens(toEther(300), toEther(300), tree.getProof(1))
    ).to.be.revertedWith('InvalidProof()')

    assert.equal(fromEther(await sq.getLSDTokens(accounts[0], data[1][2])), 300)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[0], data[1][1])), 700)

    await sq.claimLSDTokens(toEther(300), toEther(300), tree.getProof(1))
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[0])), 1300)
    assert.equal(fromEther(await sq.getLSDTokens(accounts[0], data[1][2])), 0)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[0], data[1][1])), 700)

    await token.transfer(strategy.address, toEther(1500))
    await stakingPool.updateStrategyRewards([0])

    await sq.connect(signers[1]).claimLSDTokens(toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 300)
    assert.equal(fromEther(await sq.getLSDTokens(accounts[1], data[2][2])), 0)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], data[2][1])), 350)

    await expect(
      sq.connect(signers[1]).claimLSDTokens(toEther(150), toEther(150), tree.getProof(2))
    ).to.be.revertedWith('NothingToClaim()')
  })

  it('unqueueTokens should work correctly', async () => {
    await sq.deposit(toEther(2000), true)
    await sq.connect(signers[1]).deposit(toEther(500), true)
    await sq.connect(signers[2]).deposit(toEther(500), true)
    await strategy.setMaxDeposits(toEther(1500))
    await sq.depositQueuedTokens()

    await expect(sq.unqueueTokens(toEther(1501), 0, 0, [])).to.be.revertedWith(
      'InsufficientQueuedTokens()'
    )

    await sq.connect(signers[1]).unqueueTokens(toEther(100), 0, 0, [])
    assert.equal(fromEther(await sq.totalQueued()), 1400)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9600)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], 0)), 400)

    let data = [
      [ethers.constants.AddressZero, toEther(0), toEther(0)],
      [accounts[0], toEther(300), toEther(300)],
      [accounts[1], toEther(150), toEther(150)],
      [accounts[2], toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await sq.pauseForUpdate()
    await sq.updateDistribution(
      tree.root,
      ethers.utils.formatBytes32String('ipfs'),
      toEther(500),
      toEther(500)
    )

    await expect(
      sq
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(151), toEther(150), tree.getProof(2))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      sq
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(150), toEther(151), tree.getProof(2))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      sq
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(1))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      sq.unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(1))
    ).to.be.revertedWith('InvalidProof()')

    await sq
      .connect(signers[1])
      .unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await sq.totalQueued()), 1350)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9650)
    assert.equal(fromEther(await sq.getLSDTokens(accounts[1], data[2][2])), 150)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], data[2][1])), 200)

    await expect(
      sq.connect(signers[2]).unqueueTokens(toEther(500), toEther(50), toEther(50), tree.getProof(3))
    ).to.be.revertedWith('InsufficientBalance()')

    await sq
      .connect(signers[2])
      .unqueueTokens(toEther(450), toEther(50), toEther(50), tree.getProof(3))
    assert.equal(fromEther(await sq.totalQueued()), 900)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
    assert.equal(fromEther(await sq.getLSDTokens(accounts[2], data[3][2])), 50)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[2], data[3][1])), 0)

    await token.transfer(strategy.address, toEther(1500))
    await stakingPool.updateStrategyRewards([0])

    await sq
      .connect(signers[1])
      .unqueueTokens(toEther(100), toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await sq.totalQueued()), 800)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9750)
    assert.equal(fromEther(await sq.getLSDTokens(accounts[1], data[2][2])), 300)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], data[2][1])), 100)
  })

  it('withdraw should work correctly', async () => {
    await stakingPool.connect(signers[1]).approve(sq.address, ethers.constants.MaxUint256)
    await stakingPool.connect(signers[2]).approve(sq.address, ethers.constants.MaxUint256)
    await sq.connect(signers[1]).deposit(toEther(2000), true)
    await sq.deposit(toEther(100), true)
    await sq.connect(signers[2]).deposit(toEther(100), true)
    await strategy.setMaxDeposits(toEther(1700))
    await sq.depositQueuedTokens()

    await sq.pauseForUpdate()
    await sq.connect(signers[1]).withdraw(toEther(10), 0, 0, [])

    assert.equal(fromEther(await sq.totalQueued()), 490)
    assert.equal(fromEther(await sq.depositsSinceLastUpdate()), 710)
    assert.equal(fromEther(await stakingPool.totalStaked()), 1700)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 8010)

    await sq.updateDistribution(
      ethers.utils.formatBytes32String(''),
      ethers.utils.formatBytes32String('ipfs'),
      toEther(700),
      0
    )
    await sq.connect(signers[1]).withdraw(toEther(500), 0, 0, [])

    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.equal(fromEther(await sq.depositsSinceLastUpdate()), 500)
    assert.equal(fromEther(await stakingPool.totalStaked()), 1690)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 8510)

    await stakingPool.connect(signers[1]).transfer(accounts[2], toEther(50))
    await sq.connect(signers[2]).withdraw(toEther(50), 0, 0, [])

    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.equal(fromEther(await sq.depositsSinceLastUpdate()), 500)
    assert.equal(fromEther(await stakingPool.totalStaked()), 1640)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
  })

  it.only('withdraw should work correctly with queued tokens', async () => {
    await stakingPool.connect(signers[1]).approve(sq.address, ethers.constants.MaxUint256)
    await stakingPool.connect(signers[2]).approve(sq.address, ethers.constants.MaxUint256)
    await sq.deposit(toEther(1000), true)
    await sq.connect(signers[1]).deposit(toEther(100), true)
    await sq.connect(signers[2]).deposit(toEther(200), true)
    await strategy.setMaxDeposits(toEther(1150))
    await sq.depositQueuedTokens()

    await sq.pauseForUpdate()
    await expect(
      sq.connect(signers[1]).withdraw(toEther(10), toEther(1), 0, [])
    ).to.be.revertedWith('Pausable: paused')

    let data = [
      [ethers.constants.AddressZero, toEther(0), toEther(0)],
      [accounts[0], toEther(0), toEther(0)],
      [accounts[1], toEther(50), toEther(50)],
      [accounts[2], toEther(100), toEther(100)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await sq.updateDistribution(
      tree.root,
      ethers.utils.formatBytes32String('ipfs'),
      toEther(150),
      toEther(150)
    )
    await sq.connect(signers[1]).withdraw(toEther(50), toEther(50), toEther(50), tree.getProof(2))

    assert.equal(fromEther(await sq.totalQueued()), 100)
    assert.equal(fromEther(await sq.depositsSinceLastUpdate()), 0)
    assert.equal(fromEther(await stakingPool.totalStaked()), 1150)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9950)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], toEther(50))), 0)

    await expect(
      sq.connect(signers[2]).withdraw(toEther(150), toEther(100), toEther(100), tree.getProof(2))
    ).to.be.revertedWith('InvalidProof()')
    await stakingPool.transfer(accounts[2], toEther(100))
    await sq
      .connect(signers[2])
      .withdraw(toEther(150), toEther(100), toEther(100), tree.getProof(3))

    assert.equal(fromEther(await sq.totalQueued()), 0)
    assert.equal(fromEther(await sq.depositsSinceLastUpdate()), 0)
    assert.equal(fromEther(await stakingPool.totalStaked()), 1100)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[2], toEther(100))), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 50)
  })

  it('canWithdraw should work correctly', async () => {
    await sq.deposit(toEther(2000), true)
    assert.equal(fromEther(await sq.canWithdraw()), 1900)

    await sq.pauseForUpdate()
    assert.equal(fromEther(await sq.canWithdraw()), 900)
  })

  it('onTokenTransfer should work correctly', async () => {
    await expect(sq.onTokenTransfer(accounts[0], 1000, '0x')).to.be.revertedWith(
      'UnauthorizedToken()'
    )
    await expect(token.transferAndCall(sq.address, 0, '0x')).to.be.revertedWith('InvalidValue()')

    await token
      .connect(signers[1])
      .transferAndCall(
        sq.address,
        toEther(2000),
        ethers.utils.defaultAbiCoder.encode(['bool'], [false])
      )
    await token
      .connect(signers[1])
      .transferAndCall(
        sq.address,
        toEther(2000),
        ethers.utils.defaultAbiCoder.encode(['bool'], [false])
      )

    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9000)
    assert.equal(fromEther(await sq.totalQueued()), 0)

    await token
      .connect(signers[1])
      .transferAndCall(
        sq.address,
        toEther(2000),
        ethers.utils.defaultAbiCoder.encode(['bool'], [true])
      )
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 7000)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], 0)), 2000)
    assert.equal(fromEther(await sq.totalQueued()), 2000)

    await stakingPool.connect(signers[1]).transferAndCall(sq.address, toEther(100), '0x')
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 900)
    assert.equal(fromEther(await sq.getQueuedTokens(accounts[1], 0)), 2000)
    assert.equal(fromEther(await sq.totalQueued()), 1900)
  })
})
