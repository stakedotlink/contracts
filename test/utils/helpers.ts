import hre, { network } from 'hardhat'
import { upgrades } from '@openzeppelin/hardhat-upgrades'
import { parseEther, formatEther } from 'ethers'

const connection = await network.connect('hardhat')
const ethers = (connection as any).ethers
const loadFixture = (connection as any).networkHelpers.loadFixture
const networkHelpers = (connection as any).networkHelpers
const upgradesApi = await upgrades(hre, connection)

export const getConnection = () => ({
  connection,
  ethers,
  loadFixture,
  networkHelpers,
  upgradesApi,
})

export const toEther = (amount: string | number) => {
  return parseEther(amount.toString())
}

export const fromEther = (amount: bigint) => {
  return Number(formatEther(amount))
}

export const deploy = async (contractName: string, args: any[] = []) => {
  return ethers.deployContract(contractName, args) as any
}

export const attach = async (contractName: string, contractAddress: string) => {
  const Contract = await ethers.getContractFactory(contractName)
  return Contract.attach(contractAddress)
}

export const deployUpgradeable = async (contractName: string, args: any[] = [], opts: any = {}) => {
  const Implementation = await ethers.getContractFactory(contractName)
  const mergedOpts = {
    ...opts,
    unsafeAllow: [...(opts.unsafeAllow ?? []), 'missing-initializer-call'],
  }
  return upgradesApi.deployProxy(Implementation, args, mergedOpts) as any
}

export const deployImplementation = async (contractName: string) => {
  const Contract = await ethers.getContractFactory(contractName)
  const implementation = await Contract.deploy()
  await implementation.waitForDeployment()
  return implementation.getAddress()
}

export const getAccounts = async () => {
  const signers = await ethers.getSigners()
  const accounts = await Promise.all(signers.map(async (signer: any) => signer.getAddress()))
  return { signers, accounts }
}

export const setupToken = async (token: any, accounts: string[], allAccounts = false) => {
  return Promise.all(
    accounts.map((account, index) =>
      token.transfer(account, toEther(index < 4 || allAccounts ? 10000 : 0))
    )
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
