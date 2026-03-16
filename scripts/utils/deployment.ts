import { Addressable } from 'ethers'
import fse from 'fs-extra'
import { getConnection, getLedgerSigner } from './helpers'

const { connection, ethers, upgradesApi } = await getConnection()

export const deploy = async (contractName: string, args: any[] = []): Promise<any> => {
  const ledgerSigner = await getLedgerSigner()
  return (await ethers.deployContract(contractName, args, ledgerSigner)).waitForDeployment()
}

export const deployUpgradeable = async (contractName: string, args: any[] = [], options = {}) => {
  const ledgerSigner = await getLedgerSigner()
  const Contract = await ethers.getContractFactory(contractName, ledgerSigner)
  return upgradesApi.deployProxy(Contract, args, { kind: 'uups', ...options }) as any
}

export const deployImplementation = async (contractName: string) => {
  const ledgerSigner = await getLedgerSigner()
  const Contract = await ethers.getContractFactory(contractName, ledgerSigner)
  return upgradesApi.deployImplementation(Contract, { kind: 'uups' })
}

export const upgradeProxy = async (
  proxyAddress: string | Addressable,
  implementationContractName: string,
  useDeployedImplementation = false,
  call?: { fn: string; args?: unknown[] } | undefined
) => {
  const ledgerSigner = await getLedgerSigner()
  const Contract = await ethers.getContractFactory(implementationContractName, ledgerSigner)
  return upgradesApi.upgradeProxy(proxyAddress, Contract, {
    useDeployedImplementation,
    call,
    kind: 'uups',
  }) as any
}

export const getDeployments = (networkName?: string) => {
  fse.ensureFileSync(`deployments/${networkName || connection.networkName}.json`)
  const deployments = fse.readJSONSync(
    `deployments/${networkName || connection.networkName}.json`,
    {
      throws: false,
    }
  )

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
    `deployments/${connection.networkName}.json`,
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
  fse.ensureFileSync(`deployments/${connection.networkName}.json`)
  const deployments = fse.readJSONSync(`deployments/${connection.networkName}.json`, {
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
