import { ethers } from 'hardhat'
import { ERC677 } from '../../typechain-types'

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

export const setupToken = async (token: any, accounts: string[]) => {
  return Promise.all(accounts.map((account) => token.transfer(account, toEther(10000))))
}
