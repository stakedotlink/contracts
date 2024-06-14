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
  WithdrawalPool,
} from '../../../typechain-types'
import { ethers } from 'hardhat'
import { Signer } from 'ethers'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'

describe('PriorityPool', () => {
  let pp: PriorityPool
  let stakingPool: StakingPool
  let strategy: StrategyMock
  let withdrawalPool: WithdrawalPool
  let token: ERC677
  let sdlPool: SDLPoolMock
  let accounts: string[]
  let signers: Signer[]

  before(async () => {
    ;({ accounts, signers } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts, true)

    stakingPool = (await deployUpgradeable('StakingPool', [
      token.address,
      'Staked LINK',
      'stLINK',
      [],
      toEther(10000),
    ])) as StakingPool

    strategy = (await deployUpgradeable('StrategyMock', [
      token.address,
      stakingPool.address,
      toEther(1000),
      toEther(100),
    ])) as StrategyMock

    sdlPool = (await deploy('SDLPoolMock')) as SDLPoolMock

    pp = (await deployUpgradeable('PriorityPool', [
      token.address,
      stakingPool.address,
      sdlPool.address,
      toEther(100),
      toEther(1000),
    ])) as PriorityPool

    withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
      token.address,
      stakingPool.address,
      pp.address,
      toEther(10),
    ])) as WithdrawalPool

    await stakingPool.addStrategy(strategy.address)
    await stakingPool.setPriorityPool(pp.address)
    await stakingPool.setRebaseController(accounts[0])
    await pp.setDistributionOracle(accounts[0])
    await pp.setWithdrawalPool(withdrawalPool.address)

    for (let i = 0; i < signers.length; i++) {
      await token.connect(signers[i]).approve(pp.address, ethers.constants.MaxUint256)
    }

    await pp.deposit(1000, false, ['0x'])
  })

  it('deposit should work correctly', async () => {
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 500)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], 0)), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9500)

    await pp.connect(signers[2]).deposit(toEther(1000), true, ['0x'])
    assert.equal(fromEther(await pp.totalQueued()), 500)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 500)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 500)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[2], 0)), 500)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9000)

    await strategy.setMaxDeposits(toEther(1600))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    await pp.connect(signers[3]).deposit(toEther(1000), false, ['0x'])
    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[3])), 100)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[3], 0)), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[3])), 9900)

    await pp.connect(signers[4]).deposit(toEther(1000), true, ['0x'])
    assert.equal(fromEther(await pp.totalQueued()), 1000)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[4], 0)), 1000)
    assert.equal(fromEther(await token.balanceOf(accounts[4])), 9000)

    await pp.connect(signers[1]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[3]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[4]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[1]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[3]).deposit(toEther(10), true, ['0x'])
    await pp.connect(signers[4]).deposit(toEther(10), true, ['0x'])

    assert.deepEqual(await pp.getAccounts(), [
      ethers.constants.AddressZero,
      accounts[2],
      accounts[4],
      accounts[1],
      accounts[3],
    ])
    assert.equal((await pp.getAccountIndex(accounts[0])).toNumber(), 0)
    assert.equal((await pp.getAccountIndex(accounts[1])).toNumber(), 3)
    assert.equal((await pp.getAccountIndex(accounts[2])).toNumber(), 1)
    assert.equal((await pp.getAccountIndex(accounts[3])).toNumber(), 4)
    assert.equal((await pp.getAccountIndex(accounts[4])).toNumber(), 2)

    await pp.setPoolStatus(2)
    await expect(pp.deposit(toEther(1000), true, ['0x'])).to.be.revertedWith('DepositsDisabled()')
    await pp.setPoolStatus(1)
    await expect(pp.deposit(toEther(1000), true, ['0x'])).to.be.revertedWith('DepositsDisabled()')
    await pp.setPoolStatus(0)
    await pp.pauseForUpdate()
    await expect(pp.deposit(toEther(1000), true, ['0x'])).to.be.revertedWith('Pausable: paused')
  })

  it('deposit should work correctly with queued withdrawals', async () => {
    await stakingPool.approve(pp.address, ethers.constants.MaxUint256)
    await pp.deposit(toEther(99), true, ['0x'])
    await pp.withdraw(toEther(20), 0, 0, [], false, true, ['0x'])
    await pp.connect(signers[1]).deposit(toEther(15), true, ['0x'])
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 15)
    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.address)), 5)
    assert.equal(fromEther(await token.balanceOf(withdrawalPool.address)), 15)

    await pp.connect(signers[1]).deposit(toEther(30), true, ['0x'])
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 45)
    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.address)), 0)
    assert.equal(fromEther(await token.balanceOf(withdrawalPool.address)), 20)
  })

  it('depositQueuedTokens should work correctly', async () => {
    await pp.deposit(toEther(2000), true, ['0x'])
    await pp.withdraw(1000, 0, 0, [], true, false, ['0x'])
    await token.transfer(strategy.address, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await strategy.setMaxDeposits(toEther(3500))

    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 3000)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(pp.address)), 1000)
    assert.equal(fromEther(await pp.totalQueued()), 1000)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await token.transfer(stakingPool.address, toEther(500))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 3500)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(pp.address)), 1000)
    assert.equal(fromEther(await pp.totalQueued()), 1000)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await strategy.setMaxDeposits(toEther(4000))
    await token.transfer(stakingPool.address, toEther(200))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 4000)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 700)
    assert.equal(fromEther(await stakingPool.balanceOf(pp.address)), 1300)
    assert.equal(fromEther(await pp.totalQueued()), 700)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1300, 650]
    )

    await strategy.setMaxDeposits(toEther(4850))
    await token.transfer(stakingPool.address, toEther(100))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 4800)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(pp.address)), 2000)
    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [2000, 1000]
    )

    await expect(pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])).to.be.revertedWith(
      'InsufficientDepositRoom()'
    )
    await strategy.setMaxDeposits(toEther(4900))
    await expect(pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])).to.be.revertedWith(
      'InsufficientQueuedTokens()'
    )
    await pp.deposit(toEther(199), true, ['0x'])
    await strategy.setMaxDeposits(toEther(5000))
    await expect(pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])).to.be.revertedWith(
      'InsufficientQueuedTokens()'
    )
    await token.transfer(stakingPool.address, toEther(1))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])

    await pp.setPoolStatus(2)
    await expect(pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])).to.be.revertedWith(
      'DepositsDisabled()'
    )
    await pp.setPoolStatus(1)
    await expect(pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])).to.be.revertedWith(
      'DepositsDisabled()'
    )
  })

  it('checkUpkeep should work correctly', async () => {
    await strategy.setMaxDeposits(0)
    await pp.deposit(toEther(1000), true, ['0x'])
    await strategy.setMaxDeposits(10)
    assert.deepEqual(await pp.checkUpkeep('0x'), [false, '0x'])

    await strategy.setMaxDeposits(toEther(1500))
    await pp.setQueueDepositParams(toEther(1001), toEther(2000))
    assert.deepEqual(await pp.checkUpkeep('0x'), [false, '0x'])

    await token.transfer(stakingPool.address, toEther(1))
    await pp.setPoolStatus(2)
    assert.deepEqual(await pp.checkUpkeep('0x'), [false, '0x'])

    await pp.setPoolStatus(1)
    assert.deepEqual(await pp.checkUpkeep('0x'), [false, '0x'])

    await pp.setPoolStatus(0)
    assert.deepEqual(await pp.checkUpkeep('0x'), [
      true,
      ethers.utils.defaultAbiCoder.encode(['uint256'], [toEther(1001)]),
    ])
  })

  it('performUpkeep should work corectly', async () => {
    await pp.deposit(toEther(2000), true, ['0x'])
    await pp.withdraw(1000, 0, 0, [], true, false, ['0x'])
    await token.transfer(strategy.address, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await strategy.setMaxDeposits(toEther(3500))

    await pp.performUpkeep(ethers.utils.defaultAbiCoder.encode(['bytes[]'], [['0x']]))
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 3000)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(pp.address)), 1000)
    assert.equal(fromEther(await pp.totalQueued()), 1000)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await token.transfer(stakingPool.address, toEther(500))
    await pp.performUpkeep(ethers.utils.defaultAbiCoder.encode(['bytes[]'], [['0x']]))
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 3500)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(pp.address)), 1000)
    assert.equal(fromEther(await pp.totalQueued()), 1000)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1000, 500]
    )

    await strategy.setMaxDeposits(toEther(4000))
    await token.transfer(stakingPool.address, toEther(200))
    await pp.performUpkeep(ethers.utils.defaultAbiCoder.encode(['bytes[]'], [['0x']]))
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 4000)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 700)
    assert.equal(fromEther(await stakingPool.balanceOf(pp.address)), 1300)
    assert.equal(fromEther(await pp.totalQueued()), 700)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [1300, 650]
    )

    await strategy.setMaxDeposits(toEther(4850))
    await token.transfer(stakingPool.address, toEther(100))
    await pp.performUpkeep(ethers.utils.defaultAbiCoder.encode(['bytes[]'], [['0x']]))
    assert.equal(fromEther(await token.balanceOf(strategy.address)), 4800)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(pp.address)), 2000)
    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [2000, 1000]
    )

    await expect(
      pp.performUpkeep(ethers.utils.defaultAbiCoder.encode(['bytes[]'], [['0x']]))
    ).to.be.revertedWith('InsufficientDepositRoom()')
    await strategy.setMaxDeposits(toEther(4900))
    await expect(
      pp.performUpkeep(ethers.utils.defaultAbiCoder.encode(['bytes[]'], [['0x']]))
    ).to.be.revertedWith('InsufficientQueuedTokens()')
    await pp.deposit(toEther(199), true, ['0x'])
    await strategy.setMaxDeposits(toEther(5000))
    await expect(
      pp.performUpkeep(ethers.utils.defaultAbiCoder.encode(['bytes[]'], [['0x']]))
    ).to.be.revertedWith('InsufficientQueuedTokens()')
    await token.transfer(stakingPool.address, toEther(1))
    await pp.performUpkeep(ethers.utils.defaultAbiCoder.encode(['bytes[]'], [['0x']]))

    await pp.setPoolStatus(2)
    await expect(
      pp.performUpkeep(ethers.utils.defaultAbiCoder.encode(['bytes[]'], [['0x']]))
    ).to.be.revertedWith('DepositsDisabled()')
    await pp.setPoolStatus(1)
    await expect(
      pp.performUpkeep(ethers.utils.defaultAbiCoder.encode(['bytes[]'], [['0x']]))
    ).to.be.revertedWith('DepositsDisabled()')
  })

  it('getAccountData should work correctly', async () => {
    await pp.deposit(toEther(2000), true, ['0x'])
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await sdlPool.setEffectiveBalance(accounts[0], toEther(1000))
    await sdlPool.setEffectiveBalance(accounts[1], toEther(400))
    await sdlPool.setEffectiveBalance(accounts[2], toEther(300))

    let data = await pp.getAccountData()
    assert.deepEqual(data[0], [ethers.constants.AddressZero, accounts[0], accounts[1], accounts[2]])
    assert.deepEqual(
      data[1].map((v: any) => fromEther(v)),
      [0, 1000, 400, 300]
    )
    assert.deepEqual(
      data[2].map((v: any) => fromEther(v)),
      [0, 1000, 500, 500]
    )

    await pp.connect(signers[3]).deposit(toEther(100), true, ['0x'])
    await sdlPool.setEffectiveBalance(accounts[0], toEther(150))

    data = await pp.getAccountData()
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
    await pp.deposit(toEther(2000), true, ['0x'])
    await token.transfer(strategy.address, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await strategy.setMaxDeposits(toEther(2500))
    await pp.depositQueuedTokens(toEther(0), toEther(10000), ['0x'])

    await expect(
      pp.updateDistribution(
        ethers.utils.formatBytes32String(''),
        ethers.utils.formatBytes32String(''),
        0,
        0
      )
    ).to.be.revertedWith('Pausable: not paused')

    await pp.pauseForUpdate()
    await pp.updateDistribution(
      ethers.utils.formatBytes32String('root'),
      ethers.utils.formatBytes32String('ipfs'),
      toEther(400),
      toEther(200)
    )

    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [100, 50]
    )
    assert.equal(await pp.merkleRoot(), ethers.utils.formatBytes32String('root'))
    assert.equal(await pp.ipfsHash(), ethers.utils.formatBytes32String('ipfs'))
    assert.equal(await pp.paused(), false)

    await strategy.setMaxDeposits(toEther(4000))
    await pp.depositQueuedTokens(toEther(0), toEther(10000), ['0x'])
    await pp.pauseForUpdate()
    await pp.updateDistribution(
      ethers.utils.formatBytes32String('root2'),
      ethers.utils.formatBytes32String('ipfs2'),
      toEther(1600),
      toEther(800)
    )

    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [0, 0]
    )
    assert.equal(await pp.merkleRoot(), ethers.utils.formatBytes32String('root2'))
    assert.equal(await pp.ipfsHash(), ethers.utils.formatBytes32String('ipfs2'))
    assert.equal(await pp.paused(), false)
  })

  it('claimLSDTokens should work correctly', async () => {
    await pp.deposit(toEther(2000), true, ['0x'])
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await strategy.setMaxDeposits(toEther(1500))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])

    let data = [
      [ethers.constants.AddressZero, toEther(0), toEther(0)],
      [accounts[0], toEther(300), toEther(300)],
      [accounts[1], toEther(150), toEther(150)],
      [accounts[2], toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await pp.pauseForUpdate()
    await pp.updateDistribution(
      tree.root,
      ethers.utils.formatBytes32String('ipfs'),
      toEther(500),
      toEther(500)
    )

    await expect(
      pp.claimLSDTokens(toEther(301), toEther(300), tree.getProof(1))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      pp.claimLSDTokens(toEther(300), toEther(301), tree.getProof(1))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      pp.claimLSDTokens(toEther(300), toEther(300), tree.getProof(2))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      pp.connect(signers[1]).claimLSDTokens(toEther(300), toEther(300), tree.getProof(1))
    ).to.be.revertedWith('InvalidProof()')

    assert.equal(fromEther(await pp.getLSDTokens(accounts[0], data[1][2])), 300)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[0], data[1][1])), 700)

    await pp.claimLSDTokens(toEther(300), toEther(300), tree.getProof(1))
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[0])), 1300)
    assert.equal(fromEther(await pp.getLSDTokens(accounts[0], data[1][2])), 0)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[0], data[1][1])), 700)

    await token.transfer(strategy.address, toEther(1500))
    await stakingPool.updateStrategyRewards([0], '0x')

    await pp.connect(signers[1]).claimLSDTokens(toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 300)
    assert.equal(fromEther(await pp.getLSDTokens(accounts[1], data[2][2])), 0)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], data[2][1])), 350)

    await expect(
      pp.connect(signers[1]).claimLSDTokens(toEther(150), toEther(150), tree.getProof(2))
    ).to.be.revertedWith('NothingToClaim()')
  })

  it('unqueueTokens should work correctly', async () => {
    await pp.deposit(toEther(2000), true, ['0x'])
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await strategy.setMaxDeposits(toEther(1500))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])

    await expect(pp.unqueueTokens(toEther(1501), 0, 0, [])).to.be.revertedWith(
      'InsufficientQueuedTokens()'
    )

    await pp.connect(signers[1]).unqueueTokens(toEther(100), 0, 0, [])
    assert.equal(fromEther(await pp.totalQueued()), 1400)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9600)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], 0)), 400)

    let data = [
      [ethers.constants.AddressZero, toEther(0), toEther(0)],
      [accounts[0], toEther(300), toEther(300)],
      [accounts[1], toEther(150), toEther(150)],
      [accounts[2], toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await pp.pauseForUpdate()
    await pp.updateDistribution(
      tree.root,
      ethers.utils.formatBytes32String('ipfs'),
      toEther(500),
      toEther(500)
    )

    await expect(
      pp
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(151), toEther(150), tree.getProof(2))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      pp
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(150), toEther(151), tree.getProof(2))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      pp
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(1))
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      pp.unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(1))
    ).to.be.revertedWith('InvalidProof()')

    await pp
      .connect(signers[1])
      .unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await pp.totalQueued()), 1350)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9650)
    assert.equal(fromEther(await pp.getLSDTokens(accounts[1], data[2][2])), 150)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], data[2][1])), 200)

    await expect(
      pp.connect(signers[2]).unqueueTokens(toEther(500), toEther(50), toEther(50), tree.getProof(3))
    ).to.be.revertedWith('InsufficientBalance()')

    await pp
      .connect(signers[2])
      .unqueueTokens(toEther(450), toEther(50), toEther(50), tree.getProof(3))
    assert.equal(fromEther(await pp.totalQueued()), 900)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
    assert.equal(fromEther(await pp.getLSDTokens(accounts[2], data[3][2])), 50)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[2], data[3][1])), 0)

    await token.transfer(strategy.address, toEther(1500))
    await stakingPool.updateStrategyRewards([0], '0x')

    await pp
      .connect(signers[1])
      .unqueueTokens(toEther(100), toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await pp.totalQueued()), 800)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9750)
    assert.equal(fromEther(await pp.getLSDTokens(accounts[1], data[2][2])), 300)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], data[2][1])), 100)

    await pp.connect(signers[3]).deposit(toEther(100), true, ['0x'])
    await pp.connect(signers[3]).unqueueTokens(toEther(50), 0, 0, [])
    assert.equal(fromEther(await pp.totalQueued()), 850)
    assert.equal(fromEther(await token.balanceOf(accounts[3])), 9950)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[3], 0)), 50)
  })

  it('withdraw should work correctly', async () => {
    await stakingPool.connect(signers[1]).approve(pp.address, ethers.constants.MaxUint256)
    await stakingPool.connect(signers[2]).approve(pp.address, ethers.constants.MaxUint256)
    await pp.connect(signers[1]).deposit(toEther(2000), true, ['0x'])
    await token.transfer(strategy.address, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await pp.deposit(toEther(100), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(100), true, ['0x'])
    await strategy.setMaxDeposits(toEther(2700))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])

    await pp.pauseForUpdate()
    await pp.connect(signers[1]).withdraw(toEther(10), 0, 0, [], false, false, ['0x'])

    assert.equal(fromEther(await pp.totalQueued()), 490)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [710, 355]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2700)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 8010)

    await pp.updateDistribution(
      ethers.utils.formatBytes32String(''),
      ethers.utils.formatBytes32String('ipfs'),
      toEther(700),
      toEther(350)
    )
    await pp.connect(signers[1]).withdraw(toEther(500), 0, 0, [], false, false, ['0x'])

    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [500, 250]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2690)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 8510)

    await stakingPool.connect(signers[1]).transfer(accounts[2], toEther(50))
    await pp.connect(signers[2]).withdraw(toEther(50), 0, 0, [], false, false, ['0x'])

    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [500, 250]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2640)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
  })

  it('withdraw should work correctly with queued withdrawals', async () => {
    await stakingPool.approve(pp.address, ethers.constants.MaxUint256)
    await pp.deposit(toEther(100), true, ['0x'])
    await pp.withdraw(toEther(50), 0, 0, [], true, true, ['0x'])
    await strategy.setMinDeposits(0)
    await pp.withdraw(toEther(10), 0, 0, [], true, true, ['0x'])

    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.address)), 60)
    assert.equal(fromEther(await withdrawalPool.getTotalQueuedWithdrawals()), 60)
    assert.equal(fromEther(await token.balanceOf(withdrawalPool.address)), 0)
  })

  it('withdraw should work correctly with queued tokens', async () => {
    await stakingPool.connect(signers[1]).approve(pp.address, ethers.constants.MaxUint256)
    await stakingPool.connect(signers[2]).approve(pp.address, ethers.constants.MaxUint256)
    await pp.deposit(toEther(1000), true, ['0x'])
    await pp.withdraw(1000, 0, 0, [], true, false, ['0x'])
    await token.transfer(strategy.address, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await pp.connect(signers[1]).deposit(toEther(100), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(200), true, ['0x'])
    await strategy.setMaxDeposits(toEther(2150))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])

    await pp.pauseForUpdate()
    await expect(
      pp.connect(signers[1]).withdraw(toEther(10), toEther(1), 0, [], true, false, ['0x'])
    ).to.be.revertedWith('Pausable: paused')

    let data = [
      [ethers.constants.AddressZero, toEther(0), toEther(0)],
      [accounts[0], toEther(0), toEther(0)],
      [accounts[1], toEther(50), toEther(50)],
      [accounts[2], toEther(100), toEther(100)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await pp.updateDistribution(
      tree.root,
      ethers.utils.formatBytes32String('ipfs'),
      toEther(150),
      toEther(75)
    )
    await pp
      .connect(signers[1])
      .withdraw(toEther(50), toEther(50), toEther(50), tree.getProof(2), true, false, ['0x'])

    assert.equal(fromEther(await pp.totalQueued()), 100)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [0, 0]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2150)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9950)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], toEther(50))), 0)

    await expect(
      pp
        .connect(signers[2])
        .withdraw(toEther(150), toEther(100), toEther(100), tree.getProof(2), true, false, ['0x'])
    ).to.be.revertedWith('InvalidProof()')
    await expect(
      pp.connect(signers[2]).withdraw(toEther(150), 0, 0, [], true, false, ['0x'])
    ).to.be.revertedWith('InvalidProof()')
    await stakingPool.transfer(accounts[2], toEther(100))
    await pp
      .connect(signers[2])
      .withdraw(toEther(150), toEther(100), toEther(100), tree.getProof(3), true, false, ['0x'])

    assert.equal(fromEther(await pp.totalQueued()), 0)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [0, 0]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2100)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 9950)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[2], toEther(100))), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 50)

    await strategy.setMaxDeposits(toEther(2100))
    await pp.connect(signers[3]).deposit(toEther(100), true, ['0x'])
    await pp.connect(signers[3]).withdraw(toEther(50), 0, 0, [], true, false, ['0x'])
    assert.equal(fromEther(await pp.totalQueued()), 50)
    assert.deepEqual(
      (await pp.getDepositsSinceLastUpdate()).map((v) => fromEther(v)),
      [0, 0]
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 2100)
    assert.equal(fromEther(await token.balanceOf(accounts[3])), 9950)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[3], 0)), 50)
  })

  it('canWithdraw should work correctly', async () => {
    await strategy.setMinDeposits(0)
    await pp.deposit(toEther(2000), true, ['0x'])
    assert.equal(fromEther(await pp.canWithdraw(accounts[0], 0)), 2000)
    await strategy.setMaxDeposits(toEther(1100))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])
    assert.equal(fromEther(await pp.canWithdraw(accounts[0], 0)), 1900)
    await pp.pauseForUpdate()
    assert.equal(fromEther(await pp.canWithdraw(accounts[0], 0)), 1000)
  })

  it('onTokenTransfer should work correctly', async () => {
    await expect(
      pp.onTokenTransfer(
        accounts[0],
        1000,
        ethers.utils.defaultAbiCoder.encode(['bool', 'bytes[]'], [true, ['0x']])
      )
    ).to.be.revertedWith('UnauthorizedToken()')
    await expect(
      token.transferAndCall(
        pp.address,
        0,
        ethers.utils.defaultAbiCoder.encode(['bool', 'bytes[]'], [true, ['0x']])
      )
    ).to.be.revertedWith('InvalidValue()')

    await token
      .connect(signers[1])
      .transferAndCall(
        pp.address,
        toEther(2000),
        ethers.utils.defaultAbiCoder.encode(['bool', 'bytes[]'], [false, ['0x']])
      )
    await token
      .connect(signers[1])
      .transferAndCall(
        pp.address,
        toEther(2000),
        ethers.utils.defaultAbiCoder.encode(['bool', 'bytes[]'], [false, ['0x']])
      )

    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9000)
    assert.equal(fromEther(await pp.totalQueued()), 0)

    await token
      .connect(signers[1])
      .transferAndCall(
        pp.address,
        toEther(2000),
        ethers.utils.defaultAbiCoder.encode(['bool', 'bytes[]'], [true, ['0x']])
      )
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 7000)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], 0)), 2000)
    assert.equal(fromEther(await pp.totalQueued()), 2000)

    await stakingPool
      .connect(signers[1])
      .transferAndCall(
        pp.address,
        toEther(100),
        ethers.utils.defaultAbiCoder.encode(['bool', 'bytes[]'], [false, ['0x']])
      )
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 900)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], 0)), 2000)
    assert.equal(fromEther(await pp.totalQueued()), 1900)
  })

  it('executeQueuedWithdrawals should work correctly', async () => {
    await stakingPool.approve(pp.address, ethers.constants.MaxUint256)
    await pp.deposit(toEther(1000), false, ['0x'])
    await pp.withdraw(toEther(950), 0, 0, [], false, true, ['0x'])
    await strategy.setMinDeposits(toEther(70))
    await withdrawalPool.performUpkeep(ethers.utils.defaultAbiCoder.encode(['bytes[]'], [['0x']]))

    assert.equal(fromEther(await stakingPool.balanceOf(withdrawalPool.address)), 20)
    assert.equal(fromEther(await token.balanceOf(withdrawalPool.address)), 30)
    assert.equal(fromEther(await stakingPool.balanceOf(pp.address)), 0)
    assert.equal(fromEther(await token.balanceOf(pp.address)), 0)
    assert.equal(fromEther(await stakingPool.totalStaked()), 70)
  })
})
