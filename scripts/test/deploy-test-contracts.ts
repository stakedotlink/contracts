import { network } from 'hardhat'
import { updateDeployments, deploy } from '../utils/deployment'
import { getAccounts, toEther } from '../utils/helpers'

async function main() {
  if (network.name != 'localhost' && network.name != 'testnet') {
    throw Error('Test contracts can only be deployed on test networks')
  }

  const { accounts } = await getAccounts()

  const lplToken = await deploy('ERC677', ['LinkPool', 'LPL', 100000000])
  console.log('LPLToken deployed: ', lplToken.address)

  const linkToken = await deploy('ERC677', ['Chainlink', 'LINK', 1000000000])
  console.log('LINKToken deployed: ', linkToken.address)

  const multicall = await deploy('Multicall3', [])
  console.log('Multicall3 deployed: ', multicall.address)

  const poolOwners = await deploy('PoolOwnersV1', [lplToken.address])
  console.log('PoolOwners (v1) deployed: ', poolOwners.address)

  const ownersRewardsPoolV1 = await deploy('OwnersRewardsPoolV1', [
    poolOwners.address,
    linkToken.address,
    'LinkPool Owners LINK',
    'lpoLINK',
  ])
  console.log('LINK OwnersRewardsPool (v1) deployed: ', ownersRewardsPoolV1.address)

  const poolAllowance = await deploy('PoolAllowanceV1', [
    'LINK LinkPool Allowance',
    'linkLPLA',
    poolOwners.address,
  ])
  console.log('PoolAllowance (v1) deployed: ', multicall.address)

  let tx = await poolOwners.addRewardToken(
    linkToken.address,
    poolAllowance.address,
    ownersRewardsPoolV1.address
  )
  await tx.wait()

  // ETH Staking
  const stETHToken = await deploy('ERC677', ['Lido Staked ETH', 'stETH', 1000000000])
  const rETHToken = await deploy('ERC677', ['RocketPool rETH', 'rETH', 1000000000])

  const lidoWQERC721 = await deploy('LidoWQERC721Mock', [
    [
      [toEther(1), 0, accounts[0], 0, true, false],
      [toEther(3), 0, accounts[1], 0, true, false],
      [toEther(5), 0, accounts[0], 0, true, false],
      [toEther(7), 0, accounts[1], 0, false, false],
      [toEther(8), 0, accounts[2], 0, false, false],
      [toEther(10), 0, accounts[3], 0, false, false],
    ],
    stETHToken.address,
  ])
  console.log('lidoWQERC721 deployed: ', stETHToken.address)

  const stETHCurvePool = await deploy('CurvePoolMock', [toEther(5)])
  console.log('stETH_CurvePool deployed: ', stETHCurvePool.address)

  updateDeployments(
    {
      LPLToken: lplToken.address,
      LINKToken: linkToken.address,
      PoolOwnersV1: poolOwners.address,
      LINK_OwnersRewardsPoolV1: ownersRewardsPoolV1.address,
      PoolAllowanceV1: poolAllowance.address,
      Multicall3: multicall.address,
      stETHToken: stETHToken.address,
      rETHToken: rETHToken.address,
      LidoWQERC721: lidoWQERC721.address,
      stETH_CurvePool: stETHCurvePool.address,
    },
    {
      LPLToken: 'ERC677',
      LINKToken: 'ERC677',
      LINK_OwnersRewardsPoolV1: 'OwnersRewardsPoolV1',
      rETHToken: 'ERC677',
      stETHToken: 'ERC677',
      stETH_CurvePool: 'CurvePoolMock',
      LidoWQERC721: 'LidoWQERC721Mock',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
