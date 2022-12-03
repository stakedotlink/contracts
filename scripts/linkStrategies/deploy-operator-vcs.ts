import { ethers, network } from 'hardhat'
import fs from 'fs'
import { ERC677, OperatorVaultV0, OperatorVCS, StakingPool } from '../../typechain-types'
import {
  deployUpgradeable,
  deployImplementation,
  getContract,
  updateDeployments,
} from '../utils/deployment'
import { Interface } from 'ethers/lib/utils'

// Operator Vault Controller Strategy
const stakeController = '0x11187eff852069a33d102476b2E8A9cc9167dAde' // address of Chainlink staking contract
const minDepositThreshold = 1000 // minimum deposits required to initiate a deposit
const fees: any = [] // fee receivers & percentage amounts in basis points
const vaultOperatorAddresses = [
  '0xb621221D9850a93C67557F0B24b2483CAc4ce4b1',
  '0x03384EbdBA3d5D5672e8e26fa0F13DaFBCE5DaBA',
  '0x41fD547a85B1297062bcD53382D8aa65Df70be13',
  ethers.constants.AddressZero,
  '0x1f0C1Bf875dD8aA8A5241f146158ec9eBa9194B1',
  '0x58489C36ec720545af7D00F66BB78e26Da2B437D',
  '0x98DD2dC401738c956bfFeB4aB8F917B57ec950b6',
  '0xf3E40Cc653AdAB93529E889eB9395E3AA83DBfF6',
  '0xE0DC1892943346b17E17a851CF6b9081f8c60070',
  '0x8895CBD81761B8f2379347d020D42A729F334747',
  '0x3065cb429E9ABbaF0186343720fEd2991B2ee23E',
  ethers.constants.AddressZero,
  '0x4fbefaf1bff0130945c61603b97d38dd6e21f5cf',
  '0x575c93EC9990bb87B9716e5CFf7d446a0A789817',
] // list of operator addresses that correspond to each vault

async function main() {
  const linkToken = (await getContract('LINKToken')) as ERC677
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool
  const vaultInterface = (await ethers.getContractFactory('OperatorVault')).interface as Interface

  const initialVaults = JSON.parse(
    fs.readFileSync(`scripts/linkStrategies/deployedOpVaults.${network.name}.json`, {
      encoding: 'utf8',
    })
  )

  if (initialVaults.length != vaultOperatorAddresses.length) {
    throw Error('The # of vault operator addresses must equal the # of deployed operator vaults')
  }

  const vaultImpAddress = (await deployImplementation('OperatorVault')) as string

  console.log('OperatorVault implementation deployed: ', vaultImpAddress)

  const operatorVCS = (await deployUpgradeable('OperatorVCS', [
    linkToken.address,
    stakingPool.address,
    stakeController,
    vaultImpAddress,
    minDepositThreshold,
    fees,
    initialVaults,
  ])) as OperatorVCS
  await operatorVCS.deployed()

  console.log('OperatorVCS deployed: ', operatorVCS.address)

  let tx = await stakingPool.addStrategy(operatorVCS.address)
  await tx.wait()

  for (let i = 0; i < initialVaults.length; i++) {
    let vault = (await ethers.getContractAt('OperatorVaultV0', initialVaults[i])) as OperatorVaultV0
    tx = await vault.upgradeToAndCall(
      vaultImpAddress,
      vaultInterface.encodeFunctionData('initialize(address,address,address,address)', [
        linkToken.address,
        operatorVCS.address,
        stakeController,
        vaultOperatorAddresses[i],
      ])
    )
    await tx.wait()
    tx = await vault.transferOwnership(operatorVCS.address)
    await tx.wait()
  }

  console.log('All OperatorVaults have been upgraded from V0 to V1')
  console.log('All OperatorVaults have transferred ownership to OperatorVCS')

  updateDeployments({ LINK_OperatorVCS: operatorVCS.address }, { LINK_OperatorVCS: 'OperatorVCS' })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
