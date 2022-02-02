import { ethers } from 'hardhat'
import { assert } from 'chai'

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
