import { assert, expect } from 'chai'
import { deploy, padBytes, concatBytes, getAccounts } from '../utils/helpers'
import { OperatorControllerMock } from '../../typechain-types'
import { Signer, constants } from 'ethers'

const pubkeyLength = 48 * 2
const signatureLength = 96 * 2

const keyPairs = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48), padBytes('0xa3', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96), padBytes('0xb3', 96)]),
}

describe('OperatorController', () => {
  let controller: OperatorControllerMock
  let signers: Signer[]
  let accounts: string[]

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach(async () => {
    controller = (await deploy('OperatorControllerMock', [accounts[0]])) as OperatorControllerMock

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

  it('addKeyPairs and getKeyPairs should work correctly', async () => {
    await controller.addOperator('Testing123')
    await controller.addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures)
    let op = (await controller.getOperators([5]))[0]

    assert.equal(op[4].toNumber(), 0, 'operator validatorLimit incorrect')
    assert.equal(op[6].toNumber(), 3, 'operator totalKeyPairs incorrect')
    assert.equal(op[7].toNumber(), 0, 'operator usedKeyPairs incorrect')

    let pairs = await controller.getKeyPairs(5, 0, 2)
    assert.equal(pairs[0], keyPairs.keys.slice(0, 2 * pubkeyLength + 2))
    assert.equal(pairs[1], keyPairs.signatures.slice(0, 2 * signatureLength + 2))

    pairs = await controller.getKeyPairs(5, 0, 10)
    assert.equal(pairs[0], keyPairs.keys)
    assert.equal(pairs[1], keyPairs.signatures)

    pairs = await controller.getKeyPairs(5, 1, 2)
    assert.equal(pairs[0], '0x' + keyPairs.keys.slice(pubkeyLength + 2))
    assert.equal(pairs[1], '0x' + keyPairs.signatures.slice(signatureLength + 2))

    await expect(controller.getKeyPairs(6, 0, 2)).to.be.revertedWith('Operator does not exist')
    await expect(
      controller.addKeyPairs(5, 3, keyPairs.keys.slice(0, 50), keyPairs.signatures)
    ).to.be.revertedWith('Invalid pubkeys length')
    await expect(
      controller.addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures.slice(0, 50))
    ).to.be.revertedWith('Invalid signatures length')
  })

  it('initiateKeyPairValidation should work correctly', async () => {
    await controller.initiateKeyPairValidation(3)

    let op = (await controller.getOperators([3]))[0]
    assert.equal(op[3], true, 'operator keyValidationInProgress incorrect')

    await expect(
      controller.addKeyPairs(3, 3, keyPairs.keys, keyPairs.signatures)
    ).to.be.revertedWith('Key validation in progress')
  })

  it('setOperatorName should work correctly', async () => {
    await controller.setOperatorName(0, '1234')

    let op = (await controller.getOperators([0]))[0]
    assert.equal(op[0], '1234', 'operator name incorrect')

    await expect(controller.setOperatorName(5, '123')).to.be.revertedWith('Operator does not exist')
    await expect(controller.connect(signers[1]).setOperatorName(0, '123')).to.be.revertedWith(
      'Sender is not operator owner'
    )
  })

  it('setOperatorOwner should work correctly', async () => {
    await controller.assignNextValidators([0, 2, 4], [3, 2, 2], 7)
    await controller.setOperatorOwner(0, accounts[2])

    let op = (await controller.getOperators([0]))[0]
    assert.equal(op[1], accounts[2], 'operator owner incorrect')

    assert.equal((await controller.staked(accounts[0])).toNumber(), 4, 'operator staked incorrect')
    assert.equal((await controller.staked(accounts[2])).toNumber(), 3, 'operator staked incorrect')

    await expect(controller.setOperatorOwner(5, accounts[1])).to.be.revertedWith(
      'Operator does not exist'
    )
    await expect(
      controller.connect(signers[1]).setOperatorOwner(0, accounts[1])
    ).to.be.revertedWith('Sender is not operator owner')
    await expect(controller.setOperatorOwner(1, constants.AddressZero)).to.be.revertedWith(
      'Owner address cannot be 0'
    )
  })

  it('setOperatorActive should work correctly', async () => {
    await controller.setOperatorActive(0, false)

    let op = (await controller.getOperators([0]))[0]
    assert.equal(op[2], false, 'operator active incorrect')

    await expect(controller.connect(signers[1]).setOperatorActive(2, false)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('setKeyValidationOracle should work correctly', async () => {
    await controller.setKeyValidationOracle(accounts[1])

    assert.equal(
      await controller.keyValidationOracle(),
      accounts[1],
      'keyValidationOracle incorrect'
    )

    await expect(
      controller.connect(signers[1]).setKeyValidationOracle(accounts[2])
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('setBeaconOracle should work correctly', async () => {
    await controller.setBeaconOracle(accounts[1])

    assert.equal(await controller.beaconOracle(), accounts[1], 'beaconOracle incorrect')

    await expect(controller.connect(signers[1]).setBeaconOracle(accounts[2])).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })
})
