import {
  MarginCalculatorInstance,
  MockERC20Instance,
  MockOracleInstance,
  MockWhitelistModuleInstance,
  MarginPoolInstance,
  ControllerInstance,
  AddressBookInstance,
  OwnedUpgradeabilityProxyInstance,
  MockOtokenInstance,
} from '../../build/types/truffle-types'
import BigNumber from 'bignumber.js'
import {
  createScaledNumber as scaleNum,
  createScaledBigNumber as scaleBigNum,
  createScaledNumber,
  createTokenAmount,
  calcRelativeDiff,
} from '../utils'

const {expectRevert, time} = require('@openzeppelin/test-helpers')

const CallTester = artifacts.require('CallTester.sol')
const MockERC20 = artifacts.require('MockERC20.sol')
const MockOtoken = artifacts.require('MockOtoken.sol')
const MockOracle = artifacts.require('MockOracle.sol')
const OwnedUpgradeabilityProxy = artifacts.require('OwnedUpgradeabilityProxy.sol')
const MarginCalculator = artifacts.require('MarginCalculator.sol')
const MockWhitelistModule = artifacts.require('MockWhitelistModule.sol')
const AddressBook = artifacts.require('AddressBook.sol')
const MarginPool = artifacts.require('MarginPool.sol')
const Controller = artifacts.require('Controller.sol')
const MarginVault = artifacts.require('MarginVault.sol')

BigNumber.config({ROUNDING_MODE: BigNumber.ROUND_DOWN})

// address(0)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

enum ActionType {
  OpenVault,
  MintShortOption,
  BurnShortOption,
  DepositLongOption,
  WithdrawLongOption,
  DepositCollateral,
  WithdrawCollateral,
  SettleVault,
  Redeem,
  Call,
  Liquidate,
  InvalidAction,
}

contract('Controller: naked margin', ([owner, accountOwner1, liquidator]) => {
  // ERC20 mock
  let usdc: MockERC20Instance
  let weth: MockERC20Instance
  let weth2: MockERC20Instance
  // Oracle module
  let oracle: MockOracleInstance
  // calculator module
  let calculator: MarginCalculatorInstance
  // margin pool module
  let marginPool: MarginPoolInstance
  // whitelist module mock
  let whitelist: MockWhitelistModuleInstance
  // addressbook module mock
  let addressBook: AddressBookInstance
  // controller module
  let controllerImplementation: ControllerInstance
  let controllerProxy: ControllerInstance

  const usdcDecimals = 6
  const wethDecimals = 18
  const oracleDeviation = 0.05
  const oracleDeviationValue = scaleNum(oracleDeviation, 27)
  const productSpotShockValue = scaleBigNum(0.75, 27)
  // array of time to expiry
  const day = 60 * 24
  const timeToExpiry = [day * 7, day * 14, day * 28, day * 42, day * 56]
  // array of upper bound value correspond to time to expiry
  const expiryToValue = [
    scaleNum(0.1678, 27),
    scaleNum(0.237, 27),
    scaleNum(0.3326, 27),
    scaleNum(0.4032, 27),
    scaleNum(0.4603, 27),
  ]
  const wethDust = scaleNum(0.1, wethDecimals)
  const usdcDust = scaleNum(1, usdcDecimals)

  const errorDelta = 0.1

  before('Deployment', async () => {
    // addressbook deployment
    addressBook = await AddressBook.new()
    // ERC20 deployment
    usdc = await MockERC20.new('USDC', 'USDC', usdcDecimals)
    weth = await MockERC20.new('WETH', 'WETH', wethDecimals)
    weth2 = await MockERC20.new('WETH', 'WETH', wethDecimals)
    // deploy Oracle module
    oracle = await MockOracle.new(addressBook.address, {from: owner})
    // calculator deployment
    calculator = await MarginCalculator.new(oracle.address)
    // margin pool deployment
    marginPool = await MarginPool.new(addressBook.address)
    // whitelist module
    whitelist = await MockWhitelistModule.new()
    // set margin pool in addressbook
    await addressBook.setMarginPool(marginPool.address)
    // set calculator in addressbook
    await addressBook.setMarginCalculator(calculator.address)
    // set oracle in AddressBook
    await addressBook.setOracle(oracle.address)
    // set whitelist module address
    await addressBook.setWhitelist(whitelist.address)
    // deploy Controller module
    const lib = await MarginVault.new()
    await Controller.link('MarginVault', lib.address)
    controllerImplementation = await Controller.new()

    // set controller address in AddressBook
    await addressBook.setController(controllerImplementation.address, {from: owner})

    // check controller deployment
    const controllerProxyAddress = await addressBook.getController()
    controllerProxy = await Controller.at(controllerProxyAddress)
    const proxy: OwnedUpgradeabilityProxyInstance = await OwnedUpgradeabilityProxy.at(controllerProxyAddress)

    assert.equal(await proxy.proxyOwner(), addressBook.address, 'Proxy owner address mismatch')
    assert.equal(await controllerProxy.owner(), owner, 'Controller owner address mismatch')
    assert.equal(await controllerProxy.systemPartiallyPaused(), false, 'system is partially paused')

    // make everyone rich
    await usdc.mint(accountOwner1, createTokenAmount(10000, usdcDecimals))
    await weth.mint(accountOwner1, createTokenAmount(10000, wethDecimals))

    // set calculator configs
    // whitelist collateral
    await whitelist.whitelistCollateral(usdc.address)
    await whitelist.whitelistCollateral(weth.address)
    // set product spot shock value
    await calculator.setSpotShock(weth.address, usdc.address, usdc.address, true, productSpotShockValue)
    await calculator.setSpotShock(weth.address, usdc.address, weth.address, false, productSpotShockValue)
    // set oracle deviation
    await calculator.setOracleDeviation(oracleDeviationValue, {from: owner})
    // set WETH dust amount
    await calculator.setCollateralDust(weth.address, wethDust, {from: owner})
    // set USDC dust amount
    await calculator.setCollateralDust(usdc.address, usdcDust, {from: owner})
    // set time to expiry and each upper bound value
    for (let i = 0; i < expiryToValue.length; i++) {
      // set for put product
      await calculator.setTimeToExpiryValue(
        weth.address,
        usdc.address,
        usdc.address,
        true,
        timeToExpiry[i],
        expiryToValue[i],
        {from: owner},
      )
      await calculator.setProductTimeToExpiry(weth.address, usdc.address, usdc.address, true, timeToExpiry[i], {
        from: owner,
      })

      // set for call product
      await calculator.setTimeToExpiryValue(
        weth.address,
        usdc.address,
        weth.address,
        false,
        timeToExpiry[i],
        expiryToValue[i],
        {from: owner},
      )
      await calculator.setProductTimeToExpiry(weth.address, usdc.address, weth.address, false, timeToExpiry[i], {
        from: owner,
      })
    }
  })

  describe('settle naked margin vault', async () => {
    before('open position, and set time past expiry', async () => {
      const shortAmount = 1
      const shortStrike = 100
      const underlyingPrice = 150
      const scaledUnderlyingPrice = scaleBigNum(underlyingPrice, 8)
      const isPut = true
      const optionExpiry = new BigNumber(await time.latest()).plus(timeToExpiry[0])

      const shortOtoken = await MockOtoken.new()
      await shortOtoken.init(
        addressBook.address,
        weth.address,
        usdc.address,
        usdc.address,
        scaleNum(shortStrike),
        optionExpiry,
        isPut,
      )
      // whitelist otoken
      await whitelist.whitelistOtoken(shortOtoken.address)
      // set underlying price in oracle
      await oracle.setRealTimePrice(weth.address, scaledUnderlyingPrice)

      // open position
      const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
      const vaultType = web3.eth.abi.encodeParameter('uint256', 1)
      // const collateralAmount = createTokenAmount(shortStrike, usdcDecimals)
      const collateralAmount = await calculator.getNakedMarginRequired(
        weth.address,
        usdc.address,
        usdc.address,
        createTokenAmount(shortAmount),
        createTokenAmount(shortStrike),
        scaledUnderlyingPrice,
        optionExpiry,
        usdcDecimals,
        isPut,
      )

      const mintArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter.toString(),
          amount: '0',
          index: '0',
          data: vaultType,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: shortOtoken.address,
          vaultId: vaultCounter.toString(),
          amount: createTokenAmount(shortAmount),
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter.toString(),
          amount: collateralAmount.toString(),
          index: '0',
          data: ZERO_ADDR,
        },
      ]
      await usdc.approve(marginPool.address, collateralAmount.toString(), {from: accountOwner1})
      await controllerProxy.operate(mintArgs, {from: accountOwner1})

      // go to expiry
      await time.increase(optionExpiry.plus(10).toString())
      const ethPriceAtExpiry = 70
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, optionExpiry, createScaledNumber(1), true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(
        weth.address,
        optionExpiry,
        createScaledNumber(ethPriceAtExpiry),
        true,
      )
    })

    it('should revert settling an expired undercollateralized naked margin vault', async () => {
      const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))

      // settle the secont vault (with only long otoken in it)
      const settleArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter.toString(),
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await expectRevert(
        controllerProxy.operate(settleArgs, {from: accountOwner1}),
        'Controller: can not settle undercollateralized vault',
      )
    })
  })

  describe('Naked margin position: full liquidation put position', () => {
    const shortAmount = 1
    const shortStrike = 100
    const isPut = true

    let shortOtoken: MockOtokenInstance
    let requiredMargin: BigNumber
    let vaultCounter: BigNumber

    before('Deploy new short otoken, and open naked position', async () => {
      const underlyingPrice = 150
      const scaledUnderlyingPrice = scaleBigNum(underlyingPrice, 8)
      const optionExpiry = new BigNumber(await time.latest()).plus(timeToExpiry[0])

      shortOtoken = await MockOtoken.new()
      await shortOtoken.init(
        addressBook.address,
        weth.address,
        usdc.address,
        usdc.address,
        scaleNum(shortStrike),
        optionExpiry,
        isPut,
      )
      // whitelist otoken
      await whitelist.whitelistOtoken(shortOtoken.address)
      // set underlying price in oracle
      await oracle.setRealTimePrice(weth.address, scaledUnderlyingPrice)

      // open position
      vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
      const vaultType = web3.eth.abi.encodeParameter('uint256', 1)
      requiredMargin = new BigNumber(
        await calculator.getNakedMarginRequired(
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(shortAmount),
          createTokenAmount(shortStrike),
          scaledUnderlyingPrice,
          optionExpiry,
          usdcDecimals,
          isPut,
        ),
      )

      const mintArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter.toString(),
          amount: '0',
          index: '0',
          data: vaultType,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: shortOtoken.address,
          vaultId: vaultCounter.toString(),
          amount: createTokenAmount(shortAmount),
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter.toString(),
          amount: requiredMargin.toString(),
          index: '0',
          data: ZERO_ADDR,
        },
      ]
      await usdc.approve(marginPool.address, requiredMargin.toString(), {from: accountOwner1})
      await controllerProxy.operate(mintArgs, {from: accountOwner1})

      const latestVaultUpdateTimestamp = new BigNumber(
        (await controllerProxy.getVault(accountOwner1, vaultCounter.toString()))[2],
      )

      assert.equal(
        latestVaultUpdateTimestamp.toString(),
        (await time.latest()).toString(),
        'Vault latest update timestamp mismatch',
      )

      console.log('vault latest update timestamp: ', latestVaultUpdateTimestamp.toString())

      // mint short otoken
      await shortOtoken.mintOtoken(liquidator, createTokenAmount(shortAmount))
    })

    it('should fully liquidate undercollateralized vault', async () => {
      // advance time
      await time.increase(1500)

      // set round id and price
      const roundId = new BigNumber(1)
      const roundPrice = 130
      const scaledRoundPrice = createTokenAmount(roundPrice)
      const auctionStartingTime = (await time.latest()).toString()
      await oracle.setChainlinkRoundData(weth.address, roundId, scaledRoundPrice, auctionStartingTime)

      // advance time
      await time.increase(1500)

      const isLiquidatable = await controllerProxy.isLiquidatable(accountOwner1, vaultCounter.toString(), roundId)

      assert.equal(isLiquidatable[0], true, 'Vault liquidation state mismatch')

      const vaultBeforeLiquidation = (await controllerProxy.getVault(accountOwner1, vaultCounter.toString()))[0]

      const liquidateArgs = [
        {
          actionType: ActionType.Liquidate,
          owner: accountOwner1,
          secondAddress: liquidator,
          asset: ZERO_ADDR,
          vaultId: vaultCounter.toString(),
          amount: createTokenAmount(shortAmount),
          index: '0',
          data: web3.eth.abi.encodeParameter('uint256', roundId.toString()),
        },
      ]

      const liquidatorCollateralBalanceBefore = new BigNumber(await usdc.balanceOf(liquidator))

      await controllerProxy.operate(liquidateArgs, {from: liquidator})

      const liquidatorCollateralBalanceAfter = new BigNumber(await usdc.balanceOf(liquidator))
      const vaultAfterLiquidation = (await controllerProxy.getVault(accountOwner1, vaultCounter.toString()))[0]

      console.log('vvv aaa lll: ', vaultAfterLiquidation.collateralAmounts[0].toString())
      console.log('vvv bbb lll: ', new BigNumber(vaultBeforeLiquidation.collateralAmounts[0]).toString())
      console.log('lll ppp: ', isLiquidatable[1].toString())

      assert.equal(vaultAfterLiquidation.shortAmounts[0].toString(), '0', 'Vault was not fully liquidated')
      assert.isAtMost(
        calcRelativeDiff(
          vaultAfterLiquidation.collateralAmounts[0],
          new BigNumber(vaultBeforeLiquidation.collateralAmounts[0]).minus(isLiquidatable[1]),
        )
          .dividedBy(10 ** usdcDecimals)
          .toNumber(),
        errorDelta,
        'Vault collateral mismatch after liquidation',
      )
      assert.isAtMost(
        calcRelativeDiff(liquidatorCollateralBalanceAfter, liquidatorCollateralBalanceBefore.plus(isLiquidatable[1]))
          .dividedBy(10 ** usdcDecimals)
          .toNumber(),
        errorDelta,
        'Liquidator collateral balance mismatch after liquidation',
      )
    })

    it('should be able to withdraw remaining collateral', async () => {
      const vaultAfterLiquidation = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

      const withdrawArgs = [
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter.toString(),
          amount: vaultAfterLiquidation.collateralAmounts[0],
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      const userCollateralBefore = new BigNumber(await usdc.balanceOf(accountOwner1))

      await controllerProxy.operate(withdrawArgs, {from: accountOwner1})

      const userCollateralAfter = new BigNumber(await usdc.balanceOf(accountOwner1))

      assert.equal(
        userCollateralAfter.toString(),
        userCollateralBefore.plus(vaultAfterLiquidation.collateralAmounts[0]).toString(),
        'User collateral after withdraw remaining collateral mismatch',
      )
    })
  })

  describe('Naked margin position: full liquidation call position', () => {
    const shortAmount = 1
    const shortStrike = 1500
    const isPut = false

    let shortOtoken: MockOtokenInstance
    let requiredMargin: BigNumber
    let vaultCounter: BigNumber

    before('Deploy new short otoken, and open naked position', async () => {
      const underlyingPrice = 1000
      const scaledUnderlyingPrice = scaleBigNum(underlyingPrice, 8)
      const optionExpiry = new BigNumber(await time.latest()).plus(timeToExpiry[0])

      shortOtoken = await MockOtoken.new()
      await shortOtoken.init(
        addressBook.address,
        weth.address,
        usdc.address,
        weth.address,
        scaleNum(shortStrike),
        optionExpiry,
        isPut,
      )
      // whitelist otoken
      await whitelist.whitelistOtoken(shortOtoken.address)
      // set underlying price in oracle
      await oracle.setRealTimePrice(weth.address, scaledUnderlyingPrice)

      // open position
      vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
      const vaultType = web3.eth.abi.encodeParameter('uint256', 1)
      requiredMargin = new BigNumber(
        await calculator.getNakedMarginRequired(
          weth.address,
          usdc.address,
          weth.address,
          createTokenAmount(shortAmount),
          createTokenAmount(shortStrike),
          scaledUnderlyingPrice,
          optionExpiry,
          wethDecimals,
          isPut,
        ),
      )

      const mintArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter.toString(),
          amount: '0',
          index: '0',
          data: vaultType,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: shortOtoken.address,
          vaultId: vaultCounter.toString(),
          amount: createTokenAmount(shortAmount),
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: weth.address,
          vaultId: vaultCounter.toString(),
          amount: requiredMargin.toString(),
          index: '0',
          data: ZERO_ADDR,
        },
      ]
      await weth.approve(marginPool.address, requiredMargin.toString(), {from: accountOwner1})
      await controllerProxy.operate(mintArgs, {from: accountOwner1})

      const latestVaultUpdateTimestamp = new BigNumber(
        (await controllerProxy.getVault(accountOwner1, vaultCounter.toString()))[2],
      )

      assert.equal(
        latestVaultUpdateTimestamp.toString(),
        (await time.latest()).toString(),
        'Vault latest update timestamp mismatch',
      )

      // mint short otoken
      await shortOtoken.mintOtoken(liquidator, createTokenAmount(shortAmount))
    })

    it('should fully liquidate undercollateralized vault', async () => {
      // advance time
      await time.increase(600)

      // set round id and price
      const roundId = new BigNumber(1)
      const roundPrice = 1150
      const scaledRoundPrice = createTokenAmount(roundPrice)
      const auctionStartingTime = (await time.latest()).toString()
      await oracle.setChainlinkRoundData(weth.address, roundId, scaledRoundPrice, auctionStartingTime)

      // advance time
      await time.increase(600)

      const isLiquidatable = await controllerProxy.isLiquidatable(accountOwner1, vaultCounter.toString(), roundId)

      assert.equal(isLiquidatable[0], true, 'Vault liquidation state mismatch')

      const vaultBeforeLiquidation = (await controllerProxy.getVault(accountOwner1, vaultCounter.toString()))[0]

      const liquidateArgs = [
        {
          actionType: ActionType.Liquidate,
          owner: accountOwner1,
          secondAddress: liquidator,
          asset: ZERO_ADDR,
          vaultId: vaultCounter.toString(),
          amount: createTokenAmount(shortAmount),
          index: '0',
          data: web3.eth.abi.encodeParameter('uint256', roundId.toString()),
        },
      ]

      const liquidatorCollateralBalanceBefore = new BigNumber(await weth.balanceOf(liquidator))

      await controllerProxy.operate(liquidateArgs, {from: liquidator})

      const liquidatorCollateralBalanceAfter = new BigNumber(await weth.balanceOf(liquidator))
      const vaultAfterLiquidation = (await controllerProxy.getVault(accountOwner1, vaultCounter.toString()))[0]

      assert.equal(vaultAfterLiquidation.shortAmounts[0].toString(), '0', 'Vault was not fully liquidated')
      assert.isAtMost(
        calcRelativeDiff(
          vaultAfterLiquidation.collateralAmounts[0],
          new BigNumber(vaultBeforeLiquidation.collateralAmounts[0]).minus(isLiquidatable[1]),
        )
          .dividedBy(10 ** wethDecimals)
          .toNumber(),
        errorDelta,
        'Vault collateral mismatch after liquidation',
      )
      assert.isAtMost(
        calcRelativeDiff(liquidatorCollateralBalanceAfter, liquidatorCollateralBalanceBefore.plus(isLiquidatable[1]))
          .dividedBy(10 ** usdcDecimals)
          .toNumber(),
        errorDelta,
        'Liquidator collateral balance mismatch after liquidation',
      )
    })

    it('should be able to withdraw remaining collateral', async () => {
      const vaultAfterLiquidation = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

      const withdrawArgs = [
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: weth.address,
          vaultId: vaultCounter.toString(),
          amount: vaultAfterLiquidation.collateralAmounts[0],
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      const userCollateralBefore = new BigNumber(await weth.balanceOf(accountOwner1))

      await controllerProxy.operate(withdrawArgs, {from: accountOwner1})

      const userCollateralAfter = new BigNumber(await weth.balanceOf(accountOwner1))

      assert.equal(
        userCollateralAfter.toString(),
        userCollateralBefore.plus(vaultAfterLiquidation.collateralAmounts[0]).toString(),
        'User collateral after withdraw remaining collateral mismatch',
      )
    })
  })

  describe('Naked margin position: partial liquidation put position', () => {
    const shortAmount = 2
    const shortStrike = 100
    const isPut = true

    let shortOtoken: MockOtokenInstance
    let requiredMargin: BigNumber
    let vaultCounter: BigNumber
    let optionExpiry: BigNumber

    before('Deploy new short otoken, and open naked position', async () => {
      const underlyingPrice = 150
      const scaledUnderlyingPrice = scaleBigNum(underlyingPrice, 8)
      optionExpiry = new BigNumber(await time.latest()).plus(timeToExpiry[0])

      shortOtoken = await MockOtoken.new()
      await shortOtoken.init(
        addressBook.address,
        weth.address,
        usdc.address,
        usdc.address,
        scaleNum(shortStrike),
        optionExpiry,
        isPut,
      )
      // whitelist otoken
      await whitelist.whitelistOtoken(shortOtoken.address)
      // set underlying price in oracle
      await oracle.setRealTimePrice(weth.address, scaledUnderlyingPrice)

      // open position
      vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
      const vaultType = web3.eth.abi.encodeParameter('uint256', 1)
      requiredMargin = new BigNumber(
        await calculator.getNakedMarginRequired(
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(shortAmount),
          createTokenAmount(shortStrike),
          scaledUnderlyingPrice,
          optionExpiry,
          usdcDecimals,
          isPut,
        ),
      )

      const mintArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter.toString(),
          amount: '0',
          index: '0',
          data: vaultType,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: shortOtoken.address,
          vaultId: vaultCounter.toString(),
          amount: createTokenAmount(shortAmount),
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter.toString(),
          amount: requiredMargin.toString(),
          index: '0',
          data: ZERO_ADDR,
        },
      ]
      await usdc.approve(marginPool.address, requiredMargin.toString(), {from: accountOwner1})
      await controllerProxy.operate(mintArgs, {from: accountOwner1})

      const latestVaultUpdateTimestamp = new BigNumber(
        (await controllerProxy.getVault(accountOwner1, vaultCounter.toString()))[2],
      )

      assert.equal(
        latestVaultUpdateTimestamp.toString(),
        (await time.latest()).toString(),
        'Vault latest update timestamp mismatch',
      )

      // mint short otoken
      await shortOtoken.mintOtoken(liquidator, createTokenAmount(shortAmount))
    })

    it('should partially liquidate undercollateralized vault', async () => {
      // advance time
      await time.increase(600)

      const shortToLiquidate = 1
      // set round id and price
      const roundId = new BigNumber(1)
      const roundPrice = 130
      const scaledRoundPrice = createTokenAmount(roundPrice)
      const auctionStartingTime = (await time.latest()).toString()
      await oracle.setChainlinkRoundData(weth.address, roundId, scaledRoundPrice, auctionStartingTime)

      // advance time
      await time.increase(600)

      const isLiquidatable = await controllerProxy.isLiquidatable(accountOwner1, vaultCounter.toString(), roundId)

      assert.equal(isLiquidatable[0], true, 'Vault liquidation state mismatch')

      const vaultBeforeLiquidation = (await controllerProxy.getVault(accountOwner1, vaultCounter.toString()))[0]

      const liquidateArgs = [
        {
          actionType: ActionType.Liquidate,
          owner: accountOwner1,
          secondAddress: liquidator,
          asset: ZERO_ADDR,
          vaultId: vaultCounter.toString(),
          amount: createTokenAmount(shortToLiquidate),
          index: '0',
          data: web3.eth.abi.encodeParameter('uint256', roundId.toString()),
        },
      ]

      const liquidatorCollateralBalanceBefore = new BigNumber(await usdc.balanceOf(liquidator))

      await controllerProxy.operate(liquidateArgs, {from: liquidator})

      const liquidatorCollateralBalanceAfter = new BigNumber(await usdc.balanceOf(liquidator))
      const vaultAfterLiquidation = (await controllerProxy.getVault(accountOwner1, vaultCounter.toString()))[0]

      assert.equal(
        vaultAfterLiquidation.shortAmounts[0].toString(),
        createTokenAmount(shortToLiquidate),
        'Vault was not partially liquidated',
      )
      assert.isAtMost(
        calcRelativeDiff(
          vaultAfterLiquidation.collateralAmounts[0],
          new BigNumber(vaultBeforeLiquidation.collateralAmounts[0]).minus(isLiquidatable[1]),
        )
          .dividedBy(10 ** usdcDecimals)
          .toNumber(),
        errorDelta,
        'Vault collateral mismatch after liquidation',
      )
      assert.isAtMost(
        calcRelativeDiff(liquidatorCollateralBalanceAfter, liquidatorCollateralBalanceBefore.plus(isLiquidatable[1]))
          .dividedBy(10 ** usdcDecimals)
          .toNumber(),
        errorDelta,
        'Liquidator collateral balance mismatch after liquidation',
      )
    })

    it('should revert liquidating the rest of debt when vault is back overcollateralized', async () => {
      const shortToLiquidate = 1
      // set round id and price
      const roundId = new BigNumber(1)
      const roundPrice = 130
      const scaledRoundPrice = createTokenAmount(roundPrice)
      const auctionStartingTime = (await time.latest()).toString()
      await oracle.setChainlinkRoundData(weth.address, roundId, scaledRoundPrice, auctionStartingTime)

      // advance time
      await time.increase(600)

      const isLiquidatable = await controllerProxy.isLiquidatable(accountOwner1, vaultCounter.toString(), roundId)

      assert.equal(isLiquidatable[0], false, 'Vault liquidation state mismatch')

      const vaultCollateral = requiredMargin.dividedBy(10 ** usdcDecimals).toString()

      const liquidateArgs = [
        {
          actionType: ActionType.Liquidate,
          owner: accountOwner1,
          secondAddress: liquidator,
          asset: ZERO_ADDR,
          vaultId: vaultCounter.toString(),
          amount: createTokenAmount(shortToLiquidate),
          index: '0',
          data: web3.eth.abi.encodeParameter('uint256', roundId.toString()),
        },
      ]

      await expectRevert(
        controllerProxy.operate(liquidateArgs, {from: liquidator}),
        'Controller: can not liquidate vault',
      )
    })

    it('should be able to remove excess collateral after partially liquidating', async () => {
      const vaultAfterLiquidation = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

      const requiredVaultMargin = await calculator.getNakedMarginRequired(
        weth.address,
        usdc.address,
        usdc.address,
        createTokenAmount(1),
        createTokenAmount(shortStrike),
        createTokenAmount(130),
        optionExpiry,
        usdcDecimals,
        isPut,
      )

      const amountAbleToWithdraw = new BigNumber(vaultAfterLiquidation.collateralAmounts[0]).minus(requiredVaultMargin)

      const withdrawArgs = [
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter.toString(),
          amount: amountAbleToWithdraw.toString(),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      const userCollateralBefore = new BigNumber(await usdc.balanceOf(accountOwner1))

      await controllerProxy.operate(withdrawArgs, {from: accountOwner1})

      const userCollateralAfter = new BigNumber(await usdc.balanceOf(accountOwner1))

      assert.equal(
        userCollateralAfter.toString(),
        userCollateralBefore.plus(amountAbleToWithdraw).toString(),
        'User collateral after withdraw available remaining collateral mismatch',
      )
    })
  })
})
