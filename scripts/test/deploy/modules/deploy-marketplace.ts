import { ethers } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'
import { deploy, updateDeployments } from '../../../utils/deployment'

const VENDOR_DIR = path.resolve(__dirname, '../../../../vendor/seaport')

function loadVendoredArtifact(name: string): { abi: any[]; bytecode: string } {
  const filePath = path.join(VENDOR_DIR, `${name}.json`)
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing vendored artifact ${filePath}. Run contracts/vendor/seaport/fetch-artifacts.sh first.`
    )
  }
  const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  if (!json.abi || !json.bytecode) {
    throw new Error(`Vendored artifact ${name}.json is missing abi or bytecode`)
  }
  return json
}

async function deployVendored(name: string, args: unknown[] = []) {
  const { abi, bytecode } = loadVendoredArtifact(name)
  const signer = (await ethers.getSigners())[0]
  const factory = new ethers.ContractFactory(abi, bytecode, signer)
  const contract = await factory.deploy(...args)
  await contract.waitForDeployment()
  return contract
}

export async function deployMarketplace() {
  console.log('--- deploying marketplace contracts ---')

  const conduitController = await deployVendored('ConduitController')
  const conduitControllerAddress = await conduitController.getAddress()
  console.log('ConduitController deployed:', conduitControllerAddress)

  const seaport = await deployVendored('Seaport', [conduitControllerAddress])
  const seaportAddress = await seaport.getAddress()
  console.log('Seaport deployed:', seaportAddress)

  const mockWeth = await deploy('MockWETH', [])
  console.log('MockWETH deployed:', mockWeth.target)

  const mockUsdc = await deploy('MockUSDC', [])
  console.log('MockUSDC deployed:', mockUsdc.target)

  updateDeployments(
    {
      ConduitController: conduitControllerAddress,
      Seaport: seaportAddress,
      MockWETH: mockWeth.target,
      MockUSDC: mockUsdc.target,
    },
    {
      ConduitController: 'ConduitController',
      Seaport: 'Seaport',
      MockWETH: 'MockWETH',
      MockUSDC: 'MockUSDC',
    }
  )

  return {
    conduitControllerAddress,
    seaportAddress,
    mockWethAddress: mockWeth.target as string,
    mockUsdcAddress: mockUsdc.target as string,
  }
}
