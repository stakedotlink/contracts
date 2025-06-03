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
  StakingMock,
  StakingRewardsMock,
  StakingPool,
  PriorityPool,
  CommunityVCS,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
import { WithdrawalPool } from '../../typechain-types/contracts/core/test/WithdrawalPoolMock.sol'

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

function encodeVaults(vaults: number[]) {
  return ethers.AbiCoder.defaultAbiCoder().encode(['uint64[]'], [vaults])
}

describe('LINKMigrator', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    const rewardsController = (await deploy('StakingRewardsMock', [
      token.target,
    ])) as StakingRewardsMock
    const communityPool = (await deploy('StakingMock', [
      token.target,
      rewardsController.target,
      toEther(10),
      toEther(100),
      toEther(2000),
      unbondingPeriod,
      claimPeriod,
    ])) as StakingMock

    const stakingPool = (await deployUpgradeable('StakingPool', [
      token.target,
      'Staked LINK',
      'stLINK',
      [],
      toEther(10000),
    ])) as StakingPool

    const pp = (await deployUpgradeable('PriorityPool', [
      token.target,
      stakingPool.target,
      accounts[0],
      toEther(100),
      toEther(1000),
      false,
    ])) as PriorityPool

    const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
      token.target,
      stakingPool.target,
      pp.target,
      toEther(10),
      0,
    ])) as WithdrawalPool

    let vaultImplementation = await deployImplementation('CommunityVault')
    const vaultDepositController = await deploy('VaultDepositController')

    const strategy = (await deployUpgradeable(
      'CommunityVCS',
      [
        token.target,
        stakingPool.target,
        communityPool.target,
        vaultImplementation,
        [],
        10000,
        toEther(100),
        10,
        20,
        vaultDepositController.target,
      ],
      { unsafeAllow: ['delegatecall'] }
    )) as CommunityVCS

    const migrator = await deploy('LINKMigrator', [token.target, communityPool.target, pp.target])

    await pp.setWithdrawalPool(withdrawalPool.target)
    await pp.setQueueBypassController(migrator.target)
    await stakingPool.setPriorityPool(pp.target)
    await stakingPool.addStrategy(strategy.target)

    await token.transferAndCall(communityPool.target, toEther(1000), '0x')
    await token
      .connect(signers[1])
      .transferAndCall(
        pp.target,
        toEther(1500),
        ethers.AbiCoder.defaultAbiCoder().encode(['bool', 'bytes[]'], [true, [encodeVaults([])]])
      )

    return {
      signers,
      accounts,
      token,
      pp,
      stakingPool,
      migrator,
      strategy,
      communityPool,
    }
  }

  it('initiateMigration should work correctly', async () => {
    const { migrator, communityPool, accounts } = await loadFixture(deployFixture)

    await expect(migrator.initiateMigration(toEther(0))).to.be.revertedWithCustomError(
      migrator,
      'InvalidAmount()'
    )
    await expect(migrator.initiateMigration(toEther(1001))).to.be.revertedWithCustomError(
      migrator,
      'InsufficientAmountStaked()'
    )
    await expect(migrator.initiateMigration(toEther(500))).to.be.revertedWithCustomError(
      migrator,
      'TokensNotUnbonded()'
    )

    await communityPool.unbond()

    await expect(migrator.initiateMigration(toEther(500))).to.be.revertedWithCustomError(
      migrator,
      'TokensNotUnbonded()'
    )

    await time.increase(unbondingPeriod)
    await migrator.initiateMigration(toEther(500))

    assert.deepEqual(
      await migrator
        .migrations(accounts[0])
        .then((d: any) => [fromEther(d[0]), fromEther(d[1]), fromEther(d[2]), Number(d[3])]),
      [2000, 1000, 500, ((await ethers.provider.getBlock('latest')) as any).timestamp]
    )
  })

  it('onTokenTransfer should work correctly', async () => {
    const { migrator, communityPool, accounts, signers, token, stakingPool } = await loadFixture(
      deployFixture
    )

    await expect(
      migrator.onTokenTransfer(accounts[0], toEther(200), '0x')
    ).to.be.revertedWithCustomError(migrator, 'InvalidToken()')
    await expect(
      token.transferAndCall(migrator.target, toEther(0), '0x')
    ).to.be.revertedWithCustomError(migrator, 'InvalidTimestamp()')
    await expect(
      token.transferAndCall(migrator.target, toEther(200), '0x')
    ).to.be.revertedWithCustomError(migrator, 'InvalidValue()')

    await communityPool.unbond()
    await time.increase(unbondingPeriod)
    await migrator.initiateMigration(toEther(200))
    await communityPool.unstake(toEther(200))

    await expect(
      token.transferAndCall(migrator.target, toEther(100), '0x')
    ).to.be.revertedWithCustomError(migrator, 'InvalidValue()')
    await expect(
      token.transferAndCall(migrator.target, toEther(200), '0x')
    ).to.be.revertedWithCustomError(migrator, 'InvalidTimestamp()')

    await ethers.provider.send('evm_setAutomine', [false])
    await migrator.initiateMigration(toEther(300))
    await communityPool.unstake(toEther(290))

    await expect(
      token.transferAndCall(migrator.target, toEther(300), '0x')
    ).to.be.revertedWithCustomError(migrator, 'InsufficientTokensWithdrawn()')

    await communityPool.unstake(toEther(10))
    await token.transferAndCall(
      migrator.target,
      toEther(300),
      ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [[encodeVaults([])]])
    )
    await ethers.provider.send('evm_mine')

    assert.equal(fromEther(await communityPool.getStakerPrincipal(accounts[0])), 500)
    assert.equal(fromEther(await communityPool.getTotalPrincipal()), 1800)
    assert.equal(fromEther(await stakingPool.totalStaked()), 1300)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[0])), 300)
    assert.deepEqual(await migrator.migrations(accounts[0]), [0n, 0n, 0n, 0n])

    await migrator.initiateMigration(toEther(100))
    await communityPool.unstake(toEther(100))
    await token.connect(signers[1]).transferAndCall(communityPool.target, toEther(50), '0x')

    await expect(
      token.transferAndCall(migrator.target, toEther(100), '0x')
    ).to.be.revertedWithCustomError(migrator, 'InsufficientTokensWithdrawn()')

    await ethers.provider.send('evm_mine')
    await ethers.provider.send('evm_setAutomine', [true])
  })
})
