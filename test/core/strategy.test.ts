import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
  getConnection,
} from '../utils/helpers'
import { ERC677, StrategyMock } from '../../types/ethers-contracts'

const { ethers, loadFixture, upgradesApi } = getConnection()

describe('Strategy', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    const strategy = (await deployUpgradeable('StrategyMock', [
      token.target,
      accounts[0],
      toEther(1000),
      toEther(10),
    ])) as StrategyMock

    await token.approve(strategy.target, ethers.MaxUint256)

    return { signers, accounts, token, strategy }
  }

  it('should be able to upgrade contract, state should persist', async () => {
    const { token, strategy } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(1000), '0x')

    let StrategyV2 = await ethers.getContractFactory('StrategyMockV2')
    let upgradedImpAddress = (await upgradesApi.prepareUpgrade(strategy.target, StrategyV2, {
      kind: 'uups',
      unsafeAllow: ['missing-initializer'],
    })) as string
    await strategy.upgradeTo(upgradedImpAddress)

    let upgraded = await ethers.getContractAt('StrategyMockV2', strategy.target)
    assert.equal(Number(await upgraded.contractVersion()), 2, 'contract not upgraded')
    assert.equal(fromEther(await upgraded.getTotalDeposits()), 1000, 'state not persisted')
    assert.equal(
      fromEther(await token.balanceOf(await upgraded.getAddress())),
      1000,
      'balance not persisted'
    )
  })

  it('contract should only be upgradeable by owner', async () => {
    const { signers, strategy } = await loadFixture(deployFixture)

    let StrategyV2 = await ethers.getContractFactory('StrategyMockV2')
    let upgradedImpAddress = (await upgradesApi.prepareUpgrade(strategy.target, StrategyV2, {
      kind: 'uups',
      unsafeAllow: ['missing-initializer'],
    })) as string

    await expect(strategy.connect(signers[1]).upgradeTo(upgradedImpAddress)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })
})
