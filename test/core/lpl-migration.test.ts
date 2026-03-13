import {
  toEther,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  getConnection,
} from '../utils/helpers'
import { ERC677, StakingAllowance, LPLMigration } from '../../types/ethers-contracts'
import { assert, expect } from 'chai'

const { loadFixture } = getConnection()

describe('LPLMigration', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

    const lplToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'LinkPool',
      'LPL',
      100000000,
    ])) as ERC677
    await setupToken(lplToken, accounts)

    const sdlToken = (await deploy('StakingAllowance', [
      'Stake Dot Link',
      'SDL',
    ])) as StakingAllowance

    const lplMigration = (await deploy('LPLMigration', [
      lplToken.target,
      sdlToken.target,
    ])) as LPLMigration

    await sdlToken.mint(accounts[0], toEther(50000000))
    await sdlToken.transfer(lplMigration.target, toEther(50000000))
    await lplToken.connect(signers[1]).transferAndCall(lplMigration.target, toEther(10000), '0x')
    await lplToken.connect(signers[2]).transferAndCall(lplMigration.target, toEther(100), '0x')

    return { signers, accounts, lplToken, sdlToken, lplMigration }
  }

  it('should be able to swap LPL for SDL', async () => {
    const { accounts, lplToken, sdlToken } = await loadFixture(deployFixture)

    assert.equal(
      fromEther(await lplToken.balanceOf(accounts[1])),
      0,
      'Account-1 LPL balance should be 0'
    )
    assert.equal(
      fromEther(await sdlToken.balanceOf(accounts[1])),
      5000,
      'Account-1 SDL balance should be 5000'
    )
    assert.equal(
      fromEther(await lplToken.balanceOf(accounts[2])),
      9900,
      'Account-2 LPL balance should be 9900'
    )
    assert.equal(
      fromEther(await sdlToken.balanceOf(accounts[2])),
      50,
      'Account-2 SDL balance should be 50'
    )
  })

  it('should be correct amount of LPL and SDL in contract', async () => {
    const { lplToken, sdlToken, lplMigration } = await loadFixture(deployFixture)

    assert.equal(
      fromEther(await lplToken.balanceOf(lplMigration.target)),
      10100,
      'Should be 10100 LPL locked in migration contract'
    )
    assert.equal(
      fromEther(await sdlToken.balanceOf(lplMigration.target)),
      49994950,
      'Should be 4994950 SDL left in migration contract'
    )
  })

  it('should not be able to swap more than LPL balance', async () => {
    const { signers, lplToken, lplMigration } = await loadFixture(deployFixture)

    await expect(
      lplToken.connect(signers[2]).transferAndCall(lplMigration.target, toEther(10000), '0x')
    ).to.be.revertedWith('ERC20: transfer amount exceeds balance')
  })

  it('onTokenTransfer should only be callable by LPL token', async () => {
    const { accounts, lplMigration } = await loadFixture(deployFixture)

    await expect(lplMigration.onTokenTransfer(accounts[0], toEther(1000), '0x')).to.be.revertedWith(
      'Sender must be LPL token'
    )
  })
})
