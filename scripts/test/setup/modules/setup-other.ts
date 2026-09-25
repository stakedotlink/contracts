import { ethers } from 'hardhat'
import { getAccounts, toEther } from '../../../utils/helpers'
import { getContract } from '../../../utils/deployment'
import { StakingAllowance, ERC677, OperatorVCS } from '../../../../typechain-types'

export async function setupOther() {
  const linkCurvePool = await getContract('LINK_CurvePool')
  const linkToken = (await getContract('LINKToken')) as ERC677
  const sdlToken = (await getContract('SDLToken')) as StakingAllowance
  const vesting0Deprecated = await getContract('SDL_Vesting_Deprecated_NOP_0')
  const vesting1Deprecated = await getContract('SDL_Vesting_Deprecated_NOP_1')
  const vesting0 = await getContract('SDL_Vesting_NOP_0')
  const vesting1 = await getContract('SDL_Vesting_NOP_1')

  await (await linkToken.transfer(linkCurvePool.target, toEther(1000))).wait()

  await (await sdlToken.mint(vesting0Deprecated.target, toEther(900000))).wait()
  await (await sdlToken.mint(vesting1Deprecated.target, toEther(900000))).wait()

  await (await vesting0Deprecated['release(address)'](sdlToken.target)).wait()
  await (await sdlToken.mint(vesting0Deprecated.target, toEther(400000))).wait()
  await (await vesting0Deprecated.terminateVesting([sdlToken.target])).wait()
  await (await vesting1Deprecated.terminateVesting([sdlToken.target])).wait()

  await (await sdlToken.mint(vesting0.target, toEther(400000))).wait()
  await (await sdlToken.mint(vesting1.target, toEther(400000))).wait()

  // Operator rewards: vault 0 pays Operator_0 (accounts[12], the SDL_Vesting_NOP_0 beneficiary),
  // so the UI can claim and rotate the receiver from that wallet. The other vaults keep
  // accounts[0] from deploy, which gives the "not the receiver" state. Called on the vault
  // directly: once a receiver is set, only that receiver can change it.
  //
  // Keep this after every deploy in the setup: it spends a nonce of accounts[0], and anything
  // deployed later would land at a different address than the UI's testnet config expects.
  const { accounts } = await getAccounts()
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS
  const [opVault0] = await operatorVCS.getVaults()
  const vault0 = await ethers.getContractAt('OperatorVault', opVault0)
  await (await vault0.setRewardsReceiver(accounts[12])).wait()
}
