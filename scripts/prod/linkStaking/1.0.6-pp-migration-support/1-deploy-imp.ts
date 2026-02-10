import { ethers, upgrades } from 'hardhat'
import { getContract } from '../../../utils/deployment'

async function main() {
  const priorityPool = await getContract('LINK_PriorityPool')
  const priorityPoolImp = (await upgrades.prepareUpgrade(
    priorityPool.target,
    await ethers.getContractFactory('PriorityPool'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('PriorityPool implementation deployed at: ', priorityPoolImp)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
