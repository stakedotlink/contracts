import fse from 'fs-extra'
import type { UpgradeOptions } from '@openzeppelin/hardhat-upgrades'
import { ethers, getLedgerSigner, networkName as connectedNetworkName, upgrades } from './helpers'

export const deploy = async (contractName: string, args: any[] = []): Promise<any> => {
  const ledgerSigner = await getLedgerSigner()
  return (await ethers.deployContract(contractName, args, ledgerSigner)).waitForDeployment()
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
  const ledgerSigner = await getLedgerSigner()
  const Contract = await ethers.getContractFactory(contractName, ledgerSigner)
  return upgrades.deployProxy(Contract, args, withValidationOptions(options)) as any
}

export const deployImplementation = async (contractName: string, options: UpgradeOptions = {}) => {
  const ledgerSigner = await getLedgerSigner()
  const Contract = await ethers.getContractFactory(contractName, ledgerSigner)
  return upgrades.deployImplementation(Contract, withValidationOptions(options))
}

export const getDeployments = (networkName?: string) => {
  fse.ensureFileSync(`deployments/${networkName || connectedNetworkName}.json`)
  const deployments = fse.readJSONSync(`deployments/${networkName || connectedNetworkName}.json`, {
    throws: false,
  })

  if (!deployments) {
    return {}
  }

  return deployments
}

export const updateDeployments = (
  newDeployments: { [key: string]: string },
  artifactMap: { [key: string]: string } = {}
) => {
  const deployments = getDeployments()

  let contractNames = Object.keys(newDeployments)
  let newDeploymentsWithArtifacts = contractNames.reduce(
    (acc, name: string) => (
      (acc[name] = { address: newDeployments[name], artifact: artifactMap[name] || name }), acc
    ),
    {} as any
  )

  fse.outputJSONSync(
    `deployments/${connectedNetworkName}.json`,
    { ...deployments, ...newDeploymentsWithArtifacts },
    { spaces: 2 }
  )
}

export const getContract = async (contractName: string, networkName?: string): Promise<any> => {
  const deployments = getDeployments(networkName)
  const contract = deployments[contractName]

  if (!contract) {
    throw Error('Deployed contract does not exist')
  }

  const ledgerSigner = await getLedgerSigner()
  return (await ethers.getContractAt(contract.artifact, contract.address)).connect(
    ledgerSigner
  ) as any
}

export const printDeployments = () => {
  fse.ensureFileSync(`deployments/${connectedNetworkName}.json`)
  const deployments = fse.readJSONSync(`deployments/${connectedNetworkName}.json`, {
    throws: false,
  })

  if (!deployments) {
    console.log('Deployments: Nothing to print')
  }

  Object.keys(deployments).map((deploy) => {
    console.log(`Deployed: ${deploy} ${deployments[deploy].address}`)
  })

  return deployments
}
