import { ethers } from 'hardhat'
import { assert } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import { ERC677, CommunityVault, StakingMock } from '../../typechain-types'

describe('CommunityVault', () => {
  let token: ERC677
  let staking: StakingMock
  let vault: CommunityVault
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    token = (await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])) as ERC677
    await setupToken(token, accounts)

    staking = (await deploy('StakingMock', [token.address])) as StakingMock

    vault = (await deployUpgradeable('CommunityVault', [
      token.address,
      accounts[0],
      staking.address,
    ])) as CommunityVault

    await token.approve(vault.address, ethers.constants.MaxUint256)
    await vault.deposit(toEther(1000))
  })

  it('getTotalDeposits should work correctly', async () => {
    assert.equal(fromEther(await vault.getTotalDeposits()), 1000)
    await staking.setBaseReward(toEther(10))
    assert.equal(fromEther(await vault.getTotalDeposits()), 1010)
    await staking.setDelegationReward(toEther(5))
    assert.equal(fromEther(await vault.getTotalDeposits()), 1010)
  })
})
