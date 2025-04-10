import hre, { ethers } from 'hardhat'
import { CurveGaugeDistributor, PriorityPool, StakingPool } from '../../../../../typechain-types'
import { getContract } from '../../../../utils/deployment'
import { fromEther, getAccounts, toEther } from '../../../../utils/helpers'
import { assert } from 'chai'
import { time } from '@nomicfoundation/hardhat-network-helpers'

// Fork mainnet at block 22131113 to run test

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'
const curveStableSwapNG = '0x7E13876B92F1a62C599C231f783f682E96B91761'
const liquidityGaugeV6 = '0x985ca600257BFc1adC2b630B8A7E2110b834A20e'
const minTimeBetweenDistributions = 86400n * 7n

async function main() {
  const { signers, accounts } = await getAccounts()
  const linkHolder = await ethers.getImpersonatedSigner(
    '0x4a470942dd7A44c6574666F8BDa47ce33c19A601'
  )
  const manager = await ethers.getImpersonatedSigner('0x23c4602e63ACfe29b930c530B19d44a84AF0d767')
  const pp = (await getContract('LINK_PriorityPool')) as PriorityPool
  const linkToken = await getContract('LINKToken')
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool

  await stakingPool.connect(linkHolder).approve(pp.target, ethers.MaxUint256)
  await pp.connect(linkHolder).withdraw(toEther(1000), 0, 0, [], false, false, [])

  const gaugeDistributor = (await getContract(
    'LINK_CurveGaugeDistributor'
  )) as CurveGaugeDistributor
  const stableSwap = new ethers.Contract(curveStableSwapNG, [
    'function add_liquidity(uint256[] _amounts, uint256 _minMintAmount, address _receiver) returns (uint256)',
    'function balanceOf(address _account) view returns (uint256)',
  ]).connect(linkHolder) as any
  const liquidityGauge = new ethers.Contract(liquidityGaugeV6, [
    'function add_reward(address _token, address _distributor)',
    'function reward_data(address _token) view returns (address, address, uint256, uint256, uint256, uint256)',
  ]).connect(manager) as any

  await linkToken.connect(linkHolder).approve(stableSwap.target, ethers.MaxUint256)
  await stakingPool.connect(linkHolder).approve(stableSwap.target, ethers.MaxUint256)

  await liquidityGauge.add_reward(stableSwap.target, gaugeDistributor.target)

  await (await stableSwap.add_liquidity([toEther(1000), toEther(1000)], 0, linkHolder)).wait()

  assert.equal((await gaugeDistributor.shouldDistributeRewards())[0], false)

  await (
    await stakingPool.connect(linkHolder).transfer(gaugeDistributor.target, toEther(1000))
  ).wait()

  let ret = await gaugeDistributor.shouldDistributeRewards()
  assert.equal(ret[0], true)
  await (await gaugeDistributor.distributeRewards(ret[1])).wait()

  assert.equal(fromEther(await linkToken.balanceOf(gaugeDistributor.target)), 0)
  assert.equal(fromEther(await stakingPool.balanceOf(gaugeDistributor.target)), 0)
  assert.equal(fromEther(await stableSwap.balanceOf(gaugeDistributor.target)), 0)

  assert.equal(fromEther(await linkToken.balanceOf(stableSwap.target)), 1000)
  assert.equal(fromEther(await stakingPool.balanceOf(stableSwap.target)), 2000)
  assert.equal(await stableSwap.balanceOf(gaugeDistributor.target), 0)
  assert.equal(await stableSwap.balanceOf(liquidityGauge.target), ret[1])

  let rewardData = await liquidityGauge.reward_data(stableSwap.target)
  assert.equal(rewardData[3], ret[1] / minTimeBetweenDistributions)

  await (
    await stakingPool.connect(linkHolder).transfer(gaugeDistributor.target, toEther(500))
  ).wait()

  assert.equal((await gaugeDistributor.shouldDistributeRewards())[0], false)

  await time.increase(minTimeBetweenDistributions)

  let ret2 = await gaugeDistributor.shouldDistributeRewards()
  assert.equal(ret2[0], true)
  await (await gaugeDistributor.distributeRewards(ret2[1] - 100n)).wait()

  assert.equal(fromEther(await linkToken.balanceOf(gaugeDistributor.target)), 0)
  assert.equal(fromEther(await stakingPool.balanceOf(gaugeDistributor.target)), 0)
  assert.equal(fromEther(await stableSwap.balanceOf(gaugeDistributor.target)), 0)

  assert.equal(fromEther(await linkToken.balanceOf(stableSwap.target)), 1000)
  assert.equal(fromEther(await stakingPool.balanceOf(stableSwap.target)), 2500)
  assert.equal(await stableSwap.balanceOf(gaugeDistributor.target), 0)
  assert.closeTo(await stableSwap.balanceOf(liquidityGauge.target), (ret[1] + ret2[1]) as any, 100)

  let rewardData2 = await liquidityGauge.reward_data(stableSwap.target)
  assert.equal(rewardData2[3], ret2[1] / minTimeBetweenDistributions)

  console.log('All tests passed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
