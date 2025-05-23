import { Addressable, Contract } from 'ethers'
import fse from 'fs-extra'
import { ethers, upgrades, network } from 'hardhat'

export const deploy = async (contractName: string, args: any[] = []) => {
  return ethers.deployContract(contractName, args) as any
}

export const deployUpgradeable = async (contractName: string, args: any[] = [], options = {}) => {
  const Contract = await ethers.getContractFactory(contractName)
  return upgrades.deployProxy(Contract, args, { kind: 'uups', ...options }) as any
}

export const deployImplementation = async (contractName: string) => {
  const Contract = await ethers.getContractFactory(contractName)
  return upgrades.deployImplementation(Contract, { kind: 'uups' })
}

export const upgradeProxy = async (
  proxyAddress: string | Addressable,
  implementationContractName: string,
  useDeployedImplementation = false,
  call?: { fn: string; args?: unknown[] } | undefined
) => {
  const Contract = await ethers.getContractFactory(implementationContractName)
  const contract = await upgrades.upgradeProxy(proxyAddress, Contract, {
    useDeployedImplementation,
    call,
    kind: 'uups',
  })
  await contract.deployed()
  return contract
}

export const getDeployments = (networkName?: string) => {
  fse.ensureFileSync(`deployments/${networkName || network.name}.json`)
  const deployments = fse.readJSONSync(`deployments/${networkName || network.name}.json`, {
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
    `deployments/${network.name}.json`,
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

  return ethers.getContractAt(contract.artifact, contract.address) as any
}

export const printDeployments = () => {
  fse.ensureFileSync(`deployments/${network.name}.json`)
  const deployments = fse.readJSONSync(`deployments/${network.name}.json`, { throws: false })

  if (!deployments) {
    console.log('Deployments: Nothing to print')
  }

  Object.keys(deployments).map((deploy) => {
    console.log(`Deployed: ${deploy} ${deployments[deploy].address}`)
  })

  return deployments
}
