import { assert, expect } from 'chai'
import {
  deploy,
  deployUpgradeable,
  getAccounts,
  toEther,
  fromEther,
  concatBytes,
  padBytes,
  ethers,
  loadFixture,
} from '../utils/helpers'
import { ERC677, KeyValidationOracle, OperatorControllerMock } from '../../typechain-types'

const keyPairs = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48), padBytes('0xa3', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96), padBytes('0xb3', 96)]),
}

describe('KeyValidationOracle', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677

    let wsdToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'test',
      'test',
      0,
    ])) as ERC677

    const nwlOpController = (await deployUpgradeable('OperatorControllerMock', [
      accounts[0],
      await wsdToken.getAddress(),
    ])) as OperatorControllerMock

    const wlOpController = (await deployUpgradeable('OperatorControllerMock', [
      accounts[0],
      await wsdToken.getAddress(),
    ])) as OperatorControllerMock

    const kvOracle = (await deploy('KeyValidationOracle', [
      nwlOpController.target,
      wlOpController.target,
      token.target,
      accounts[0],
      '0x0000000000000000000000000000000053f9755920cd451a8fe46f5087468395',
      toEther(5),
    ])) as KeyValidationOracle

    await nwlOpController.setKeyValidationOracle(kvOracle.target)
    await wlOpController.setKeyValidationOracle(kvOracle.target)

    await nwlOpController.addOperator('test')
    await wlOpController.addOperator('test')

    await nwlOpController.addKeyPairs(0, 3, keyPairs.keys, keyPairs.signatures)
    await wlOpController.addKeyPairs(0, 3, keyPairs.keys, keyPairs.signatures)

    return { signers, accounts, token, nwlOpController, wlOpController, kvOracle }
  }

  it('setOracleConfig should work correctly', async () => {
    const { signers, accounts, kvOracle } = await loadFixture(deployFixture)

    await kvOracle.setOracleConfig(
      accounts[3],
      '0x0000000000000000000000000000000093f9755920cd451a8fe46f5087468395',
      toEther(23)
    )

    assert.equal(await kvOracle.oracleAddress(), accounts[3], 'oracleAddress incorrect')
    assert.equal(
      await kvOracle.jobId(),
      '0x0000000000000000000000000000000093f9755920cd451a8fe46f5087468395',
      'jobId incorrect'
    )
    assert.equal(fromEther(await kvOracle.fee()), 23, 'fee incorrect')

    await expect(
      kvOracle
        .connect(signers[2])
        .setOracleConfig(
          accounts[3],
          '0x0000000000000000000000000000000093f9755920cd451a8fe46f5087468395',
          toEther(23)
        )
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('should be able be able initiate validation', async () => {
    const { accounts, kvOracle, token, nwlOpController, wlOpController } = await loadFixture(
      deployFixture
    )

    await expect(kvOracle.onTokenTransfer(accounts[3], toEther(10), '0x00')).to.be.revertedWith(
      'Sender is not chainlink token'
    )
    await expect(token.transferAndCall(kvOracle.target, toEther(10), '0x00')).to.be.revertedWith(
      'Value is not equal to fee'
    )

    await token.transferAndCall(
      kvOracle.target,
      toEther(5),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'bool'], [0, false])
    )
    assert.equal((await nwlOpController.getOperators([0]))[0][3], true)

    await token.transferAndCall(
      kvOracle.target,
      toEther(5),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'bool'], [0, true])
    )
    assert.equal((await wlOpController.getOperators([0]))[0][3], true)
  })
})
