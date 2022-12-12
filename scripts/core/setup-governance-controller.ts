import { Interface } from 'ethers/lib/utils'
import { GovernanceController } from '../../typechain-types'
import { getContract } from '../utils/deployment'

const feeFunctions = ['addFee(address,uint256)', 'updateFee(uint256,address,uint256)']
const upgradeFunctions = ['upgradeTo(address)', 'upgradeToAndCall(address,bytes)']
const ownableFunctions = ['transferOwnership(address)']
const vcsFunctions = [
  'migrateVaults(uint256,uint256,bytes)',
  'upgradeVaults(uint256,uint256,bytes)',
  'setMinDepositThreshold(uint256)',
  'setVaultImplementation(address)',
  ...upgradeFunctions,
  ...ownableFunctions,
  ...feeFunctions,
]

export const roles = [
  {
    name: 'DAO',
    members: ['0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'],
    contractNames: [
      'SDLToken',
      'DelegatorPool',
      'FeeCurve',
      'PoolRouter',
      'LINK_StakingPool',
      'LINK_OperatorVCS',
      'LINK_CommunityVCS',
    ],
    functions: [
      [
        'mint(address,uint256)',
        'mintToContract(address,address,uint256,bytes)',
        ...ownableFunctions,
      ],
      [
        'addToken(address,address)',
        'removeToken(address)',
        'setFeeCurve(address)',
        ...upgradeFunctions,
        ...ownableFunctions,
      ],
      ['setFeeBasisPoints(uint256)', ...ownableFunctions],
      [
        'addPool(address,address,uint256,bool)',
        'removePool(address,uint16)',
        'setPoolStatus(address,uint16,uint256)',
        'setPoolStatusClosed(address,uint16)',
        'setReservedModeActive(address,uint16,bool)',
        'setReservedSpaceMultiplier(uint256)',
        ...upgradeFunctions,
        ...ownableFunctions,
      ],
      [
        'strategyDeposit(uint256,uint256)',
        'strategyWithdraw(uint256,uint256)',
        'addStrategy(address)',
        'removeStrategy(uint256)',
        'reorderStrategies(uint256[])',
        'setLiquidityBuffer(uint256)',
        ...upgradeFunctions,
        ...ownableFunctions,
        ...feeFunctions,
      ],
      ['addVault(address)', ...vcsFunctions],
      ['setMaxDeposits(uint256)', 'setMaxVaultDeployments(uint256)', ...vcsFunctions],
    ],
  },
  {
    name: 'LinkPool',
    members: ['0x6879826450e576B401c4dDeff2B7755B1e85d97c'],
    contractNames: ['PoolRouter'],
    functions: [['setPoolStatus(address,uint16,uint256)', 'setWrappedETH(address)']],
  },
]

async function main() {
  const governanceController = (await getContract('GovernanceController')) as GovernanceController

  roles.forEach(async (role) => {
    const contracts = []
    const selectors: any = []

    for (let i = 0; i < role.contractNames.length; i++) {
      const functions = role.functions[i]
      const contract = await getContract(role.contractNames[i])
      const iface = contract.interface as Interface
      contracts.push(contract.address)
      selectors.push([])

      for (let j = 0; j < functions.length; j++) {
        selectors[i].push(iface.getSighash(functions[j]))
      }
    }

    await governanceController.addRole(role.name, role.members, contracts, selectors)
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
