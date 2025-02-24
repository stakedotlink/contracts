import { updateDeployments, deploy } from '../../../utils/deployment'
import { ethers } from 'hardhat'

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

const minDelay = 86400
const proposers = [multisigAddress]
const executors = [
  '0xd1243345c4c7Ff0A26aF4d291d9C058C9dF3479C',
  '0xFFb91C736e1BCB2E06188198D70D790b25990783',
  '0xCA4784Af7eBe83A7eafeFD1c8f81d00425F366D9',
  '0x055114b1019300AAB9EE87f786b8Bd50258D0bdE',
  '0xa3026c3d6c3Bd5441F53F3c6DaED2e52868C1339',
  '0x4dc81f63CB356c1420D4620414f366794072A3a8',
  '0xeCbb058Fc429941124a2b8d0984354c3132F536f',
  '0xAE398D78DAE867b1e837a512dcb6cB51235718EE',
]

async function main() {
  const governanceTimelock = await deploy('GovernanceTimelock', [
    minDelay,
    proposers,
    executors,
    ethers.ZeroAddress,
  ])
  console.log('GovernanceTimelock deployed: ', governanceTimelock.target)

  updateDeployments({
    GovernanceTimelock: governanceTimelock.target,
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
