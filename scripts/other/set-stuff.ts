//@ts-nocheck
import { OperatorVCS, PoolRouter, StakingPool } from '../../typechain-types'
import { getContract } from '../utils/deployment'
import { toEther } from '../utils/helpers'

const operatorVCSFeeReceiver = '0xbcD10c166b83Edb0EbD05aaca5fACab9C0a307F0' // Delegator rewards pool address
const operatorVCSFeeAmount = 1000 // Fee sent to delegator rewards pool address in basis points
const operatorVCSMinDepositThreshold = 10000 // Minimum deposits required to initiate a deposit
const reservedMultiplier = 80000 // Pool router reserved multiplier in basis points
const liquidityBuffer = 500 // Staking pool liquidity buffer in basis points

async function main() {
  const operatorVCS = (await getContract('LINK_OperatorVCS')) as OperatorVCS
  const poolRouter = (await getContract('PoolRouter')) as PoolRouter
  const stakingPool = (await getContract('LINK_StakingPool')) as StakingPool

  let tx = await operatorVCS.addFee(operatorVCSFeeReceiver, operatorVCSFeeAmount)
  await tx.wait()

  tx = await operatorVCS.setMinDepositThreshold(toEther(operatorVCSMinDepositThreshold))
  await tx.wait()

  tx = await poolRouter.setReservedSpaceMultiplier(reservedMultiplier)
  await tx.wait()

  tx = await stakingPool.setLiquidityBuffer(liquidityBuffer)
  await tx.wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
