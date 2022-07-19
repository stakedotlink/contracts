import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { deploy, padBytes, concatBytes, getAccounts, toEther, fromEther } from './utils/helpers'
import { NWLOperatorController } from '../typechain-types'
import { Signer } from 'ethers'

const pubkeyLength = 48 * 2
const signatureLength = 96 * 2

const keyPairs = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48), padBytes('0xa3', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96), padBytes('0xb3', 96)]),
}

describe('NWLOperatorController', () => {
  let controller: NWLOperatorController
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    controller = (await deploy('NWLOperatorController', [accounts[0]])) as NWLOperatorController

    await controller.setKeyValidationOracle(accounts[0])
    await controller.setBeaconOracle(accounts[0])

    for (let i = 0; i < 5; i++) {
      await controller.addOperator('test')
      await controller.addKeyPairs(i, 3, keyPairs.keys, keyPairs.signatures, {
        value: toEther(16 * 3),
      })
      if (i % 2 == 0) {
        await controller.initiateKeyPairValidation(i)
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
  })

  it('addKeyPairs should work correctly', async () => {
    await controller.addOperator('Testing123')
    await controller.addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })
    let op = (await controller.getOperators([5]))[0]

    assert.equal(op[4].toNumber(), 0, 'operator validatorLimit incorrect')
    assert.equal(op[6].toNumber(), 3, 'operator totalKeyPairs incorrect')
    assert.equal(op[7].toNumber(), 0, 'operator usedKeyPairs incorrect')

    assert.equal(
      fromEther(await ethers.provider.getBalance(controller.address)),
      3 * 16 + 5 * 3 * 16
    )

    await expect(
      controller.connect(signers[1]).addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures)
    ).to.be.revertedWith('Sender is not operator owner')
    await expect(
      controller.addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures, { value: toEther(16) })
    ).to.be.revertedWith('Incorrect stake amount')
    await expect(
      controller.addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures, { value: toEther(4 * 16) })
    ).to.be.revertedWith('Incorrect stake amount')
  })

  it('reportKeyPairValidation should work correctly', async () => {
    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })
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

    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })
    await controller.initiateKeyPairValidation(2)
    await controller.reportKeyPairValidation(2, false)

    op = (await controller.getOperators([2]))[0]

    assert.equal(op[4].toNumber(), 6, 'operator validatorLimit incorrect')
    assert.equal(op[3], false, 'operator keyValidationInProgress incorrect')

    let queue = await controller.getQueueEntries(0, 100)
    assert.equal(queue.length, 4, 'queue.length incorrect')
    assert.deepEqual(
      queue[3].map((v) => v.toNumber()),
      [2, 3],
      'queue entry incorrect'
    )

    assert.equal((await controller.queueLength()).toNumber(), 12, 'queueLength incorrect')

    await expect(controller.reportKeyPairValidation(2, true)).to.be.revertedWith(
      'No key validation in progress'
    )
  })

  it('removeKeyPairs should work correctly', async () => {
    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })
    await controller.initiateKeyPairValidation(2)
    await controller.reportKeyPairValidation(2, true)
    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })

    await controller.assignNextValidators(4)

    await expect(controller.removeKeyPairs(5, 2, [5])).to.be.revertedWith('Operator does not exist')
    await expect(controller.connect(signers[1]).removeKeyPairs(4, 2, [4])).to.be.revertedWith(
      'Sender is not operator owner'
    )
    await expect(controller.removeKeyPairs(2, 0, [1])).to.be.revertedWith(
      'Quantity must be greater than 0'
    )
    await expect(controller.removeKeyPairs(2, 10, [1])).to.be.revertedWith(
      'Cannot remove more keys than are added'
    )
    await expect(controller.removeKeyPairs(2, 9, [1])).to.be.revertedWith(
      'Cannot remove used key pairs'
    )
    await expect(controller.removeKeyPairs(2, 4, [0])).to.be.revertedWith(
      'Cannot remove from queue entry that is already passed by'
    )
    await expect(controller.removeKeyPairs(2, 7, [1, 4])).to.be.revertedWith(
      'Cannot remove from queue entry that does not exist'
    )

    await controller.removeKeyPairs(2, 7, [1, 3])

    let op = (await controller.getOperators([2]))[0]
    assert.equal(op[4].toNumber(), 2, 'operator validatorLimit incorrect')
    assert.equal(op[6].toNumber(), 2, 'operator totalKeyPairs incorrect')
    assert.equal(op[7].toNumber(), 1, 'operator usedKeyPairs incorrect')

    let queue = await controller.getQueueEntries(0, 100)
    assert.equal(queue.length, 4, 'queue.length incorrect')
    assert.deepEqual(
      queue[1].map((v) => v.toNumber()),
      [2, 0],
      'queue entry incorrect'
    )
    assert.deepEqual(
      queue[3].map((v) => v.toNumber()),
      [2, 1],
      'queue entry incorrect'
    )

    assert.equal((await controller.queueLength()).toNumber(), 4, 'queueLength incorrect')
    assert.equal(fromEther(await ethers.provider.getBalance(controller.address)), 16 * 10)
  })

  it('assignNextValidators should work correctly', async () => {
    let vals = await controller.callStatic.assignNextValidators(5)
    assert.equal(
      vals[0],
      keyPairs.keys + keyPairs.keys.slice(2, 2 * pubkeyLength + 2),
      'assigned keys incorrect'
    )
    assert.equal(
      vals[1],
      keyPairs.signatures + keyPairs.signatures.slice(2, 2 * signatureLength + 2),
      'assigned signatures incorrect'
    )

    await controller.assignNextValidators(5)

    let ops = await controller.getOperators([0, 1, 2, 3, 4])
    assert.equal(ops[0][7].toNumber(), 3, 'Operator0 usedKeyPairs incorrect')
    assert.equal(ops[1][7].toNumber(), 0, 'Operator1 usedKeyPairs incorrect')
    assert.equal(ops[2][7].toNumber(), 2, 'Operator2 usedKeyPairs incorrect')
    assert.equal(ops[3][7].toNumber(), 0, 'Operator3 usedKeyPairs incorrect')
    assert.equal(ops[4][7].toNumber(), 0, 'Operator4 usedKeyPairs incorrect')
    assert.equal(
      (await controller.totalActiveValidators()).toNumber(),
      5,
      'totalActiveValidators incorrect'
    )
    assert.equal((await controller.queueIndex()).toNumber(), 1, 'queueIndex incorrect')
    assert.equal((await controller.queueLength()).toNumber(), 4, 'queueLength incorrect')

    assert.equal(
      (await controller.rpcStaked(accounts[0])).toNumber(),
      5,
      'operator rpcStaked incorrect'
    )
    assert.equal((await controller.rpcTotalStaked()).toNumber(), 5, 'rpcTotalStaked incorrect')

    let queue = await controller.getQueueEntries(0, 100)
    assert.deepEqual(
      queue[1].map((v) => v.toNumber()),
      [2, 1],
      'queue entry incorrect'
    )

    vals = await controller.callStatic.assignNextValidators(5)
    assert.equal(
      vals[0],
      '0x' + keyPairs.keys.slice(2 * pubkeyLength + 2) + keyPairs.keys.slice(2),
      'assigned keys incorrect'
    )
    assert.equal(
      vals[1],
      '0x' + keyPairs.signatures.slice(2 * signatureLength + 2) + keyPairs.signatures.slice(2),
      'assigned signatures incorrect'
    )

    await controller.assignNextValidators(30)

    ops = await controller.getOperators([0, 1, 2, 3, 4])
    assert.equal(ops[0][7].toNumber(), 3, 'Operator0 usedKeyPairs incorrect')
    assert.equal(ops[1][7].toNumber(), 0, 'Operator1 usedKeyPairs incorrect')
    assert.equal(ops[2][7].toNumber(), 3, 'Operator2 usedKeyPairs incorrect')
    assert.equal(ops[3][7].toNumber(), 0, 'Operator3 usedKeyPairs incorrect')
    assert.equal(ops[4][7].toNumber(), 3, 'Operator4 usedKeyPairs incorrect')
    assert.equal(
      (await controller.totalActiveValidators()).toNumber(),
      9,
      'totalActiveValidators incorrect'
    )
    assert.equal((await controller.queueIndex()).toNumber(), 3, 'queueIndex incorrect')
    assert.equal((await controller.queueLength()).toNumber(), 0, 'queueLength incorrect')

    assert.equal(
      (await controller.rpcStaked(accounts[0])).toNumber(),
      9,
      'operator rpcStaked incorrect'
    )
    assert.equal((await controller.rpcTotalStaked()).toNumber(), 9, 'rpcTotalStaked incorrect')

    await expect(controller.connect(signers[1]).assignNextValidators(1)).to.be.revertedWith(
      'Sender is not ETH staking strategy'
    )
  })
})
