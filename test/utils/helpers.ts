import { ethers, upgrades } from 'hardhat'
import { assert } from 'chai'
import { BigNumber } from 'ethers'
import { ERC677 } from '../../typechain-types'

export const toEther = (amount: string | number) => {
  return ethers.utils.parseEther(amount.toString()).toHexString()
}

export const fromEther = (amount: BigNumber) => {
  return Number(ethers.utils.formatEther(amount))
}

export const assertThrowsAsync = async (fn: Function, regExp: string) => {
  let f = () => {}
  try {
    await fn()
  } catch (e) {
    f = () => {
      throw e
    }
  } finally {
    assert.throws(f, regExp)
  }
}

export const deploy = async (contractName: string, args: any[] = []) => {
  const Contract = await ethers.getContractFactory(contractName)
  return Contract.deploy(...args)
}

export const attach = async (contractName: string, contractAddress: string) => {
  const Contract = await ethers.getContractFactory(contractName)
  return Contract.attach(contractAddress)
}

export const deployUpgradeable = async (contractName: string, args: any[] = []) => {
  const Contract = await ethers.getContractFactory(contractName)
  return upgrades.deployProxy(Contract, args, { kind: 'uups' })
}

export const getAccounts = async () => {
  const signers = await ethers.getSigners()
  const accounts = await Promise.all(signers.map(async (signer) => signer.getAddress()))
  return { signers, accounts }
}

export const setupToken = async (token: ERC677, accounts: string[]) => {
  return Promise.all(
    accounts.map((account, index) => token.transfer(account, toEther(index < 4 ? 10000 : 0)))
  )
}

export const padBytes = (value: string, bytesLength: number) => {
  const toPad = bytesLength * 2 + 2 - value.length
  if (toPad == 0) {
    return value
  }
  return '0x' + '0'.repeat(toPad) + value.substring(2)
}

export const concatBytes = (values: string[]) => {
  return values.reduce((res, curr) => (res += curr.substring(2)), '0x')
}
