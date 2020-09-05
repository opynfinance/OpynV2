import {
  ChainLinkPricerInstance,
  OracleInstance,
  MockChainlinkAggregatorInstance,
  MockERC20Instance,
  MockCTokenInstance,
  CompoundPricerInstance,
} from '../../build/types/truffle-types'
import BigNumber from 'bignumber.js'
import {underlyingPriceToCtokenPrice} from '../utils'
const {expectRevert, time} = require('@openzeppelin/test-helpers')

const ChainlinkPricer = artifacts.require('ChainLinkPricer.sol')
const CompoundPricer = artifacts.require('CompoundPricer.sol')
const Oracle = artifacts.require('Oracle.sol')
const MockChainlinkAggregator = artifacts.require('MockChainlinkAggregator.sol')
const MockERC20 = artifacts.require('MockERC20.sol')
const MockCToken = artifacts.require('MockCToken.sol')

/**
 * scale number with 1e8
 * @param num
 */
const toChainLinkPrice = (num: number) => new BigNumber(num).times(1e8).integerValue()

contract('Pricer + Oracle', ([owner, disputer]) => {
  let wethAggregator: MockChainlinkAggregatorInstance
  // mock tokens
  let weth: MockERC20Instance
  let ceth: MockCTokenInstance
  // pricer instances
  let wethPricer: ChainLinkPricerInstance
  let cethPricer: CompoundPricerInstance
  let oracle: OracleInstance

  const lockingPeriod = 60 * 10
  const disputePeriod = 60 * 20

  before('Deploy Pricer', async () => {
    // deploy mock contracts
    oracle = await Oracle.new({from: owner})
    wethAggregator = await MockChainlinkAggregator.new()
    weth = await MockERC20.new('WETH', 'WETH', 18)
    ceth = await MockCToken.new('cETH', 'cETH')

    oracle = await Oracle.new()
    wethPricer = await ChainlinkPricer.new(weth.address, wethAggregator.address, oracle.address)
    cethPricer = await CompoundPricer.new(ceth.address, weth.address, wethPricer.address, oracle.address)
  })

  describe('get live price from chainlink pricer', () => {
    // aggregator have price in 1e8
    const ethPrice = toChainLinkPrice(300)
    before('mock data in weth aggregator', async () => {
      await wethAggregator.setLatestAnswer(ethPrice)
    })
    before('should set the wethPricer and locking period, dispute period in oracle without revert.', async () => {
      await oracle.setAssetPricer(weth.address, wethPricer.address)

      await oracle.setLockingPeriod(wethPricer.address, lockingPeriod)
      await oracle.setDisputePeriod(wethPricer.address, disputePeriod)
      await oracle.setAssetPricer(weth.address, wethPricer.address)
    })
    it('should return the price in 1e18 from oracle', async () => {
      const expectedResult = new BigNumber(300).times(1e18)
      const priceFromOracle = await oracle.getPrice(weth.address)
      assert.equal(priceFromOracle.toString(), expectedResult.toString())
    })
    it('should return the new price after submitting new answer in aggregator', async () => {
      const newPrice = toChainLinkPrice(400)
      const expectedResult = new BigNumber(400).times(1e18)
      await wethAggregator.setLatestAnswer(newPrice)
      const priceFromOracle = await oracle.getPrice(weth.address)
      assert.equal(priceFromOracle.toString(), expectedResult.toString())
    })
  })

  describe('get live price from compound pricer', () => {
    const initPrice = toChainLinkPrice(300)
    const initPrice1e18 = new BigNumber(300).times(1e18)
    const initExchangeRate = new BigNumber('200192735438752381581313918')
    const newExchangeRate = new BigNumber('200199344698159376050159462')
    before('set cToken exchange rate', async () => {
      await ceth.setExchangeRate(initExchangeRate)
      // init eth price at 300
      await wethAggregator.setLatestAnswer(initPrice)
    })
    it('should revert if pricer is not set', async () => {
      await expectRevert(oracle.getPrice(ceth.address), 'Oracle: Pricer for this asset not set.')
    })
    it('should set the wethPricer and locking period, dispute period in oracle without revert.', async () => {
      await oracle.setAssetPricer(cethPricer.address, wethPricer.address)
      await oracle.setLockingPeriod(cethPricer.address, lockingPeriod)
      await oracle.setDisputePeriod(cethPricer.address, disputePeriod)
      await oracle.setAssetPricer(ceth.address, cethPricer.address)
    })
    it('should return the price in 1e18 from oracle', async () => {
      const expectedResult = await underlyingPriceToCtokenPrice(initPrice1e18, initExchangeRate, weth)
      const priceFromOracle = await oracle.getPrice(ceth.address)
      assert.equal(priceFromOracle.toString(), expectedResult.toString())
    })
    it('should return the new cETH price after exchangeRate is updated', async () => {
      await ceth.setExchangeRate(newExchangeRate)
      const expectedResult = await underlyingPriceToCtokenPrice(initPrice1e18, newExchangeRate, weth)
      // expectedResult = 6005980340944781281  // 6.00 USD
      const priceFromOracle = await oracle.getPrice(ceth.address)
      assert.equal(priceFromOracle.toString(), expectedResult.toString())
    })
    it('should return the new cETH price after submitting new answer in aggregator', async () => {
      const newPrice = toChainLinkPrice(400)
      await wethAggregator.setLatestAnswer(newPrice)
      //
      const newPriceIn1e18 = new BigNumber(400).times(1e18)
      const expectedResult = await underlyingPriceToCtokenPrice(newPriceIn1e18, newExchangeRate, weth)
      const priceFromOracle = await oracle.getPrice(ceth.address)
      assert.equal(priceFromOracle.toString(), expectedResult.toString())
    })
  })

  describe('set expiry price', () => {
    // time order: t0, t1, t2, t3, t4
    let t0: number, t1: number, t2: number
    // p0 = price at t0 ... etc
    const p0 = toChainLinkPrice(100)
    const p1 = toChainLinkPrice(150.333)
    const p2 = toChainLinkPrice(180)

    let submitTimestamp: number
    const newExchangeRate = new BigNumber('200199344698159376050159462')

    const disputePrice1e18 = new BigNumber(450).times(1e18)

    before('setup history in aggregator', async () => {
      // set t0, t1, t2, expiry, t3, t4
      t0 = (await time.latest()).toNumber()
      // set round answers
      await wethAggregator.setRoundAnswer(0, p0)
      await wethAggregator.setRoundAnswer(1, p1)
      await wethAggregator.setRoundAnswer(2, p2)

      // set round timestamps
      await wethAggregator.setRoundTimestamp(0, t0)
      t1 = t0 + 60 * 1
      await wethAggregator.setRoundTimestamp(1, t1)
      t2 = t0 + 60 * 2
      await wethAggregator.setRoundTimestamp(2, t2)
    })

    it('should revert when setting weth expiry price before locking period is over', async () => {
      const expiryTimestamp = (t0 + t1) / 2 // between t0 and t1
      if ((await time.latest()) < expiryTimestamp) {
        // go to expiry time
        await time.increaseTo(expiryTimestamp + 2)
      }
      const roundId = 1
      await expectRevert(
        wethPricer.setExpiryPriceToOralce(expiryTimestamp, roundId),
        'Oracle: locking period is not over yet.',
      )
    })

    it('should revert when setting ceth expiry price before weth pricer has a price', async () => {
      const expiryTimestamp = (t0 + t1) / 2 // between t0 and t1
      await expectRevert(
        cethPricer.setExpiryPriceToOralce(expiryTimestamp),
        'CompoundPricer: underlying price not set yet.',
      )
    })

    it('anyone can set weth price to oracle', async () => {
      const expiryTimestamp = (t0 + t1) / 2 // between t0 and t1
      if ((await time.latest()) < expiryTimestamp + lockingPeriod) {
        await time.increaseTo(expiryTimestamp + lockingPeriod + 10)
      }
      const roundId = 1
      await wethPricer.setExpiryPriceToOralce(expiryTimestamp, roundId)
      const [priceFromOracle, isFinalized] = await oracle.getExpiryPrice(weth.address, expiryTimestamp)
      assert.equal(p1.times(1e10).toString(), priceFromOracle.toString())
      assert.equal(isFinalized, false)
      submitTimestamp = (await time.latest()).toNumber()
    })

    it('anyone can set ceth price to oracle after setting weth price', async () => {
      const expiryTimestamp = (t0 + t1) / 2 // between t0 and t1
      if ((await time.latest()) < expiryTimestamp + lockingPeriod) {
        await time.increaseTo(expiryTimestamp + lockingPeriod + 10)
      }
      await cethPricer.setExpiryPriceToOralce(expiryTimestamp)
      const [underlyingPrice, _] = await oracle.getExpiryPrice(weth.address, expiryTimestamp)
      const expectedCTokenPrice = await underlyingPriceToCtokenPrice(underlyingPrice, newExchangeRate, weth)
      const [cTokenPrice, isFinalized] = await oracle.getExpiryPrice(ceth.address, expiryTimestamp)
      assert.equal(isFinalized, false)
      assert.equal(expectedCTokenPrice.toString(), cTokenPrice.toString())
    })

    it('should revert when trying to submit weth price again', async () => {
      const expiryTimestamp = (t0 + t1) / 2 // between t0 and t1
      const roundId = 1
      await expectRevert(wethPricer.setExpiryPriceToOralce(expiryTimestamp, roundId), 'Oracle: dispute period started')
      const priceFromOracle = await oracle.getExpiryPrice(weth.address, expiryTimestamp)
      assert.equal(p1.times(1e10).toString(), priceFromOracle[0].toString())
    })

    it('should revert when dispute is called by non-disputer', async () => {
      const expiryTimestamp = (t0 + t1) / 2 // between t0 and t1
      await expectRevert(
        oracle.disputeExpiryPrice(weth.address, expiryTimestamp, disputePrice1e18),
        'Oracle: caller is not the disputer',
      )
    })

    it('should be able to dispute weth price during dispute period', async () => {
      await oracle.setDisputer(disputer)
      const expiryTimestamp = (t0 + t1) / 2 // between t0 and t1
      await oracle.disputeExpiryPrice(weth.address, expiryTimestamp, disputePrice1e18, {from: disputer})
    })

    it('should revert if dispute period is over', async () => {
      const expiryTimestamp = (t0 + t1) / 2 // between t0 and t1
      if ((await time.latest()).toNumber() < submitTimestamp + disputePeriod) {
        await time.increaseTo(submitTimestamp + disputePeriod + 100)
      }
      const randomPrice = new BigNumber(453).times(1e18)
      await expectRevert(
        oracle.disputeExpiryPrice(weth.address, expiryTimestamp, randomPrice, {from: disputer}),
        'Oracle: dispute period over',
      )
    })

    it('should get isFinalized = true after weth price dispute period', async () => {
      const expiryTimestamp = (t0 + t1) / 2 // between t0 and t1
      const [price, isFinalized] = await oracle.getExpiryPrice(weth.address, expiryTimestamp)
      assert.equal(disputePrice1e18.toString(), price.toString())
      assert.equal(isFinalized, true)
    })

    it('should get isFinalized = true after ceth price dispute period', async () => {
      const expiryTimestamp = (t0 + t1) / 2 // between t0 and t1
      const underlyingPriceForCtoken = p1.times(1e10)
      const expectedCTokenPrice = await underlyingPriceToCtokenPrice(underlyingPriceForCtoken, newExchangeRate, weth)
      const [price, isFinalized] = await oracle.getExpiryPrice(ceth.address, expiryTimestamp)
      assert.equal(price.toString(), expectedCTokenPrice.toString())
      assert.equal(isFinalized, true)
    })
  })
})
