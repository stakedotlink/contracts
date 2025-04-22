import { ethers } from 'hardhat'
import { CurveGaugeDistributor, PriorityPool, StakingPool } from '../../../../../typechain-types'
import { deploy, getContract } from '../../../../utils/deployment'
import { fromEther, getAccounts, toEther } from '../../../../utils/helpers'
import { assert } from 'chai'
import { loadFixture, reset, time } from '@nomicfoundation/hardhat-network-helpers'

const blockNumber = 22131113

const curveStableSwapNG = '0x7E13876B92F1a62C599C231f783f682E96B91761'
const liquidityGaugeV6 = '0x985ca600257BFc1adC2b630B8A7E2110b834A20e'
const minTimeBetweenDistributions = 86400n * 7n

describe('CurveGaugeDistributor stLINK/LINK integration', () => {
  async function deployFixture() {
    await reset(process.env.FORK_RPC_URL, blockNumber)

    const { accounts, signers } = await getAccounts()
    const linkHolder = await ethers.getImpersonatedSigner(
      '0x4a470942dd7A44c6574666F8BDa47ce33c19A601'
    )
    const manager = await ethers.getImpersonatedSigner('0x23c4602e63ACfe29b930c530B19d44a84AF0d767')

    const pp = (await getContract('LINK_PriorityPool', 'mainnet')) as PriorityPool
    const linkToken = await getContract('LINKToken', 'mainnet')
    const stakingPool = (await getContract('LINK_StakingPool', 'mainnet')) as StakingPool

    const gaugeDistributor = (await deploy('CurveGaugeDistributor', [
      stakingPool.target,
      curveStableSwapNG,
      liquidityGaugeV6,
      accounts[0],
      minTimeBetweenDistributions,
    ])) as CurveGaugeDistributor

    const stableSwap = new ethers.Contract(curveStableSwapNG, [
      'function add_liquidity(uint256[] _amounts, uint256 _minMintAmount) returns (uint256)',
      'function balanceOf(address _account) view returns (uint256)',
      'function approve(address _spender, uint256 _amount)',
    ]).connect(linkHolder) as any
    const liquidityGauge = new ethers.Contract(liquidityGaugeV6, [
      'function add_reward(address _token, address _distributor)',
      'function reward_data(address _token) view returns (address, address, uint256, uint256, uint256, uint256)',
      'function deposit(uint256 _value)',
      'function withdraw(uint256 _value)',
      'function balanceOf(address _account) view returns (uint256)',
      'function claim_rewards()',
    ]).connect(manager) as any

    await liquidityGauge.add_reward(stableSwap.target, gaugeDistributor.target)
    await stakingPool.connect(linkHolder).approve(pp.target, ethers.MaxUint256)
    await pp.connect(linkHolder).withdraw(toEther(1000), 0, 0, [], false, false, [])

    for (let i = 0; i < 3; i++) {
      await linkToken.connect(linkHolder).transfer(accounts[i], toEther(250))
      await stakingPool.connect(linkHolder).transfer(accounts[i], toEther(250))
      await linkToken.connect(signers[i]).approve(stableSwap.target, ethers.MaxUint256)
      await stakingPool.connect(signers[i]).approve(stableSwap.target, ethers.MaxUint256)
      await stableSwap.connect(signers[i]).approve(liquidityGauge.target, ethers.MaxUint256)
    }

    return {
      stableSwap,
      liquidityGauge,
      signers,
      accounts,
      gaugeDistributor,
      stakingPool,
      linkToken,
      linkHolder,
    }
  }

  it('should work with existing liquidity providers (differing LP amounts)', async () => {
    const {
      stableSwap,
      liquidityGauge,
      signers,
      accounts,
      gaugeDistributor,
      stakingPool,
      linkToken,
      linkHolder,
    } = await loadFixture(deployFixture)

    for (let i = 0; i < 3; i++) {
      await stableSwap
        .connect(signers[i])
        .add_liquidity([toEther(i * 100 + 10), toEther(i * 100 + 10)], 0)
      await liquidityGauge.connect(signers[i]).deposit(toEther(i * 100 + 10))
    }

    assert.equal((await gaugeDistributor.shouldDistributeRewards())[0], false)

    await stakingPool
      .connect(linkHolder)
      .transferAndCall(gaugeDistributor.target, toEther(1000), '0x')

    let ret = await gaugeDistributor.shouldDistributeRewards()
    assert.equal(ret[0], true)
    await gaugeDistributor.distributeRewards(ret[1] - 100n)

    assert.equal(fromEther(await linkToken.balanceOf(gaugeDistributor.target)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(gaugeDistributor.target)), 0)
    assert.equal(fromEther(await stableSwap.balanceOf(gaugeDistributor.target)), 0)

    assert.equal(fromEther(await linkToken.balanceOf(stableSwap.target)), 330)
    assert.closeTo(fromEther(await stakingPool.balanceOf(stableSwap.target)), 1330, 1)
    assert.closeTo(
      await stableSwap.balanceOf(liquidityGauge.target),
      (ret[1] + toEther(330)) as any,
      10
    )

    let rewardData = await liquidityGauge.reward_data(stableSwap.target)
    assert.equal(rewardData[3], ret[1] / minTimeBetweenDistributions)

    await stakingPool.connect(linkHolder).transfer(gaugeDistributor.target, toEther(500))

    assert.equal((await gaugeDistributor.shouldDistributeRewards())[0], false)

    await time.increase(86400)

    for (let i = 0; i < 3; i++) {
      assert.equal(await liquidityGauge.balanceOf(accounts[i]), toEther(i * 100 + 10))
    }

    await time.increase(minTimeBetweenDistributions)

    let ret2 = await gaugeDistributor.shouldDistributeRewards()
    assert.equal(ret2[0], true)
    await gaugeDistributor.distributeRewards(ret2[1] - 100n)

    assert.equal(fromEther(await linkToken.balanceOf(gaugeDistributor.target)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(gaugeDistributor.target)), 0)
    assert.equal(fromEther(await stableSwap.balanceOf(gaugeDistributor.target)), 0)

    assert.equal(fromEther(await linkToken.balanceOf(stableSwap.target)), 330)
    assert.equal(fromEther(await stakingPool.balanceOf(stableSwap.target)), 1830)
    assert.closeTo(
      await stableSwap.balanceOf(liquidityGauge.target),
      (ret[1] + ret2[1] + toEther(330)) as any,
      10
    )

    let rewardData2 = await liquidityGauge.reward_data(stableSwap.target)
    assert.equal(rewardData2[3], ret2[1] / minTimeBetweenDistributions)

    await time.increase(minTimeBetweenDistributions)

    for (let i = 0; i < 3; i++) {
      await liquidityGauge.connect(signers[i]).claim_rewards()
    }

    assert.closeTo(await stableSwap.balanceOf(liquidityGauge.target), toEther(330) as any, 1000000)

    for (let i = 0; i < 3; i++) {
      assert.equal(await liquidityGauge.balanceOf(accounts[i]), toEther(i * 100 + 10))
      await liquidityGauge.connect(signers[i]).withdraw(toEther(i * 100 + 10))
    }
  })

  it('should work with existing liquidity providers (same LP amounts)', async () => {
    const {
      stableSwap,
      liquidityGauge,
      signers,
      accounts,
      gaugeDistributor,
      stakingPool,
      linkToken,
      linkHolder,
    } = await loadFixture(deployFixture)

    for (let i = 0; i < 3; i++) {
      await stableSwap.connect(signers[i]).add_liquidity([toEther(100), toEther(100)], 0)
      await liquidityGauge.connect(signers[i]).deposit(toEther(100))
    }

    assert.equal((await gaugeDistributor.shouldDistributeRewards())[0], false)

    await stakingPool
      .connect(linkHolder)
      .transferAndCall(gaugeDistributor.target, toEther(1000), '0x')

    let ret = await gaugeDistributor.shouldDistributeRewards()
    assert.equal(ret[0], true)
    await gaugeDistributor.distributeRewards(ret[1] - 100n)

    assert.equal(fromEther(await linkToken.balanceOf(gaugeDistributor.target)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(gaugeDistributor.target)), 0)
    assert.equal(fromEther(await stableSwap.balanceOf(gaugeDistributor.target)), 0)

    assert.equal(fromEther(await linkToken.balanceOf(stableSwap.target)), 300)
    assert.closeTo(fromEther(await stakingPool.balanceOf(stableSwap.target)), 1300, 1)
    assert.closeTo(
      await stableSwap.balanceOf(liquidityGauge.target),
      (ret[1] + toEther(300)) as any,
      10
    )

    let rewardData = await liquidityGauge.reward_data(stableSwap.target)
    assert.equal(rewardData[3], ret[1] / minTimeBetweenDistributions)

    await stakingPool.connect(linkHolder).transfer(gaugeDistributor.target, toEther(500))

    assert.equal((await gaugeDistributor.shouldDistributeRewards())[0], false)

    await time.increase(86400)

    for (let i = 0; i < 3; i++) {
      assert.equal(await liquidityGauge.balanceOf(accounts[i]), toEther(100))
    }

    await time.increase(minTimeBetweenDistributions)

    let ret2 = await gaugeDistributor.shouldDistributeRewards()
    assert.equal(ret2[0], true)
    await gaugeDistributor.distributeRewards(ret2[1] - 100n)

    assert.equal(fromEther(await linkToken.balanceOf(gaugeDistributor.target)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(gaugeDistributor.target)), 0)
    assert.equal(fromEther(await stableSwap.balanceOf(gaugeDistributor.target)), 0)

    assert.equal(fromEther(await linkToken.balanceOf(stableSwap.target)), 300)
    assert.equal(fromEther(await stakingPool.balanceOf(stableSwap.target)), 1800)
    assert.closeTo(
      await stableSwap.balanceOf(liquidityGauge.target),
      (ret[1] + ret2[1] + toEther(300)) as any,
      10
    )

    let rewardData2 = await liquidityGauge.reward_data(stableSwap.target)
    assert.equal(rewardData2[3], ret2[1] / minTimeBetweenDistributions)

    await time.increase(minTimeBetweenDistributions)

    for (let i = 0; i < 3; i++) {
      await liquidityGauge.connect(signers[i]).claim_rewards()
    }

    assert.closeTo(await stableSwap.balanceOf(liquidityGauge.target), toEther(300) as any, 1000000)

    for (let i = 0; i < 3; i++) {
      assert.equal(await liquidityGauge.balanceOf(accounts[i]), toEther(100))
      await liquidityGauge.connect(signers[i]).withdraw(toEther(100))
    }
  })
})
