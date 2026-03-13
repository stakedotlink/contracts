import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  deployUpgradeable,
  getConnection,
} from '../utils/helpers'
import {
  ERC677,
  RewardsPool,
  RewardsPoolControllerMock,
  RewardsPoolTimeBased,
  RewardsPoolWSD,
  WrappedSDTokenMock,
} from '../../types/ethers-contracts'

const { ethers, loadFixture, networkHelpers, connection } = getConnection()
const time = networkHelpers.time

describe('RewardsPoolController', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token1 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Token1',
      '1',
      1000000000,
    ])) as ERC677
    await setupToken(token1, accounts)

    const token2 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Token2',
      '2',
      1000000000,
    ])) as ERC677
    await setupToken(token2, accounts)

    const stakingToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'StakingToken',
      'ST',
      1000000000,
    ])) as ERC677
    await setupToken(stakingToken, accounts)

    const controller = (await deployUpgradeable('RewardsPoolControllerMock', [
      stakingToken.target,
    ])) as RewardsPoolControllerMock

    const rewardsPool1 = (await deploy('RewardsPool', [
      controller.target,
      token1.target,
    ])) as RewardsPool

    const rewardsPool2 = (await deploy('RewardsPool', [
      controller.target,
      token2.target,
    ])) as RewardsPool

    async function stake(account: number, amount: number) {
      await stakingToken.connect(signers[account]).approve(controller.target, toEther(amount))
      await controller.connect(signers[account]).stake(toEther(amount))
    }

    async function withdraw(account: number, amount: number) {
      await controller.connect(signers[account]).withdraw(toEther(amount))
    }

    await controller.addToken(token1.target, rewardsPool1.target)
    await controller.addToken(token2.target, rewardsPool2.target)

    await stake(1, 1000)
    await stake(2, 500)

    return {
      signers,
      accounts,
      token1,
      token2,
      stakingToken,
      controller,
      rewardsPool1,
      rewardsPool2,
      stake,
      withdraw,
    }
  }

  it('should be able to add tokens', async () => {
    const { token1, token2, controller } = await loadFixture(deployFixture)

    const token3 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Token3',
      '3',
      1000000000,
    ])) as ERC677

    const rewardsPool3 = (await deploy('RewardsPool', [
      controller.target,
      token3.target,
    ])) as RewardsPool

    await controller.addToken(token3.target, rewardsPool3.target)
    assert.equal(
      JSON.stringify(await controller.supportedTokens()),
      JSON.stringify([token1.target, token2.target, token3.target]),
      'supportedTokens incorrect'
    )
  })

  it('should not be able to add token thats already supported', async () => {
    const { token1, rewardsPool1, controller } = await loadFixture(deployFixture)

    await expect(
      controller.addToken(token1.target, rewardsPool1.target)
    ).to.be.revertedWithCustomError(controller, 'InvalidToken()')
  })

  it('should be able to remove tokens', async () => {
    const { token1, token2, controller } = await loadFixture(deployFixture)

    await controller.removeToken(token1.target)
    assert.equal(
      JSON.stringify(await controller.supportedTokens()),
      JSON.stringify([token2.target]),
      'supportedTokens incorrect'
    )
  })

  it('should not be able to remove token thats not supported', async () => {
    const { rewardsPool1, controller } = await loadFixture(deployFixture)

    await expect(controller.removeToken(rewardsPool1.target)).to.be.revertedWithCustomError(
      controller,
      'InvalidToken()'
    )
  })

  describe('RewardsPool', () => {
    it('withdrawableRewards should work correctly', async () => {
      const { accounts, controller, token1, token2, rewardsPool1, rewardsPool2 } =
        await loadFixture(deployFixture)

      await token1.transferAndCall(rewardsPool1.target, toEther(900), '0x00')
      await token2.transferAndCall(rewardsPool2.target, toEther(300), '0x00')

      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([600, 200]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([300, 100]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('withdrawRewards should work correctly', async () => {
      const { signers, accounts, controller, token1, token2, rewardsPool1, rewardsPool2 } =
        await loadFixture(deployFixture)

      await token1.transferAndCall(rewardsPool1.target, toEther(900), '0x00')
      await token2.transferAndCall(rewardsPool2.target, toEther(300), '0x00')
      await controller.connect(signers[1]).withdrawRewards([token1.target, token2.target])
      await controller.connect(signers[2]).withdrawRewards([token2.target])

      assert.equal(
        fromEther(await token1.balanceOf(accounts[1])),
        10600,
        'account-1 token-1 balance incorrect'
      )
      assert.equal(
        fromEther(await token2.balanceOf(accounts[1])),
        10200,
        'account-1 token-2 balance incorrect'
      )
      assert.equal(
        fromEther(await token1.balanceOf(accounts[2])),
        10000,
        'account-2 token-1 balance incorrect'
      )
      assert.equal(
        fromEther(await token2.balanceOf(accounts[2])),
        10100,
        'account-2 token-2 balance incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([0, 0]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([300, 0]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('staking/withdrawing should update all rewards', async () => {
      const { accounts, token1, token2, rewardsPool1, rewardsPool2, stake, withdraw } =
        await loadFixture(deployFixture)

      await token1.transferAndCall(rewardsPool1.target, toEther(900), '0x00')
      await token2.transferAndCall(rewardsPool2.target, toEther(300), '0x00')

      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )

      await withdraw(1, 500)
      await stake(2, 500)

      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[1])),
        0.6,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool1.userRewardPerTokenPaid(accounts[2])),
        0.6,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[1])),
        0.2,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool2.userRewardPerTokenPaid(accounts[2])),
        0.2,
        'userRewardPerTokenPaid incorrect'
      )
    })

    it('should be able to distributeTokens', async () => {
      const { accounts, controller, token1, token2 } = await loadFixture(deployFixture)

      await token1.transfer(controller.target, toEther(900))
      await token2.transfer(controller.target, toEther(300))

      assert.deepEqual(
        await controller.tokenBalances(),
        [
          [token1.target, token2.target],
          [toEther(900), toEther(300)],
        ],
        'token balances incorrect'
      )

      await controller.distributeTokens([token1.target, token2.target])
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([600, 200]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([300, 100]),
        'account-2 withdrawableRewards incorrect'
      )
    })
  })

  describe('RewardsPoolWSD', () => {
    async function deployFixture2() {
      const fixtureRet = await deployFixture()

      const token3 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
        'Token3',
        '3',
        1000000000,
      ])) as ERC677
      await setupToken(token3, fixtureRet.accounts)

      const token4 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
        'Token4',
        '4',
        1000000000,
      ])) as ERC677
      await setupToken(token4, fixtureRet.accounts)

      const wToken3 = (await deploy('WrappedSDTokenMock', [token3.target])) as WrappedSDTokenMock
      const wToken4 = (await deploy('WrappedSDTokenMock', [token4.target])) as WrappedSDTokenMock

      const rewardsPool3 = (await deploy('RewardsPoolWSD', [
        fixtureRet.controller.target,
        token3.target,
        wToken3.target,
      ])) as RewardsPoolWSD

      const rewardsPool4 = (await deploy('RewardsPoolWSD', [
        fixtureRet.controller.target,
        token4.target,
        wToken4.target,
      ])) as RewardsPoolWSD

      await fixtureRet.controller.addToken(token3.target, rewardsPool3.target)
      await fixtureRet.controller.addToken(token4.target, rewardsPool4.target)

      await token3.transferAndCall(fixtureRet.controller.target, toEther(900), '0x00')
      await token4.transferAndCall(fixtureRet.controller.target, toEther(300), '0x00')

      await token4.transfer(wToken4.target, toEther(900))

      await wToken3.setMultiplier(1)
      await wToken4.setMultiplier(4)

      return { ...fixtureRet, token3, token4, rewardsPool3, rewardsPool4, wToken3, wToken4 }
    }

    it('withdrawableRewards should work correctly', async () => {
      const { accounts, controller } = await loadFixture(deployFixture2)

      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([0, 0, 300, 400]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([0, 0, 150, 200]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('withdrawRewards should work correctly', async () => {
      const { signers, accounts, controller, token3, token4 } = await loadFixture(deployFixture2)

      await controller.connect(signers[1]).withdrawRewards([token3.target, token4.target])
      await controller.connect(signers[2]).withdrawRewards([token4.target])

      assert.equal(
        fromEther(await token3.balanceOf(accounts[1])),
        10300,
        'account-1 token-3 balance incorrect'
      )
      assert.equal(
        fromEther(await token4.balanceOf(accounts[1])),
        10400,
        'account-1 token-4 balance incorrect'
      )
      assert.equal(
        fromEther(await token3.balanceOf(accounts[2])),
        10000,
        'account-2 token-3 balance incorrect'
      )
      assert.equal(
        fromEther(await token4.balanceOf(accounts[2])),
        10200,
        'account-2 token-4 balance incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([0, 0, 0, 0]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([0, 0, 150, 0]),
        'account-2 withdrawableRewards incorrect'
      )
    })

    it('staking/withdrawing should update all rewards', async () => {
      const { accounts, rewardsPool3, rewardsPool4, withdraw, stake } = await loadFixture(
        deployFixture2
      )

      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[1])),
        0,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[2])),
        0,
        'userRewardPerTokenPaid incorrect'
      )

      await withdraw(1, 500)
      await stake(2, 500)

      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[1])),
        0.3,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool3.userRewardPerTokenPaid(accounts[2])),
        0.3,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[1])),
        0.1,
        'userRewardPerTokenPaid incorrect'
      )
      assert.equal(
        fromEther(await rewardsPool4.userRewardPerTokenPaid(accounts[2])),
        0.1,
        'userRewardPerTokenPaid incorrect'
      )
    })

    it('should be able to distributeTokens', async () => {
      const { accounts, controller, token1, token2, token3, token4 } = await loadFixture(
        deployFixture2
      )

      await token3.transfer(controller.target, toEther(150))
      await token4.transfer(controller.target, toEther(300))

      assert.deepEqual(
        await controller.tokenBalances(),
        [
          [token1.target, token2.target, token3.target, token4.target],
          [toEther(0), toEther(0), toEther(150), toEther(300)],
        ],
        'token balances incorrect'
      )

      await controller.distributeTokens([token3.target, token4.target])
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([0, 0, 400, 600]),
        'account-1 withdrawableRewards incorrect'
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([0, 0, 200, 300]),
        'account-2 withdrawableRewards incorrect'
      )
    })
  })

  describe('RewardsPoolTimeBased', () => {
    async function deployFixture3() {
      const fixtureRet = await deployFixture()

      await (connection as any).provider.send('evm_setIntervalMining', [0])

      const token3 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
        'Token3',
        '3',
        1000000000,
      ])) as ERC677
      await setupToken(token3, fixtureRet.accounts)

      const tbRewardsPool = (await deploy('RewardsPoolTimeBased', [
        fixtureRet.controller.target,
        token3.target,
        100,
        100000,
      ])) as RewardsPoolTimeBased

      await fixtureRet.controller.addToken(token3.target, tbRewardsPool.target)
      await token3.approve(tbRewardsPool.target, ethers.MaxUint256)

      return { ...fixtureRet, token3, tbRewardsPool }
    }

    it('depositRewards should work correctly with no previous epoch', async () => {
      const { tbRewardsPool, token3 } = await loadFixture(deployFixture3)

      await expect(tbRewardsPool.depositRewards(100000, 10)).to.be.revertedWithCustomError(
        tbRewardsPool,
        'InvalidExpiry()'
      )

      let ts = ((await ethers.provider.getBlock('latest'))?.timestamp || 0) + 1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(400))

      assert.equal(fromEther(await token3.balanceOf(tbRewardsPool.target)), 400)
      assert.equal(fromEther(await tbRewardsPool.totalRewards()), 400)
      assert.equal(fromEther(await tbRewardsPool.epochRewardsAmount()), 400)
      assert.equal(Number(await tbRewardsPool.epochDuration()), 1000)
      assert.equal(Number(await tbRewardsPool.epochExpiry()), ts + 1000)
      assert.equal(fromEther(await tbRewardsPool.rewardPerToken()), 0)
    })

    it('depositRewards should work correctly with previous completed epoch', async () => {
      const { tbRewardsPool, token3 } = await loadFixture(deployFixture3)

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))
      await time.increase(1000)
      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 500, toEther(200))

      assert.equal(fromEther(await token3.balanceOf(tbRewardsPool.target)), 800)
      assert.equal(fromEther(await tbRewardsPool.totalRewards()), 800)
      assert.equal(fromEther(await tbRewardsPool.epochRewardsAmount()), 200)
      assert.equal(Number(await tbRewardsPool.epochDuration()), 500)
      assert.equal(Number(await tbRewardsPool.epochExpiry()), ts + 500)
      assert.equal(fromEther(await tbRewardsPool.rewardPerToken()), 0.4)

      await expect(tbRewardsPool.depositRewards(ts + 499, 10)).to.be.revertedWithCustomError(
        tbRewardsPool,
        'InvalidExpiry()'
      )
    })

    it('depositRewards should work correctly with epoch in progress', async () => {
      const { tbRewardsPool, token3 } = await loadFixture(deployFixture3)

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))
      await time.increase(499)
      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 500, toEther(200))

      assert.equal(fromEther(await token3.balanceOf(tbRewardsPool.target)), 800)
      assert.equal(fromEther(await tbRewardsPool.totalRewards()), 800)
      assert.equal(fromEther(await tbRewardsPool.epochRewardsAmount()), 500)
      assert.equal(Number(await tbRewardsPool.epochDuration()), 500)
      assert.equal(Number(await tbRewardsPool.epochExpiry()), ts + 500)
      assert.equal(fromEther(await tbRewardsPool.rewardPerToken()), 0.2)

      await expect(tbRewardsPool.depositRewards(ts + 499, 10)).to.be.revertedWithCustomError(
        tbRewardsPool,
        'InvalidExpiry()'
      )
    })

    it('getRewardPerToken should work correctly', async () => {
      const { tbRewardsPool } = await loadFixture(deployFixture3)

      assert.equal(fromEther(await tbRewardsPool.getRewardPerToken()), 0)

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))

      assert.equal(fromEther(await tbRewardsPool.getRewardPerToken()), 0)

      await time.increase(500)

      assert.equal(fromEther(await tbRewardsPool.getRewardPerToken()), 0.2)

      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 500, toEther(200))

      assert.equal(fromEther(await tbRewardsPool.getRewardPerToken()), 0.2004)

      await time.increase(10000)

      assert.equal(Number(fromEther(await tbRewardsPool.getRewardPerToken()).toFixed(3)), 0.533)

      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 400, toEther(200))

      await time.increase(100)

      assert.equal(Number(fromEther(await tbRewardsPool.getRewardPerToken()).toFixed(3)), 0.567)
    })

    it('withdrawableRewards should work correctly', async () => {
      const { accounts, controller, tbRewardsPool } = await loadFixture(deployFixture3)

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r)),
        [0, 0, 0]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r)),
        [0, 0, 0]
      )

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r)),
        [0, 0, 0]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r)),
        [0, 0, 0]
      )
      await time.increase(500)

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r)),
        [0, 0, 200]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r)),
        [0, 0, 100]
      )
      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 500, toEther(200))

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r)),
        [0, 0, 200.4]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r)),
        [0, 0, 100.2]
      )
      await time.increase(10000)

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r: bigint) =>
          Number(fromEther(r).toFixed(2))
        ),
        [0, 0, 533.33]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r: bigint) =>
          Number(fromEther(r).toFixed(2))
        ),
        [0, 0, 266.67]
      )
      ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 400, toEther(200))

      await time.increase(100)

      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[1])).map((r: bigint) =>
          Number(fromEther(r).toFixed(2))
        ),
        [0, 0, 566.67]
      )
      assert.deepEqual(
        (await controller.withdrawableRewards(accounts[2])).map((r: bigint) =>
          Number(fromEther(r).toFixed(2))
        ),
        [0, 0, 283.33]
      )
    })

    it('withdrawRewards should work correctly', async () => {
      const { signers, accounts, controller, tbRewardsPool, token3 } = await loadFixture(
        deployFixture3
      )

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))
      await time.increase(1000)

      await controller.connect(signers[1]).withdrawRewards([token3.target])
      await controller.connect(signers[2]).withdrawRewards([token3.target])

      assert.equal(fromEther(await token3.balanceOf(accounts[1])), 10400)
      assert.equal(fromEther(await token3.balanceOf(accounts[2])), 10200)
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([0, 0, 0])
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([0, 0, 0])
      )
    })

    it('staking/withdrawing should update all rewards', async () => {
      const { accounts, tbRewardsPool, withdraw, stake } = await loadFixture(deployFixture3)

      let ts =
        ((await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))?.timestamp || 0) +
        1
      await tbRewardsPool.depositRewards(ts + 1000, toEther(600))
      await time.increase(1000)

      assert.equal(fromEther(await tbRewardsPool.userRewardPerTokenPaid(accounts[1])), 0)
      assert.equal(fromEther(await tbRewardsPool.userRewardPerTokenPaid(accounts[2])), 0)
      assert.equal(fromEther(await tbRewardsPool.rewardPerToken()), 0)

      await withdraw(1, 500)
      await stake(2, 500)

      assert.equal(fromEther(await tbRewardsPool.userRewardPerTokenPaid(accounts[1])), 0.4)
      assert.equal(fromEther(await tbRewardsPool.userRewardPerTokenPaid(accounts[2])), 0.4)
      assert.equal(fromEther(await tbRewardsPool.rewardPerToken()), 0.4)
    })

    it('should be able to distributeTokens', async () => {
      const { accounts, controller, token3 } = await loadFixture(deployFixture3)

      await token3.transfer(controller.target, toEther(150))

      await controller.distributeTokens([token3.target])
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[1])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([0, 0, 100])
      )
      assert.equal(
        JSON.stringify(
          (await controller.withdrawableRewards(accounts[2])).map((r: bigint) => fromEther(r))
        ),
        JSON.stringify([0, 0, 50])
      )
    })
  })
})
