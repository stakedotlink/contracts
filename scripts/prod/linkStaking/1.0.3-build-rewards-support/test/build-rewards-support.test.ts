import { ethers, upgrades } from 'hardhat'
import { GovernanceTimelock } from '../../../../../typechain-types'
import { deploy, deployImplementation, getContract } from '../../../../utils/deployment'
import { fromEther, getAccounts, toEther } from '../../../../utils/helpers'
import { assert } from 'chai'
import { loadFixture, reset, time } from '@nomicfoundation/hardhat-network-helpers'

const blockNumber = 22421455

const FundFlowControllerArgs = {
  linkToken: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  nonLINKRewardReceiver: '0x43975fe745cB4171E15ceEd5d8D05A3502e0e87B',
}

const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'
const delegateRegistry = '0x00000000000000447e69651d841bD8D104Bed493'

const rights = ethers.ZeroHash
const enable = true

describe('BUILD rewards support', () => {
  async function deployFixture() {
    await reset(process.env.FORK_RPC_URL, blockNumber)

    const { accounts, signers } = await getAccounts()
    const multisig = await ethers.getImpersonatedSigner(multisigAddress)
    const executor = await ethers.getImpersonatedSigner(
      '0xFFb91C736e1BCB2E06188198D70D790b25990783'
    )
    await signers[0].sendTransaction({ to: multisigAddress, value: toEther(10) })
    await signers[0].sendTransaction({ to: executor, value: toEther(10) })

    const fundFlowController = await getContract('LINK_FundFlowController', 'mainnet')
    const fundFlowControllerImp = (await upgrades.prepareUpgrade(
      fundFlowController.target,
      await ethers.getContractFactory('FundFlowController'),
      {
        kind: 'uups',
      }
    )) as string
    console.log('FundFlowController implementation deployed at: ', fundFlowControllerImp)

    const operatorVCS = await getContract('LINK_OperatorVCS', 'mainnet')
    const operatorVCSImp = (await upgrades.prepareUpgrade(
      operatorVCS.target,
      await ethers.getContractFactory('OperatorVCS'),
      {
        kind: 'uups',
        unsafeAllow: ['delegatecall'],
      }
    )) as string
    console.log('OperatorVCS implementation deployed at: ', operatorVCSImp)

    const communityVCS = await getContract('LINK_CommunityVCS', 'mainnet')
    const communityVCSImp = (await upgrades.prepareUpgrade(
      communityVCS.target,
      await ethers.getContractFactory('CommunityVCS'),
      {
        kind: 'uups',
        unsafeAllow: ['delegatecall'],
      }
    )) as string
    console.log('CommunityVCS implementation deployed at: ', communityVCSImp)

    const operatorVaultImp = (await deployImplementation('OperatorVault')) as string
    console.log('OperatorVault implementation deployed at: ', operatorVaultImp)

    const communityVaultImp = (await deployImplementation('CommunityVault')) as string
    console.log('CommunityVault implementation deployed at: ', communityVaultImp)

    const vaultInterface = (await ethers.getContractFactory('OperatorVault')).interface

    const numOperatorVaults = (await operatorVCS.getVaults()).length
    const operatorVaultsToUpgrade = [...Array(numOperatorVaults).keys()]
    const operatorVaultUpgradeData = Array(numOperatorVaults).fill(
      vaultInterface.encodeFunctionData('setDelegateRegistry', [delegateRegistry])
    )

    const numCommunityVaults = (await communityVCS.getVaults()).length
    const communityVaultsToUpgrade = [...Array(numCommunityVaults).keys()]
    const communityVaultUpgradeData = Array(numCommunityVaults).fill(
      vaultInterface.encodeFunctionData('setDelegateRegistry', [delegateRegistry])
    )

    const timelockBatch: any = [
      [
        fundFlowController.target,
        operatorVCS.target,
        operatorVCS.target,
        operatorVCS.target,
        operatorVCS.target,
        communityVCS.target,
        communityVCS.target,
        communityVCS.target,
        communityVCS.target,
      ],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [
        (
          await fundFlowController.upgradeToAndCall.populateTransaction(
            fundFlowControllerImp,
            fundFlowController.interface.encodeFunctionData('initialize', [
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              FundFlowControllerArgs.linkToken,
              FundFlowControllerArgs.nonLINKRewardReceiver,
              0,
              0,
              0,
            ])
          )
        ).data,
        (await operatorVCS.upgradeTo.populateTransaction(operatorVCSImp)).data,
        (await operatorVCS.setDelegateRegistry.populateTransaction(delegateRegistry)).data,
        (await operatorVCS.setVaultImplementation.populateTransaction(operatorVaultImp)).data,
        (
          await operatorVCS.upgradeVaults.populateTransaction(
            operatorVaultsToUpgrade,
            operatorVaultUpgradeData
          )
        ).data,
        (await communityVCS.upgradeTo.populateTransaction(communityVCSImp)).data,
        (await communityVCS.setDelegateRegistry.populateTransaction(delegateRegistry)).data,
        (await communityVCS.setVaultImplementation.populateTransaction(communityVaultImp)).data,
        (
          await communityVCS.upgradeVaults.populateTransaction(
            communityVaultsToUpgrade,
            communityVaultUpgradeData
          )
        ).data,
      ],
      ethers.ZeroHash,
      ethers.ZeroHash,
      86400,
    ]

    const timelock = (await getContract('GovernanceTimelock', 'mainnet')) as GovernanceTimelock

    await timelock.connect(multisig).scheduleBatch(...timelockBatch)
    await time.increase(86400)
    await timelock.connect(executor).executeBatch(...timelockBatch.slice(0, 5))

    return {
      signers,
      accounts,
      multisig,
      fundFlowController,
      operatorVCS,
      communityVCS,
      timelock,
      executor,
    }
  }

  it('upgrade should work', async () => {
    const { fundFlowController, operatorVCS, communityVCS } = await loadFixture(deployFixture)

    assert.equal(await fundFlowController.linkToken(), FundFlowControllerArgs.linkToken)
    assert.equal(
      await fundFlowController.nonLINKRewardReceiver(),
      FundFlowControllerArgs.nonLINKRewardReceiver
    )
    assert.equal(await operatorVCS.delegateRegistry(), delegateRegistry)
    assert.equal(await communityVCS.delegateRegistry(), delegateRegistry)

    const opVaults = await operatorVCS.getVaults()
    for (let i = 0; i < opVaults.length; i++) {
      const vault = await ethers.getContractAt('OperatorVault', opVaults[i])
      assert.equal(await vault.delegateRegistry(), delegateRegistry)
    }

    const comVaults = await communityVCS.getVaults()
    for (let i = 0; i < opVaults.length; i++) {
      const vault = await ethers.getContractAt('CommunityVault', comVaults[i])
      assert.equal(await vault.delegateRegistry(), delegateRegistry)
    }
  })

  it('should be able to delegate vaults', async () => {
    const { fundFlowController, operatorVCS, communityVCS, multisig, timelock, executor } =
      await loadFixture(deployFixture)

    const opVaults = await operatorVCS.getVaults()
    const comVaults = await communityVCS.getVaults()

    const timelockTx0: any = [
      fundFlowController.target,
      0,
      (
        await fundFlowController.delegateVaults.populateTransaction(
          [...opVaults, ...comVaults.slice(0, 65)],
          FundFlowControllerArgs.nonLINKRewardReceiver,
          rights,
          enable
        )
      ).data,
      ethers.ZeroHash,
      ethers.ZeroHash,
      86400,
    ]
    const timelockTx1: any = [
      fundFlowController.target,
      0,
      (
        await fundFlowController.delegateVaults.populateTransaction(
          [...comVaults.slice(65, 145)],
          FundFlowControllerArgs.nonLINKRewardReceiver,
          rights,
          enable
        )
      ).data,
      ethers.ZeroHash,
      ethers.ZeroHash,
      86400,
    ]
    const timelockTx2: any = [
      fundFlowController.target,
      0,
      (
        await fundFlowController.delegateVaults.populateTransaction(
          [...comVaults.slice(145)],
          FundFlowControllerArgs.nonLINKRewardReceiver,
          rights,
          enable
        )
      ).data,
      ethers.ZeroHash,
      ethers.ZeroHash,
      86400,
    ]

    await timelock.connect(multisig).schedule(...timelockTx0)
    await timelock.connect(multisig).schedule(...timelockTx1)
    await timelock.connect(multisig).schedule(...timelockTx2)

    await time.increase(86400)
    await timelock.connect(executor).execute(...timelockTx0.slice(0, 5))
    await timelock.connect(executor).execute(...timelockTx1.slice(0, 5))
    await timelock.connect(executor).execute(...timelockTx2.slice(0, 5))

    for (let i = 0; i < opVaults.length; i++) {
      let vault = await ethers.getContractAt('OperatorVault', opVaults[i])
      assert.deepEqual((await vault.getDelegations())[0].slice(0, 3), [
        1n,
        FundFlowControllerArgs.nonLINKRewardReceiver,
        opVaults[i],
      ])
    }

    for (let i = 0; i < comVaults.length; i++) {
      let vault = await ethers.getContractAt('CommunityVault', comVaults[i])
      assert.deepEqual((await vault.getDelegations())[0].slice(0, 3), [
        1n,
        FundFlowControllerArgs.nonLINKRewardReceiver,
        comVaults[i],
      ])
    }
  })
})
