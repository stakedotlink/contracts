import hre from 'hardhat'
import { upgrades as createUpgradesApi } from '@openzeppelin/hardhat-upgrades'

// scripts target the local node unless --network or HARDHAT_NETWORK selects another network
const connection = await hre.network.create(hre.globalOptions.network ?? 'localhost')

export const { ethers, networkName, networkHelpers, provider } = connection
export const { time, loadFixture } = networkHelpers
export const upgrades = await createUpgradesApi(hre, connection)

export const toEther = (amount: string | number) => {
  return ethers.parseEther(amount.toString())
}

export const fromEther = (amount: bigint) => {
  return Number(ethers.formatEther(amount))
}

export const getAccounts = async (): Promise<any> => {
  const signers = await ethers.getSigners()
  const accounts = await Promise.all(signers.map(async (signer) => signer.getAddress()))
  return { signers, accounts }
}

export const getLedgerSigner = async () => {
  const signers = await ethers.getSigners()
  return signers[14] || signers[0]
}

export const setupToken = async (token: any, accounts: string[]) => {
  return Promise.all(accounts.map((account) => token.transfer(account, toEther(10000))))
}
