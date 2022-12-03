import { ethers } from 'hardhat'
import { DelegatorPool, LPLMigration, StakingAllowance } from '../../typechain-types'
import { getContract } from '../utils/deployment'
import { toEther } from '../utils/helpers'

const linkPoolMintAddress = 'TODO' // LinkPool address to receive SDL
const linkPoolAmount = 33996398.04 // Amount of SDL LinkPool should receive (50M - LPL holders relative SDL amount)
const unlockedLinkPoolAmount = 343397.96 // Amount of SDL LinkPool should receive unlocked (1% of total)
const chainlinkMintAddress = 'TODO' // Chainlink address to receive SDL
const chainlinkAmount = 20000000 // Amount of SDL to be minted to Chainlink
const daoMintAddress = 'TODO' // DAO Treasury wallet to receive SDL
const daoAmount = 50000000 // Amount of SDL to be minted to the DAO
const lplMigrationAmount = 15660204 // Amount of SDL to be minted into the LPL migration contract
const lockedSDLPerOperator = 9900000 // Amount of locked SDL each operator should receive
const unlockedSDLPerOperator = 100000 //  Amount of unlocked SDL each operator should receive
const vestingStartTimeSeconds = 1685980800 // Start time of SDL vesting for operators (June 5th 2023)
const vestingDurationSeconds = 47347200 // Duration of SDL vesting for operators (18 months)
const operatorAddresses = [
  '0x20C0B7b370c97ed139aeA464205c05fCeAF4ac68',
  '0x26119F458dD1E8780554e3e517557b9d290Fb4dD',
  '0x479F6833BC5456b00276473DB1bD3Ee93ff8E3e2',
  '0xF2aD781cFf42E1f506b78553DA89090C65b1A847',
  '0xc316276f87019e5adbc3185A03e23ABF948A732D',
  '0xfAE26207ab74ee528214ee92f94427f8Cdbb6A32',
  '0x4dc81f63CB356c1420D4620414f366794072A3a8',
  '0xa0181758B14EfB2DAdfec66d58251Ae631e2B942',
  '0xcef3Da64348483c65dEC9CB1f59DdF46B0149755',
  '0xE2b7cBA5E48445f9bD17193A29D7fDEb4Effb078',
  '0x06c28eEd84E9114502d545fC5316F24DAa385c75',
  '0x6eF38c3d1D85B710A9e160aD41B912Cb8CAc2589',
  '0x3F44C324BD76E031171d6f2B87c4FeF00D4294C2',
  '0xd79576F14B711406a4D4489584121629329dFa2C',
] // list of operator addresses that should receive SDL

async function main() {
  const sdlToken = (await getContract('SDLToken')) as StakingAllowance
  const lplMigration = (await getContract('LPLMigration')) as LPLMigration
  const delegatorPool = (await getContract('DelegatorPool')) as DelegatorPool

  let tx = await sdlToken.mint(chainlinkMintAddress, toEther(chainlinkAmount))
  await tx.wait()

  tx = await sdlToken.mint(daoMintAddress, toEther(daoAmount))
  await tx.wait()

  tx = await sdlToken.mint(lplMigration.address, toEther(lplMigrationAmount))
  await tx.wait()

  tx = await sdlToken.mintToContract(
    delegatorPool.address,
    linkPoolMintAddress,
    toEther(linkPoolAmount),
    ethers.utils.defaultAbiCoder.encode(
      ['uint64', 'uint64'],
      [vestingStartTimeSeconds, vestingDurationSeconds]
    )
  )
  await tx.wait()
  tx = await sdlToken.mintToContract(
    delegatorPool.address,
    linkPoolMintAddress,
    toEther(unlockedLinkPoolAmount),
    '0x00'
  )
  await tx.wait()


  for (let i = 0; i < operatorAddresses.length; i++) {
    let address = operatorAddresses[i]
    tx = await sdlToken.mintToContract(
      delegatorPool.address,
      address,
      toEther(lockedSDLPerOperator),
      ethers.utils.defaultAbiCoder.encode(
        ['uint64', 'uint64'],
        [vestingStartTimeSeconds, vestingDurationSeconds]
      )
    )
    await tx.wait()

    tx = await sdlToken.mintToContract(
      delegatorPool.address,
      address,
      toEther(unlockedSDLPerOperator),
      '0x00'
    )
    await tx.wait()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
