import { toEther, deploy, getAccounts, fromEther } from '../utils/helpers'
import { StakingAllowance, Vesting } from '../../typechain-types'
import { assert } from 'chai'

describe('Vesting', () => {
  let sdlToken: StakingAllowance
  let vesting: Vesting
  let accounts: string[]

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach(async () => {
    sdlToken = (await deploy('StakingAllowance', ['Stake Dot Link', 'SDL'])) as StakingAllowance

    vesting = (await deploy('Vesting', [
      accounts[0],
      accounts[1],
      1695312000,
      86400 * 10,
    ])) as Vesting

    await sdlToken.mint(accounts[0], toEther(1000))
    await sdlToken.transfer(vesting.address, toEther(1000))
  })

  it('vars should be correctly set', async () => {
    assert.equal(await vesting.owner(), accounts[0])
    assert.equal(await vesting.beneficiary(), accounts[1])
    assert.equal((await vesting.start()).toNumber(), 1695312000)
    assert.equal((await vesting.duration()).toNumber(), 86400 * 10)
  })

  it('should be able to terminate vesting', async () => {
    await vesting.terminateVesting([sdlToken.address])
    await vesting.releaseRemaining(sdlToken.address)
    let ownerBalance = await sdlToken.balanceOf(accounts[0])
    let beneficiaryBalance = await sdlToken.balanceOf(accounts[1])
    assert.equal(ownerBalance.lt(beneficiaryBalance), true)
    assert.equal(ownerBalance.gt(0), true)
    assert.equal(fromEther(await sdlToken.balanceOf(vesting.address)), 0)
  })
})
