import hre from 'hardhat'
import { upgrades as createUpgradesApi } from '@openzeppelin/hardhat-upgrades'
import axios from 'axios'

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

export const switchNetwork = async (chainId: number, host: string): Promise<void> => {
  const chainIdHex = `0x${chainId.toString(16)}`
  const params = [
    {
      chainId: chainIdHex,
    },
  ]

  try {
    const response = await axios.post(`http://${host}:1248`, {
      jsonrpc: '2.0',
      method: 'wallet_switchEthereumChain',
      params: params,
      id: 1,
    })

    if (response.status !== 200) {
      throw new Error(`Failed to switch network: ${response.statusText}`)
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorText = error.response?.data || error.message
      throw new Error(`Failed to switch network: ${errorText}`)
    } else {
      throw error
    }
  }
}
