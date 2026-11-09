import { assert } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  padBytes,
  concatBytes,
  ethers,
  loadFixture,
} from '../utils/helpers'
import {
  StakingPool,
  WrappedSDToken,
  EthStakingStrategy,
  WrappedETH,
  DepositContract,
  WLOperatorController,
  NWLOperatorController,
  OperatorWhitelistMock,
  RewardsPool,
  DepositController,
} from '../../typechain-types'

const pubkeyLength = 48 * 2

const nwlOps = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96)]),
}

const wlOps = {
  keys: concatBytes([padBytes('0xc1', 48), padBytes('0xc2', 48), padBytes('0xc3', 48)]),
  signatures: concatBytes([padBytes('0xd1', 96), padBytes('0xd2', 96), padBytes('0xd3', 96)]),
}

const withdrawalCredentials = padBytes('0x12345', 32)

describe('DepositController', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

    const wETH = (await deploy('WrappedETH')) as WrappedETH

    const stakingPool = (await deployUpgradeable('StakingPool', [
      wETH.target,
      'LinkPool ETH',
      'lplETH',
      [],
      toEther(10000),
    ])) as StakingPool

    const wsdToken = (await deploy('WrappedSDToken', [
      stakingPool.target,
      'Wrapped LinkPool ETH',
      'wlplETH',
    ])) as WrappedSDToken

    const depositContract = (await deploy('DepositContract')) as DepositContract

    const strategy = (await deployUpgradeable('EthStakingStrategy', [
      wETH.target,
      stakingPool.target,
      toEther(1000),
      toEther(10),
      depositContract.target,
      withdrawalCredentials,
      1000,
    ])) as EthStakingStrategy

    await strategy.setBeaconOracle(accounts[0])

    const nwlOperatorController = (await deployUpgradeable('NWLOperatorController', [
      strategy.target,
      wsdToken.target,
    ])) as NWLOperatorController

    await nwlOperatorController.setKeyValidationOracle(accounts[0])
    await nwlOperatorController.setBeaconOracle(accounts[0])

    let operatorWhitelist = (await deploy('OperatorWhitelistMock', [
      [accounts[0]],
    ])) as OperatorWhitelistMock
    const wlOperatorController = (await deployUpgradeable('WLOperatorController', [
      strategy.target,
      wsdToken.target,
      await operatorWhitelist.getAddress(),
      2,
    ])) as WLOperatorController

    await wlOperatorController.setKeyValidationOracle(accounts[0])
    await wlOperatorController.setBeaconOracle(accounts[0])

    const nwlRewardsPool = (await deploy('RewardsPool', [
      nwlOperatorController.target,
      wsdToken.target,
    ])) as RewardsPool

    const wlRewardsPool = (await deploy('RewardsPool', [
      wlOperatorController.target,
      wsdToken.target,
    ])) as RewardsPool

    await nwlOperatorController.setRewardsPool(nwlRewardsPool.target)
    await wlOperatorController.setRewardsPool(wlRewardsPool.target)

    for (let i = 0; i < 5; i++) {
      await nwlOperatorController.addOperator('test')
      await nwlOperatorController.addKeyPairs(i, 2, nwlOps.keys, nwlOps.signatures, {
        value: toEther(16 * 2),
      })
      await wlOperatorController.addOperator('test')
      await wlOperatorController.addKeyPairs(i, 3, wlOps.keys, wlOps.signatures)

      if (i % 3 == 0) {
        await nwlOperatorController.initiateKeyPairValidation(accounts[0], i)
        await nwlOperatorController.reportKeyPairValidation(i, true)
        await wlOperatorController.initiateKeyPairValidation(accounts[0], i)
        await wlOperatorController.reportKeyPairValidation(i, true)
      }
    }

    const depositController = (await deploy('DepositController', [
      depositContract.target,
      strategy.target,
      nwlOperatorController.target,
      wlOperatorController.target,
    ])) as DepositController

    await strategy.setNWLOperatorController(nwlOperatorController.target)
    await strategy.setWLOperatorController(wlOperatorController.target)
    await strategy.setDepositController(depositController.target)
    await stakingPool.addStrategy(strategy.target)
    await stakingPool.setPriorityPool(accounts[0])
    await wETH.approve(stakingPool.target, ethers.MaxUint256)

    return {
      signers,
      accounts,
      wETH,
      stakingPool,
      wsdToken,
      depositContract,
      strategy,
      nwlOperatorController,
      wlOperatorController,
      nwlRewardsPool,
      wlRewardsPool,
      depositController,
    }
  }

  it('getNextValidators should work correctly', async () => {
    const { depositController, nwlOperatorController, wlOperatorController, depositContract } =
      await loadFixture(deployFixture)

    let [
      depositRoot,
      nwlStateHash,
      wlStateHash,
      nwlTotalValidatorCount,
      wlTotalValidatorCount,
      wlOperatorIds,
      wlValidatorCounts,
      nwlKeys,
      wlKeys,
    ] = await depositController.getNextValidators(7)

    assert.equal(depositRoot, await depositContract.get_deposit_root(), 'depositRoot incorrect')
    assert.equal(
      nwlStateHash,
      await nwlOperatorController.currentStateHash(),
      'nwlStateHash incorrect'
    )
    assert.equal(
      wlStateHash,
      await wlOperatorController.currentStateHash(),
      'wlStateHash incorrect'
    )
    assert.equal(Number(nwlTotalValidatorCount), 4, 'nwlTotalValidatorCount incorrect')
    assert.equal(Number(wlTotalValidatorCount), 2, 'wlTotalValidatorCount incorrect')
    assert.deepEqual(
      wlOperatorIds.map((id) => Number(id)),
      [0],
      'wlOperatorIds incorrect'
    )
    assert.deepEqual(
      wlValidatorCounts.map((count) => Number(count)),
      [2],
      'wlValidatorCounts incorrect'
    )
    assert.equal(nwlKeys, nwlOps.keys + nwlOps.keys.slice(2), 'nwlKeys incorrect')
    assert.equal(wlKeys, wlOps.keys.slice(0, 2 * pubkeyLength + 2), 'wlKeys incorrect')
  })

  // it('depositEther should work correctly', async () => {
  //   const {
  //     signers,
  //     accounts,
  //     depositController,
  //     nwlOperatorController,
  //     wlOperatorController,
  //     depositContract,
  //     wETH,
  //     stakingPool,
  //   } = await loadFixture(deployFixture)

  //   type DepositData = [string, string, string, number, number, number[], number[]]
  //   await wETH.wrap({ value: toEther(1000) })
  //   await stakingPool.deposit(accounts[0], toEther(1000), ['0x'])

  //   let depositData = (await depositController.getNextValidators(1)).slice(0, -2) as DepositData
  //   await expect(
  //     depositController.connect(signers[1]).depositEther(...depositData)
  //   ).to.be.revertedWith('Ownable: caller is not the owner')

  //   console.log(depositData)

  //   await depositController.depositEther(...depositData)
  //   await expect(depositController.depositEther(...depositData)).to.be.revertedWith(
  //     'depositRoot has changed'
  //   )

  //   depositData = (await depositController.getNextValidators(7)).slice(0, -2) as DepositData
  //   await nwlOperatorController.addKeyPairs(0, 2, nwlOps.keys, nwlOps.signatures, {
  //     value: toEther(16 * 2),
  //   })
  //   console.log(depositData)
  //   await expect(depositController.depositEther(...depositData)).to.be.revertedWith(
  //     'nwlStateHash has changed'
  //   )

  //   depositData = (await depositController.getNextValidators(7)).slice(0, -2) as DepositData
  //   await wlOperatorController.addKeyPairs(0, 3, wlOps.keys, wlOps.signatures)
  //   await expect(depositController.depositEther(...depositData)).to.be.revertedWith(
  //     'wlStateHash has changed'
  //   )

  //   depositData = (await depositController.getNextValidators(7)).slice(0, -2) as DepositData
  //   await depositController.depositEther(...depositData)

  //   assert.equal(await depositContract.get_deposit_count(), '0x0800000000000000')
  // })
})
