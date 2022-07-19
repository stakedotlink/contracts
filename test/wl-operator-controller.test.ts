import { assert, expect } from 'chai'
import { deploy, padBytes, concatBytes, getAccounts } from './utils/helpers'
import { OperatorWhitelistMock, WLOperatorController } from '../typechain-types'
import { Signer } from 'ethers'

const keyPairs = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48), padBytes('0xa3', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96), padBytes('0xb3', 96)]),
}

describe('WLOperatorController', () => {
  let controller: WLOperatorController
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    let operatorWhitelist = (await deploy('OperatorWhitelistMock', [
      [accounts[0]],
    ])) as OperatorWhitelistMock
    controller = (await deploy('WLOperatorController', [
      accounts[0],
      operatorWhitelist.address,
      2,
    ])) as WLOperatorController

    await controller.setKeyValidationOracle(accounts[0])
    await controller.setBeaconOracle(accounts[0])

    for (let i = 0; i < 5; i++) {
      await controller.addOperator('test')
      await controller.addKeyPairs(i, 3, keyPairs.keys, keyPairs.signatures)
      if (i % 2 == 0) {
        await controller.initiateKeyPairValidation(i)
        await controller.reportKeyPairValidation(i, true)
      }
    }
  })

  it('assignNextValidators should work correctly', async () => {
    await controller.assignNextValidators([0, 2], [2, 2], 4)

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

    await controller.assignNextValidators([4, 0, 2], [2, 1, 1], 4)

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

    await expect(
      controller.connect(signers[1]).assignNextValidators([4], [1], 1)
    ).to.be.revertedWith('Sender is not ETH staking strategy')
  })

  it('assignNextValidators first data validation should work correctly', async () => {
    await expect(controller.assignNextValidators([], [], 0)).to.be.revertedWith('Empty operatorIds')
    await expect(controller.assignNextValidators([0, 2], [2], 2)).to.be.revertedWith(
      'Inconsistent operatorIds and validatorCounts length'
    )
    await expect(controller.assignNextValidators([0, 2, 4, 0], [2, 2, 2, 1], 7)).to.be.revertedWith(
      'Duplicate operator'
    )
    await expect(controller.assignNextValidators([0, 2], [4, 2], 6)).to.be.revertedWith(
      'Assigned more keys than validator limit'
    )
    await expect(controller.assignNextValidators([0, 2], [1, 2], 3)).to.be.revertedWith(
      'Invalid batching'
    )
    await expect(controller.assignNextValidators([0, 2], [3, 2], 4)).to.be.revertedWith(
      'Inconsistent total validator count'
    )

    await controller.setOperatorActive(0, false)
    await expect(controller.assignNextValidators([0], [2], 2)).to.be.revertedWith(
      'Inactive operator'
    )
  })

  it('assignNextValidators second data validation should work correctly', async () => {
    await expect(controller.assignNextValidators([0, 4], [2, 2], 4)).to.be.revertedWith(
      '1: Validator assignments were skipped'
    )
    await expect(controller.assignNextValidators([2], [2], 2)).to.be.revertedWith(
      '3: Validator assignments were skipped'
    )

    await controller.assignNextValidators([0], [2], 2)

    await expect(controller.assignNextValidators([0], [1], 1)).to.be.revertedWith(
      '2: Validator assignments were skipped'
    )
  })

  it('assignNextValidators third data validation should work correctly', async () => {
    await expect(controller.assignNextValidators([0, 2, 4], [2, 2, 3], 7)).to.be.revertedWith(
      '1: Validator assignments incorrectly split'
    )
    await controller.setBatchSize(1)
    await expect(controller.assignNextValidators([0, 2, 4], [3, 1, 1], 5)).to.be.revertedWith(
      '2: Validator assignments incorrectly split'
    )
  })

  it('assignNextValidators fourth data validation should work correctly', async () => {
    await expect(controller.assignNextValidators([0, 2], [3, 2], 6)).to.be.revertedWith(
      'Inconsistent total validator count'
    )
    await expect(controller.assignNextValidators([0, 2], [3, 2], 5)).to.be.revertedWith(
      '5: Validator assignments were skipped'
    )

    await controller.assignNextValidators([0], [2], 2)

    await expect(controller.assignNextValidators([2, 4], [3, 3], 6)).to.be.revertedWith(
      '6: Validator assignments were skipped'
    )

    await controller.assignNextValidators([2], [2], 2)

    await expect(controller.assignNextValidators([4, 0], [3, 1], 4)).to.be.revertedWith(
      '4: Validator assignments were skipped'
    )
  })

  it('assignmentIndex should always be correct', async () => {
    assert.equal((await controller.assignmentIndex()).toNumber(), 0)

    await controller.assignNextValidators([0], [2], 2)
    assert.equal((await controller.assignmentIndex()).toNumber(), 1)

    await controller.assignNextValidators([2, 4], [2, 2], 4)
    assert.equal((await controller.assignmentIndex()).toNumber(), 0)

    await controller.assignNextValidators([0, 2], [1, 1], 2)
    assert.equal((await controller.assignmentIndex()).toNumber(), 3)
  })

  it('getNextValidators should correctly determine the next set of validators to assign', async () => {
    let nextValidators = await controller.getNextValidators(2)
    assert.deepEqual(
      nextValidators[0].map((op) => op.toNumber()),
      [0]
    )
    assert.deepEqual(
      nextValidators[1].map((v) => v.toNumber()),
      [2]
    )

    nextValidators = await controller.getNextValidators(7)
    assert.deepEqual(
      nextValidators[0].map((op) => op.toNumber()),
      [0, 2, 4]
    )
    assert.deepEqual(
      nextValidators[1].map((v) => v.toNumber()),
      [3, 2, 2]
    )

    await controller.assignNextValidators([0], [2], 2)

    nextValidators = await controller.getNextValidators(5)
    assert.deepEqual(
      nextValidators[0].map((op) => op.toNumber()),
      [2, 4, 0]
    )
    assert.deepEqual(
      nextValidators[1].map((v) => v.toNumber()),
      [2, 2, 1]
    )

    nextValidators = await controller.getNextValidators(4)
    assert.deepEqual(
      nextValidators[0].map((op) => op.toNumber()),
      [2, 4]
    )
    assert.deepEqual(
      nextValidators[1].map((v) => v.toNumber()),
      [2, 2]
    )

    await controller.setOperatorActive(4, false)
    nextValidators = await controller.getNextValidators(4)
    assert.deepEqual(
      nextValidators[0].map((op) => op.toNumber()),
      [2, 0]
    )
    assert.deepEqual(
      nextValidators[1].map((v) => v.toNumber()),
      [3, 1]
    )
  })

  it('getNextValidators and assignNextValidators should work together', async () => {
    let nextValidators = await controller.getNextValidators(2)
    await controller.assignNextValidators(nextValidators[0], nextValidators[1], nextValidators[2])

    nextValidators = await controller.getNextValidators(5)
    await controller.assignNextValidators(nextValidators[0], nextValidators[1], nextValidators[2])

    nextValidators = await controller.getNextValidators(5)
    await controller.assignNextValidators(nextValidators[0], nextValidators[1], nextValidators[2])

    assert.equal(
      (await controller.totalActiveValidators()).toNumber(),
      9,
      'totalActiveValidators incorrect'
    )
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
    ).to.be.revertedWith('Sender is not operator owner')
  })

  it('removeKeyPairs should work correctly', async () => {
    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures)
    await controller.initiateKeyPairValidation(2)
    await controller.reportKeyPairValidation(2, true)
    await controller.assignNextValidators([0, 2], [2, 2], 4)

    await expect(controller.connect(signers[1]).removeKeyPairs(5, 2)).to.be.revertedWith(
      'Operator does not exist'
    )
    await expect(controller.connect(signers[1]).removeKeyPairs(2, 2)).to.be.revertedWith(
      'Sender is not operator owner'
    )
    await expect(controller.removeKeyPairs(2, 0)).to.be.revertedWith(
      'Quantity must be greater than 0'
    )
    await expect(controller.removeKeyPairs(2, 7)).to.be.revertedWith(
      'Cannot remove more keys than are added'
    )
    await expect(controller.removeKeyPairs(2, 5)).to.be.revertedWith('Cannot remove used key pairs')

    await controller.removeKeyPairs(2, 2)
    await controller.removeKeyPairs(2, 1)

    let op = (await controller.getOperators([2]))[0]

    assert.equal(op[4].toNumber(), 3, 'operator validatorLimit incorrect')
    assert.equal(op[6].toNumber(), 3, 'operator totalKeyPairs incorrect')
    assert.equal(op[7].toNumber(), 2, 'operator usedKeyPairs incorrect')
  })

  it('reportKeyPairValidation should work correctly', async () => {
    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures)
    await controller.initiateKeyPairValidation(2)

    await expect(
      controller.connect(signers[1]).reportKeyPairValidation(2, true)
    ).to.be.revertedWith('Sender is not key validation oracle')

    let op = (await controller.getOperators([2]))[0]

    assert.equal(op[4].toNumber(), 3, 'operator validatorLimit incorrect')
    assert.equal(op[3], true, 'operator keyValidationInProgress incorrect')

    await controller.reportKeyPairValidation(2, true)

    op = (await controller.getOperators([2]))[0]

    assert.equal(op[4].toNumber(), 6, 'operator validatorLimit incorrect')
    assert.equal(op[3], false, 'operator keyValidationInProgress incorrect')

    await controller.initiateKeyPairValidation(2)
    await controller.reportKeyPairValidation(2, false)

    op = (await controller.getOperators([2]))[0]

    assert.equal(op[4].toNumber(), 6, 'operator validatorLimit incorrect')
    assert.equal(op[3], false, 'operator keyValidationInProgress incorrect')

    await expect(controller.reportKeyPairValidation(2, true)).to.be.revertedWith(
      'No key validation in progress'
    )
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
