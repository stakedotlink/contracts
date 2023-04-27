import { assert, expect } from 'chai'
import {
  deploy,
  padBytes,
  concatBytes,
  getAccounts,
  toEther,
  fromEther,
  deployUpgradeable,
} from '../utils/helpers'
import {
  ERC677,
  OperatorWhitelistMock,
  RewardsPool,
  WLOperatorController,
} from '../../typechain-types'
import { Signer } from 'ethers'
import { ethers } from 'hardhat'

const pubkeyLength = 48 * 2
const signatureLength = 96 * 2

const keyPairs = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48), padBytes('0xa3', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96), padBytes('0xb3', 96)]),
}

describe('WLOperatorController', () => {
  let controller: WLOperatorController
  let rewardsPool: RewardsPool
  let wsdToken: ERC677
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    let operatorWhitelist = (await deploy('OperatorWhitelistMock', [
      [accounts[0]],
    ])) as OperatorWhitelistMock
    wsdToken = (await deploy('ERC677', ['test', 'test', 100000])) as ERC677
    controller = (await deployUpgradeable('WLOperatorController', [
      accounts[0],
      wsdToken.address,
      operatorWhitelist.address,
      2,
    ])) as WLOperatorController
    rewardsPool = (await deploy('RewardsPool', [
      controller.address,
      wsdToken.address,
    ])) as RewardsPool

    await controller.setRewardsPool(rewardsPool.address)
    await controller.setKeyValidationOracle(accounts[0])
    await controller.setBeaconOracle(accounts[0])

    for (let i = 0; i < 5; i++) {
      await controller.addOperator('test')
      await controller.addKeyPairs(i, 3, keyPairs.keys, keyPairs.signatures)
      if (i % 2 == 0) {
        await controller.initiateKeyPairValidation(accounts[0], i)
        await controller.reportKeyPairValidation(i, true)
      }
    }
  })

  it('addOperator should work correctly', async () => {
    await controller.addOperator('Testing123')
    let op = (await controller.getOperators([5]))[0]

    assert.equal(op[0], 'Testing123', 'operator name incorrect')
    assert.equal(op[1], accounts[0], 'operator owner incorrect')
    assert.equal(op[2], true, 'operator active incorrect')
    assert.equal(op[3], false, 'operator keyValidationInProgress incorrect')
    assert.equal(op[4].toNumber(), 0, 'operator validatorLimit incorrect')
    assert.equal(op[5].toNumber(), 0, 'operator stoppedValidators incorrect')
    assert.equal(op[6].toNumber(), 0, 'operator totalKeyPairs incorrect')
    assert.equal(op[7].toNumber(), 0, 'operator usedKeyPairs incorrect')

    await expect(controller.connect(signers[1]).addOperator('Testing123')).to.be.revertedWith(
      'Operator is not whitelisted'
    )
  })

  it('addKeyPairs should work correctly', async () => {
    await controller.addOperator('Testing123')
    await controller.addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures)
    let op = (await controller.getOperators([5]))[0]

    assert.equal(op[4].toNumber(), 0, 'operator validatorLimit incorrect')
    assert.equal(op[6].toNumber(), 3, 'operator totalKeyPairs incorrect')
    assert.equal(op[7].toNumber(), 0, 'operator usedKeyPairs incorrect')

    await expect(
      controller.connect(signers[1]).addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures)
    ).to.be.revertedWith('OnlyOperatorOwner()')
  })

  it('reportKeyPairValidation should work correctly', async () => {
    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures)
    await controller.initiateKeyPairValidation(accounts[0], 2)

    await expect(
      controller.connect(signers[1]).reportKeyPairValidation(2, true)
    ).to.be.revertedWith('OnlyKeyValidationOracle()')

    let op = (await controller.getOperators([2]))[0]
    assert.equal(op[4].toNumber(), 3, 'operator validatorLimit incorrect')
    assert.equal(op[3], true, 'operator keyValidationInProgress incorrect')

    await controller.reportKeyPairValidation(2, true)

    op = (await controller.getOperators([2]))[0]
    assert.equal(op[4].toNumber(), 6, 'operator validatorLimit incorrect')
    assert.equal(op[3], false, 'operator keyValidationInProgress incorrect')

    assert.equal((await controller.queueLength()).toNumber(), 12, 'queueLength incorrect')

    await controller.initiateKeyPairValidation(accounts[0], 2)
    await controller.reportKeyPairValidation(2, false)

    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures)

    op = (await controller.getOperators([2]))[0]
    assert.equal(op[4].toNumber(), 6, 'operator validatorLimit incorrect')
    assert.equal(op[3], false, 'operator keyValidationInProgress incorrect')

    await expect(controller.reportKeyPairValidation(2, true)).to.be.revertedWith(
      'NoKeyValidationInProgress()'
    )
  })

  it('removeKeyPairs should work correctly', async () => {
    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures)
    await controller.initiateKeyPairValidation(accounts[0], 2)
    await controller.reportKeyPairValidation(2, true)
    await controller.assignNextValidators(4, [0, 2], [2, 2])

    await expect(controller.connect(signers[1]).removeKeyPairs(5, 2)).to.be.revertedWith(
      'OperatorNotFound(5)'
    )
    await expect(controller.connect(signers[1]).removeKeyPairs(2, 2)).to.be.revertedWith(
      'OnlyOperatorOwner()'
    )
    await expect(controller.removeKeyPairs(2, 0)).to.be.revertedWith('InvalidQuantity()')
    await expect(controller.removeKeyPairs(2, 7)).to.be.revertedWith('InvalidQuantity()')
    await expect(controller.removeKeyPairs(2, 5)).to.be.revertedWith('InvalidQuantity()')

    await controller.removeKeyPairs(2, 2)
    await controller.removeKeyPairs(2, 1)

    let op = (await controller.getOperators([2]))[0]

    assert.equal(op[4].toNumber(), 3, 'operator validatorLimit incorrect')
    assert.equal(op[6].toNumber(), 3, 'operator totalKeyPairs incorrect')
    assert.equal(op[7].toNumber(), 2, 'operator usedKeyPairs incorrect')

    assert.equal((await controller.queueLength()).toNumber(), 5, 'queueLength incorrect')
  })

  it('assignNextValidators should work correctly', async () => {
    let vals = await controller.callStatic.assignNextValidators(4, [0, 2], [2, 2])
    assert.equal(
      vals[0],
      keyPairs.keys.slice(0, 2 * pubkeyLength + 2) + keyPairs.keys.slice(2, 2 * pubkeyLength + 2),
      'assigned keys incorrect'
    )
    assert.equal(
      vals[1],
      keyPairs.signatures.slice(0, 2 * signatureLength + 2) +
        keyPairs.signatures.slice(2, 2 * signatureLength + 2),
      'assigned signatures incorrect'
    )

    await controller.assignNextValidators(4, [0, 2], [2, 2])

    let ops = await controller.getOperators([0, 1, 2, 3, 4])
    assert.equal(ops[0][7].toNumber(), 2, 'Operator0 usedKeyPairs incorrect')
    assert.equal(ops[1][7].toNumber(), 0, 'Operator1 usedKeyPairs incorrect')
    assert.equal(ops[2][7].toNumber(), 2, 'Operator2 usedKeyPairs incorrect')
    assert.equal(ops[3][7].toNumber(), 0, 'Operator3 usedKeyPairs incorrect')
    assert.equal(ops[4][7].toNumber(), 0, 'Operator4 usedKeyPairs incorrect')
    assert.equal(
      (await controller.totalActiveValidators()).toNumber(),
      4,
      'totalActiveValidators incorrect'
    )
    assert.equal((await controller.assignmentIndex()).toNumber(), 3, 'assignmentIndex incorrect')
    assert.equal((await controller.queueLength()).toNumber(), 5, 'queueLength incorrect')
    assert.equal(
      (await controller.totalAssignedValidators()).toNumber(),
      4,
      'totalAssignedValidators incorrect'
    )

    assert.equal((await controller.staked(accounts[0])).toNumber(), 4, 'operator staked incorrect')
    assert.equal((await controller.totalStaked()).toNumber(), 4, 'totalStaked incorrect')

    vals = await controller.callStatic.assignNextValidators(4, [4, 0, 2], [2, 1, 1])
    assert.equal(
      vals[0],
      keyPairs.keys.slice(0, 2 * pubkeyLength + 2) +
        keyPairs.keys.slice(2 * pubkeyLength + 2) +
        keyPairs.keys.slice(2 * pubkeyLength + 2),
      'assigned keys incorrect'
    )
    assert.equal(
      vals[1],
      keyPairs.signatures.slice(0, 2 * signatureLength + 2) +
        keyPairs.signatures.slice(2 * signatureLength + 2) +
        keyPairs.signatures.slice(2 * signatureLength + 2),
      'assigned signatures incorrect'
    )

    await controller.assignNextValidators(4, [4, 0, 2], [2, 1, 1])

    ops = await controller.getOperators([0, 1, 2, 3, 4])
    assert.equal(ops[0][7].toNumber(), 3, 'Operator0 usedKeyPairs incorrect')
    assert.equal(ops[1][7].toNumber(), 0, 'Operator1 usedKeyPairs incorrect')
    assert.equal(ops[2][7].toNumber(), 3, 'Operator2 usedKeyPairs incorrect')
    assert.equal(ops[3][7].toNumber(), 0, 'Operator3 usedKeyPairs incorrect')
    assert.equal(ops[4][7].toNumber(), 2, 'Operator4 usedKeyPairs incorrect')
    assert.equal(
      (await controller.totalActiveValidators()).toNumber(),
      8,
      'totalActiveValidators incorrect'
    )
    assert.equal((await controller.assignmentIndex()).toNumber(), 3, 'assignmentIndex incorrect')
    assert.equal((await controller.queueLength()).toNumber(), 1, 'queueLength incorrect')

    assert.equal((await controller.staked(accounts[0])).toNumber(), 8, 'operator staked incorrect')
    assert.equal((await controller.totalStaked()).toNumber(), 8, 'totalStaked incorrect')

    await expect(
      controller.connect(signers[1]).assignNextValidators(1, [4], [1])
    ).to.be.revertedWith('OnlyETHStakingStrategy()')
  })

  it('assignNextValidators first data validation should work correctly', async () => {
    await expect(controller.assignNextValidators(0, [], [])).to.be.revertedWith(
      'EmptyOperatorIds()'
    )
    await expect(controller.assignNextValidators(2, [0, 2], [2])).to.be.revertedWith(
      'InconsistentLengths()'
    )
    await expect(controller.assignNextValidators(7, [0, 2, 4, 0], [2, 2, 2, 1])).to.be.revertedWith(
      'DuplicateOperator(0)'
    )
    await expect(controller.assignNextValidators(6, [0, 2], [4, 2])).to.be.revertedWith(
      'ValidatorLimitExceeded(0)'
    )
    await expect(controller.assignNextValidators(3, [0, 2], [1, 2])).to.be.revertedWith(
      'InvalidBatching()'
    )
    await expect(controller.assignNextValidators(4, [0, 2], [3, 2])).to.be.revertedWith(
      'InconsistentTotalValidatorCount()'
    )

    await controller.disableOperator(0)
    await expect(controller.assignNextValidators(2, [0], [2])).to.be.revertedWith(
      'OperatorNotActive(0)'
    )
  })

  it('assignNextValidators second data validation should work correctly', async () => {
    await expect(controller.assignNextValidators(4, [0, 4], [2, 2])).to.be.revertedWith(
      'SkippedValidatorAssignments(1)'
    )
    await expect(controller.assignNextValidators(2, [2], [2])).to.be.revertedWith(
      'SkippedValidatorAssignments(3)'
    )

    await controller.assignNextValidators(2, [0], [2])

    await expect(controller.assignNextValidators(1, [0], [1])).to.be.revertedWith(
      'SkippedValidatorAssignments(2)'
    )
  })

  it('assignNextValidators third data validation should work correctly', async () => {
    await expect(controller.assignNextValidators(7, [0, 2, 4], [2, 2, 3])).to.be.revertedWith(
      'IncorrectlySplitValidatorAssignments(1)'
    )
    await controller.setBatchSize(1)
    await expect(controller.assignNextValidators(5, [0, 2, 4], [3, 1, 1])).to.be.revertedWith(
      'IncorrectlySplitValidatorAssignments(2)'
    )
  })

  it('assignNextValidators fourth data validation should work correctly', async () => {
    await expect(controller.assignNextValidators(6, [0, 2], [3, 2])).to.be.revertedWith(
      'InconsistentTotalValidatorCount()'
    )
    await expect(controller.assignNextValidators(5, [0, 2], [3, 2])).to.be.revertedWith(
      'SkippedValidatorAssignments(5)'
    )

    await controller.assignNextValidators(2, [0], [2])

    await expect(controller.assignNextValidators(6, [2, 4], [3, 3])).to.be.revertedWith(
      'SkippedValidatorAssignments(6)'
    )

    await controller.assignNextValidators(2, [2], [2])

    await expect(controller.assignNextValidators(4, [4, 0], [3, 1])).to.be.revertedWith(
      'SkippedValidatorAssignments(4)'
    )
  })

  it('assignmentIndex should always be correct', async () => {
    assert.equal((await controller.assignmentIndex()).toNumber(), 0)

    await controller.assignNextValidators(2, [0], [2])
    assert.equal((await controller.assignmentIndex()).toNumber(), 1)

    await controller.assignNextValidators(4, [2, 4], [2, 2])
    assert.equal((await controller.assignmentIndex()).toNumber(), 0)

    await controller.assignNextValidators(2, [0, 2], [1, 1])
    assert.equal((await controller.assignmentIndex()).toNumber(), 3)
  })

  it('getNextValidators should work correctly', async () => {
    let nextValidators = await controller.getNextValidators(2)
    assert.deepEqual(
      nextValidators[2].map((op) => op.toNumber()),
      [0]
    )
    assert.deepEqual(
      nextValidators[3].map((v) => v.toNumber()),
      [2]
    )
    assert.equal(nextValidators[1].toNumber(), 2, 'totalValidatorCount incorrect')
    assert.equal(nextValidators[0], keyPairs.keys.slice(0, 2 * pubkeyLength + 2), 'keys incorrect')

    nextValidators = await controller.getNextValidators(7)
    assert.deepEqual(
      nextValidators[2].map((op) => op.toNumber()),
      [0, 2, 4]
    )
    assert.deepEqual(
      nextValidators[3].map((v) => v.toNumber()),
      [3, 2, 2]
    )
    assert.equal(nextValidators[1].toNumber(), 7, 'totalValidatorCount incorrect')
    assert.equal(
      nextValidators[0],
      keyPairs.keys +
        keyPairs.keys.slice(2, 2 * pubkeyLength + 2) +
        keyPairs.keys.slice(2, 2 * pubkeyLength + 2),
      'keys incorrect'
    )

    await controller.assignNextValidators(2, [0], [2])

    nextValidators = await controller.getNextValidators(5)
    assert.deepEqual(
      nextValidators[2].map((op) => op.toNumber()),
      [2, 4, 0]
    )
    assert.deepEqual(
      nextValidators[3].map((v) => v.toNumber()),
      [2, 2, 1]
    )
    assert.equal(nextValidators[1].toNumber(), 5, 'totalValidatorCount incorrect')
    assert.equal(
      nextValidators[0],
      keyPairs.keys.slice(0, 2 * pubkeyLength + 2) +
        keyPairs.keys.slice(2, 2 * pubkeyLength + 2) +
        keyPairs.keys.slice(2 * pubkeyLength + 2, 3 * pubkeyLength + 2),
      'keys incorrect'
    )

    nextValidators = await controller.getNextValidators(4)
    assert.deepEqual(
      nextValidators[2].map((op) => op.toNumber()),
      [2, 4]
    )
    assert.deepEqual(
      nextValidators[3].map((v) => v.toNumber()),
      [2, 2]
    )
    assert.equal(nextValidators[1].toNumber(), 4, 'totalValidatorCount incorrect')
    assert.equal(
      nextValidators[0],
      keyPairs.keys.slice(0, 2 * pubkeyLength + 2) + keyPairs.keys.slice(2, 2 * pubkeyLength + 2),
      'keys incorrect'
    )

    await controller.disableOperator(4)
    nextValidators = await controller.getNextValidators(4)
    assert.deepEqual(
      nextValidators[2].map((op) => op.toNumber()),
      [2, 0]
    )
    assert.deepEqual(
      nextValidators[3].map((v) => v.toNumber()),
      [3, 1]
    )
    assert.equal(nextValidators[1].toNumber(), 4, 'totalValidatorCount incorrect')
    assert.equal(
      nextValidators[0],
      keyPairs.keys + keyPairs.keys.slice(2 * pubkeyLength + 2, 3 * pubkeyLength + 2),
      'keys incorrect'
    )
  })

  it('getNextValidators and assignNextValidators should work together', async () => {
    let nextValidators = await controller.getNextValidators(2)
    await controller.assignNextValidators(nextValidators[1], nextValidators[2], nextValidators[3])

    nextValidators = await controller.getNextValidators(5)
    await controller.assignNextValidators(nextValidators[1], nextValidators[2], nextValidators[3])

    nextValidators = await controller.getNextValidators(2)
    await controller.assignNextValidators(nextValidators[1], nextValidators[2], nextValidators[3])

    assert.equal(
      (await controller.totalActiveValidators()).toNumber(),
      9,
      'totalActiveValidators incorrect'
    )
  })

  it('reportStoppedValidators should work correctly', async () => {
    await controller.assignNextValidators(7, [0, 2, 4], [3, 2, 2])
    await controller.reportStoppedValidators([0, 4], [1, 2], [])

    let op = await controller.getOperators([0, 2, 4])
    assert.equal(op[0][5].toNumber(), 1, 'operator stoppedValidators incorrect')
    assert.equal(op[1][5].toNumber(), 0, 'operator stoppedValidators incorrect')
    assert.equal(op[2][5].toNumber(), 2, 'operator stoppedValidators incorrect')

    assert.equal(
      (await controller.totalActiveValidators()).toNumber(),
      4,
      'totalActiveValidators incorrect'
    )
    assert.equal((await controller.staked(accounts[0])).toNumber(), 4, 'operator staked incorrect')
    assert.equal((await controller.totalStaked()).toNumber(), 4, 'totalStaked incorrect')

    await expect(controller.reportStoppedValidators([0, 5], [3, 1], [])).to.be.revertedWith(
      'OperatorNotFound(5)'
    )
    await expect(
      controller.connect(signers[1]).reportStoppedValidators([0, 4], [3, 2], [])
    ).to.be.revertedWith('OnlyBeaconOracle()')
    await expect(controller.reportStoppedValidators([0, 4], [1, 3], [])).to.be.revertedWith(
      'NegativeOrZeroValidators()'
    )
    await expect(controller.reportStoppedValidators([0, 4], [3, 0], [])).to.be.revertedWith(
      'NegativeOrZeroValidators()'
    )
    await expect(controller.reportStoppedValidators([0, 4], [3, 3], [])).to.be.revertedWith(
      'MoreValidatorsThanActive()'
    )
  })

  it('RewardsPoolController functions should work', async () => {
    await controller.setOperatorOwner(2, accounts[2])
    await controller.setOperatorOwner(4, accounts[4])
    await controller.assignNextValidators(8, [0, 2, 4], [3, 3, 2])
    await wsdToken.transferAndCall(rewardsPool.address, toEther(100), '0x00')

    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[0])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[2])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[4])),
      25,
      'rewards pool account balance incorrect'
    )

    await controller.reportStoppedValidators([0, 4], [1, 2], [])

    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[0])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[2])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[4])),
      25,
      'rewards pool account balance incorrect'
    )

    await controller.assignNextValidators(1, [4], [1])

    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[0])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[2])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[4])),
      25,
      'rewards pool account balance incorrect'
    )
  })

  it('currentStateHash should be properly updated', async () => {
    let hash = await controller.currentStateHash()

    await controller.removeKeyPairs(3, 2)

    hash = ethers.utils.solidityKeccak256(
      ['bytes32', 'string', 'uint', 'uint', 'uint[]'],
      [hash, 'removeKeyPairs', 3, 2, []]
    )
    assert.equal(hash, await controller.currentStateHash(), 'currentStateHash incorrect')

    await controller.initiateKeyPairValidation(accounts[0], 1)
    await controller.reportKeyPairValidation(1, true)

    hash = ethers.utils.solidityKeccak256(
      ['bytes32', 'string', 'uint'],
      [hash, 'reportKeyPairValidation', 1]
    )
    assert.equal(hash, await controller.currentStateHash(), 'currentStateHash incorrect')

    await controller.assignNextValidators(4, [0, 1], [2, 2])

    for (let i = 0; i <= 1; i++) {
      for (let j = 0; j < 2; j++) {
        hash = ethers.utils.solidityKeccak256(
          ['bytes32', 'string', 'uint', 'bytes'],
          [
            hash,
            'assignKey',
            i,
            '0x' + keyPairs.keys.slice(j * pubkeyLength + 2, (j + 1) * pubkeyLength + 2),
          ]
        )
      }
    }
    assert.equal(hash, await controller.currentStateHash(), 'currentStateHash incorrect')
  })

  it('setBatchSize should work correctly', async () => {
    await controller.setBatchSize(7)

    assert.equal((await controller.batchSize()).toNumber(), 7, 'batch size incorrect')

    await expect(controller.connect(signers[1]).setBatchSize(5)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('setOperatorWhitelist should work correctly', async () => {
    await controller.setOperatorWhitelist(accounts[2])

    assert.equal(await controller.operatorWhitelist(), accounts[2], 'operatorWhitelist incorrect')

    await expect(
      controller.connect(signers[1]).setOperatorWhitelist(accounts[2])
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })
})
