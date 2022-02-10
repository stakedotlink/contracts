import { ethers } from 'hardhat'
import { assert } from 'chai'
import { ERC677 } from '../../typechain-types'

export const toEther = (amount: string) => {
  return ethers.utils.parseEther(amount).toHexString()
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

export const deploy = async (contractName: string, args: Array<any>) => {
  const Contract = await ethers.getContractFactory(contractName)
  return Contract.deploy(...args)
}

export const setupAccounts = async (token: ERC677) => {
  const signers = await ethers.getSigners()
  const accounts = await Promise.all(
    signers.map(async (signer, index) => {
      let account = await signer.getAddress()
      await token.transfer(account, toEther(index < 4 ? '10000' : '0'))
      return account
    })
  )
  return { signers, accounts }
}
