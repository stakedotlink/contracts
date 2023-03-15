import { assert } from 'chai'
import { toEther, deploy, fromEther } from '../../utils/helpers'
import { CurveFee, CurvePoolMock } from '../../../typechain-types'

describe('CurveFee', () => {
  let curveFee: CurveFee
  let curvePool: CurvePoolMock

  beforeEach(async () => {
    curvePool = (await deploy('CurvePoolMock', [toEther(5)])) as CurvePoolMock
    curveFee = (await deploy('CurveFee', [curvePool.address, 0, 0, 100, 1000])) as CurveFee
  })

  it('getFee should work correctly', async () => {
    assert.equal(fromEther(await curveFee.getFee(toEther(6), toEther(6))), 0.9)
    assert.equal(fromEther(await curveFee.getFee(toEther(6), toEther(8))), 2.7)
    assert.equal(fromEther(await curveFee.getFee(toEther(6), toEther(5))), 0.05)
    assert.equal(fromEther(await curveFee.getFee(toEther(6), toEther(4))), 0.04)
  })
})
