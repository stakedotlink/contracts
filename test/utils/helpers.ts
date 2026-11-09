import hre from 'hardhat'
import { upgrades as createUpgradesApi, type UpgradeOptions } from '@openzeppelin/hardhat-upgrades'

// one connection shared by every test file, so helpers, fixtures and tests run on the same chain
const connection = await hre.network.create()

export const { ethers, networkHelpers } = connection
export const { time } = networkHelpers
export const loadFixture = networkHelpers.loadFixture.bind(networkHelpers)
export const mineUpTo = networkHelpers.mineUpTo.bind(networkHelpers)
export const upgrades = await createUpgradesApi(hre, connection)

export const toEther = (amount: string | number) => {
  return ethers.parseEther(amount.toString())
}

export const fromEther = (amount: bigint) => {
  return Number(ethers.formatEther(amount))
}

export const deploy = async (contractName: string, args: any[] = []) => {
  return ethers.deployContract(contractName, args) as any
}

// several initializers are reinitializer(N) functions that call parent initializers inside an
// if-branch (fresh deploy vs. migration), which the OZ validator can't see
const withValidationOptions = (options: UpgradeOptions): UpgradeOptions => ({
  kind: 'uups',
  ...options,
  unsafeAllow: ['missing-initializer-call', ...(options.unsafeAllow ?? [])],
})

export const deployUpgradeable = async (
  contractName: string,
  args: any[] = [],
  options: UpgradeOptions = {}
) => {
  const Contract = await ethers.getContractFactory(contractName)
  return upgrades.deployProxy(Contract, args, withValidationOptions(options)) as any
}

export const deployImplementation = async (contractName: string, options: UpgradeOptions = {}) => {
  const Contract = await ethers.getContractFactory(contractName)
  return upgrades.deployImplementation(Contract, withValidationOptions(options))
}

export const getAccounts = async () => {
  const signers = await ethers.getSigners()
  const accounts = await Promise.all(signers.map(async (signer) => signer.getAddress()))
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
