import { toEther, deploy, getAccounts, fromEther, deployUpgradeable } from '../utils/helpers'
import {
  LinearBoostController,
  RewardsPool,
  SDLPool,
  SDLVesting,
  StakingAllowance,
  ERC677,
} from '../../typechain-types'
import { assert, expect } from 'chai'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
import { ethers } from 'hardhat'

const DAY = 86400

describe('SDLVesting', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Token',
      'T',
      10000000,
    ])) as ERC677
    const token2 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Token2',
      'T2',
      10000000,
    ])) as ERC677

    const sdlToken = (await deploy('StakingAllowance', [
      'Stake Dot Link',
      'SDL',
    ])) as StakingAllowance

    const boostController = (await deploy('LinearBoostController', [
      0,
      4 * 365 * DAY,
      4,
    ])) as LinearBoostController

    const sdlPool = (await deployUpgradeable('SDLPool', [
      'Reward Escrowed SDL',
      'reSDL',
      sdlToken.target,
      boostController.target,
      ethers.ZeroAddress,
    ])) as SDLPool

    const rewardsPool = (await deploy('RewardsPool', [sdlPool.target, token.target])) as RewardsPool
    const rewardsPool2 = (await deploy('RewardsPool', [
      sdlPool.target,
      token2.target,
    ])) as RewardsPool

    const start: any = (await ethers.provider.getBlock('latest'))?.timestamp

    const vesting = (await deploy('SDLVesting', [
      sdlToken.target,
      sdlPool.target,
      accounts[0],
      accounts[1],
      start,
      10 * DAY,
      1,
    ])) as SDLVesting

    await sdlPool.addToken(token.target, rewardsPool.target)
    await sdlPool.addToken(token2.target, rewardsPool2.target)

    await sdlToken.mint(vesting.target, toEther(1000))

    return { signers, accounts, sdlToken, start, vesting, sdlPool, token, token2 }
  }

  it('vestedAmount should work correctly', async () => {
    const { start, vesting } = await loadFixture(deployFixture)

    assert.equal(fromEther(await vesting.vestedAmount(100)), 0)
    assert.equal(fromEther(await vesting.vestedAmount(start)), 0)
    assert.equal(fromEther(await vesting.vestedAmount(start + DAY)), 100)
    assert.equal(fromEther(await vesting.vestedAmount(start + 3 * DAY)), 300)
    assert.equal(fromEther(await vesting.vestedAmount(start + 10 * DAY)), 1000)
    assert.equal(fromEther(await vesting.vestedAmount(start + 30 * DAY)), 1000)

    await time.setNextBlockTimestamp(start + DAY)
    await vesting.terminateVesting()

    assert.equal(fromEther(await vesting.vestedAmount(start + 5 * DAY)), 100)
    assert.equal(fromEther(await vesting.vestedAmount(start + 30 * DAY)), 100)
  })

  it('release should work correctly', async () => {
    const { signers, accounts, start, vesting, sdlToken } = await loadFixture(deployFixture)

    await expect(vesting.release()).to.be.revertedWithCustomError(vesting, 'SenderNotAuthorized()')

    await time.setNextBlockTimestamp(start + DAY)
    await vesting.connect(signers[1]).release()

    assert.equal(fromEther(await sdlToken.balanceOf(accounts[1])), 100)
    assert.equal(fromEther(await vesting.released()), 100)
    assert.equal(fromEther(await vesting.releasable()), 0)
  })

  it('stakeReleasableTokens should work correctly', async () => {
    const { signers, accounts, start, vesting, sdlToken, sdlPool } = await loadFixture(
      deployFixture
    )

    await time.setNextBlockTimestamp(start + DAY)
    await vesting.stakeReleasableTokens()

    assert.equal(fromEther(await sdlToken.balanceOf(accounts[1])), 0)
    assert.equal(fromEther(await vesting.released()), 100)
    assert.equal(fromEther(await vesting.releasable()), 0)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(vesting.target)), 200)
    assert.deepEqual(
      (await vesting.getRESDLPositions()).map((d) => [
        fromEther(d[0]),
        fromEther(d[1]),
        Number(d[2]),
        Number(d[3]),
        Number(d[4]),
      ]),
      [
        [0, 0, 0, 0, 0],
        [100, 100, start + DAY, 365 * DAY, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ]
    )

    await vesting.connect(signers[1]).setLockTime(0)
    await time.setNextBlockTimestamp(start + 3 * DAY)
    await vesting.stakeReleasableTokens()

    assert.equal(fromEther(await sdlToken.balanceOf(accounts[1])), 0)
    assert.equal(fromEther(await vesting.released()), 300)
    assert.equal(fromEther(await vesting.releasable()), 0)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(vesting.target)), 400)
    assert.deepEqual(
      (await vesting.getRESDLPositions()).map((d) => [
        fromEther(d[0]),
        fromEther(d[1]),
        Number(d[2]),
        Number(d[3]),
        Number(d[4]),
      ]),
      [
        [200, 0, 0, 0, 0],
        [100, 100, start + DAY, 365 * DAY, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ]
    )

    await vesting.connect(signers[1]).setLockTime(1)
    await time.setNextBlockTimestamp(start + 7 * DAY)
    await vesting.stakeReleasableTokens()

    assert.equal(fromEther(await sdlToken.balanceOf(accounts[1])), 0)
    assert.equal(fromEther(await vesting.released()), 700)
    assert.equal(fromEther(await vesting.releasable()), 0)
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(vesting.target)), 1200)
    assert.deepEqual(
      (await vesting.getRESDLPositions()).map((d) => [
        fromEther(d[0]),
        fromEther(d[1]),
        Number(d[2]),
        Number(d[3]),
        Number(d[4]),
      ]),
      [
        [200, 0, 0, 0, 0],
        [500, 500, start + 7 * DAY, 365 * DAY, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ]
    )
  })

  it('should be able to terminate vesting', async () => {
    const { signers, accounts, start, vesting, sdlToken } = await loadFixture(deployFixture)

    await time.setNextBlockTimestamp(start + DAY)
    await vesting.connect(signers[1]).release()
    await time.setNextBlockTimestamp(start + 2 * DAY)
    await vesting.terminateVesting()

    await expect(vesting.terminateVesting()).to.be.revertedWithCustomError(
      vesting,
      'VestingAlreadyTerminated()'
    )

    assert.equal(fromEther(await sdlToken.balanceOf(accounts[0])), 800)
    assert.equal(fromEther(await sdlToken.balanceOf(accounts[1])), 100)
    assert.equal(fromEther(await vesting.released()), 100)
    assert.equal(fromEther(await vesting.releasable()), 100)
    assert.equal(fromEther(await vesting.vestedAmount(start + 2 * DAY)), 200)
    assert.equal(fromEther(await vesting.vestedAmount(start + 10 * DAY)), 200)
    assert.equal(fromEther(await vesting.vestedAmount(start + 30 * DAY)), 200)
  })

  it('claimRESDLRewards should work correctly', async () => {
    const { signers, accounts, start, vesting, sdlPool, token, token2 } = await loadFixture(
      deployFixture
    )

    await time.setNextBlockTimestamp(start + DAY)
    await vesting.stakeReleasableTokens()

    await token.transferAndCall(sdlPool.target, toEther(1000), '0x')
    await token2.transferAndCall(sdlPool.target, toEther(1500), '0x')

    await expect(
      vesting.claimRESDLRewards([token.target, token2.target])
    ).to.be.revertedWithCustomError(vesting, 'SenderNotAuthorized()')

    await vesting.connect(signers[1]).claimRESDLRewards([token.target, token2.target])

    assert.equal(fromEther(await token.balanceOf(accounts[1])), 1000)
    assert.equal(fromEther(await token2.balanceOf(accounts[1])), 1500)
  })

  it('withdrawRESDLPositions should work correctly', async () => {
    const { signers, accounts, start, vesting, sdlPool } = await loadFixture(deployFixture)

    await time.setNextBlockTimestamp(start + DAY)
    await vesting.stakeReleasableTokens()

    await vesting.connect(signers[1]).setLockTime(2)
    await time.setNextBlockTimestamp(start + 2 * DAY)
    await vesting.stakeReleasableTokens()

    await expect(vesting.withdrawRESDLPositions([1, 2])).to.be.revertedWithCustomError(
      vesting,
      'SenderNotAuthorized()'
    )

    await vesting.connect(signers[1]).withdrawRESDLPositions([1, 2])

    assert.deepEqual(
      (await vesting.getRESDLPositions()).map((d) => [
        fromEther(d[0]),
        fromEther(d[1]),
        Number(d[2]),
        Number(d[3]),
        Number(d[4]),
      ]),
      [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ]
    )
    assert.equal(fromEther(await sdlPool.effectiveBalanceOf(accounts[1])), 500)
    assert.deepEqual(await sdlPool.getLockIdsByOwner(accounts[1]), [1n, 2n])
  })
})
