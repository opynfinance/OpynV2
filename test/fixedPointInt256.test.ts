import {FixedPointInt256TesterInstance} from '../build/types/truffle-types'
import BigNumber from 'bignumber.js'

const {expectRevert} = require('@openzeppelin/test-helpers')

const FixedPointInt256Tester = artifacts.require('FixedPointInt256Tester.sol')

contract('FixedPointInt256 lib', () => {
  let lib: FixedPointInt256TesterInstance

  before('set up contracts', async () => {
    lib = await FixedPointInt256Tester.new()
  })

  describe('Test type conversion', () => {
    it('Should convert from unsigned integer to signed integer', async () => {
      const uint = new BigNumber(5)
      const expectedInt = new BigNumber(5)

      assert.equal(
        (await lib.testFromUint(uint)).toNumber(),
        expectedInt.toNumber(),
        'conversion from uint to int mismatch',
      )
    })

    it('Should convert from signed integer to unsigned integer', async () => {
      const int = new BigNumber(-3)
      const expectedUint = new BigNumber(3)

      assert.equal(
        (await lib.testFromInt(int)).toNumber(),
        expectedUint.toNumber(),
        'conversion from int to uint mismatch',
      )
    })
  })

  describe('Test Addition', () => {
    it('Should return 7e18 for 5e18 + 2e18', async () => {
      const a = new BigNumber(5).multipliedBy(1e18)
      const b = new BigNumber(2).multipliedBy(1e18)
      const expectedResult = new BigNumber(7).multipliedBy(1e18)

      assert.equal((await lib.testAdd(a, b)).toString(), expectedResult.toString(), 'adding result mismatch')
    })
  })

  describe('Test subtraction', () => {
    it('Should return 2e18 for 7e18 - 5e18', async () => {
      const a = new BigNumber(7).multipliedBy(1e18)
      const b = new BigNumber(5).multipliedBy(1e18)
      const expectedResult = new BigNumber(2).multipliedBy(1e18)

      assert.equal((await lib.testSub(a, b)).toString(), expectedResult.toString(), 'subtraction result mismatch')
    })
  })

  describe('Test mul', () => {
    it('Should return 10e18 for 2e18 * 5e18', async () => {
      const a = new BigNumber(2).multipliedBy(1e18)
      const b = new BigNumber(5).multipliedBy(1e18)
      const expectedResult = new BigNumber(10).multipliedBy(1e18)

      assert.equal((await lib.testMul(a, b)).toString(), expectedResult.toString(), 'multiplication result mismatch')
    })
  })

  describe('Test div', () => {
    it('Should return 2e18 for 10e18 divided by 5e18', async () => {
      const a = new BigNumber(10).multipliedBy(1e18)
      const b = new BigNumber(5).multipliedBy(1e18)
      const expectedResult = new BigNumber(2).multipliedBy(1e18)

      assert.equal((await lib.testDiv(a, b)).toString(), expectedResult.toString(), 'division result mismatch')
    })
  })

  describe('Test min', () => {
    it('Should return 3e18 between 3e18 and 5e18', async () => {
      const a = new BigNumber(3).multipliedBy(1e18)
      const b = new BigNumber(5).multipliedBy(1e18)
      const expectedResult = new BigNumber(3).multipliedBy(1e18)

      assert.equal((await lib.testMin(a, b)).toString(), expectedResult.toString(), 'minimum result mismatch')
    })

    it('Should return -2e18 between -2e18 and 2e18', async () => {
      const a = new BigNumber(-2).multipliedBy(1e18)
      const b = new BigNumber(2).multipliedBy(1e18)
      const expectedResult = new BigNumber(-2).multipliedBy(1e18)

      assert.equal((await lib.testMin(a, b)).toString(), expectedResult.toString(), 'minimum result mismatch')
    })
  })

  describe('Test max', () => {
    it('Should return 3e18 between 3e18 and 1e18', async () => {
      const a = new BigNumber(3).multipliedBy(1e18)
      const b = new BigNumber(1).multipliedBy(1e18)
      const expectedResult = new BigNumber(3).multipliedBy(1e18)

      assert.equal((await lib.testMax(a, b)).toString(), expectedResult.toString(), 'maximum result mismatch')
    })
  })
})
