import {
  MockERC20Instance,
  MarginCalculatorInstance,
  AddressBookInstance,
  MockOracleInstance,
  OtokenInstance,
  ControllerInstance,
  WhitelistInstance,
  MarginPoolInstance,
  OtokenFactoryInstance,
} from '../../build/types/truffle-types'
import {
  createTokenAmount,
  createValidExpiry,
  createScaledNumber as scaleNum,
  createScaledBigNumber as scaleBigNum,
  calcRelativeDiff,
} from '../utils'
import BigNumber from 'bignumber.js'

const {expectRevert, time} = require('@openzeppelin/test-helpers')

const AddressBook = artifacts.require('AddressBook.sol')
const MockOracle = artifacts.require('MockOracle.sol')
const Otoken = artifacts.require('Otoken.sol')
const MockERC20 = artifacts.require('MockERC20.sol')
const MarginCalculator = artifacts.require('MarginCalculator.sol')
const Whitelist = artifacts.require('Whitelist.sol')
const MarginPool = artifacts.require('MarginPool.sol')
const Controller = artifacts.require('Controller.sol')
const MarginVault = artifacts.require('MarginVault.sol')
const OTokenFactory = artifacts.require('OtokenFactory.sol')
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
}

contract('Naked margin: put position pre expiry', ([owner, accountOwner1, liquidator]) => {
  const usdcDecimals = 6
  const wethDecimals = 18
  const vaultType = web3.eth.abi.encodeParameter('uint256', 1)
  const oracleDeviation = 0.05
  const oracleDeviationValue = scaleNum(oracleDeviation, 27)
  const productSpotShockValue = scaleBigNum(0.75, 27)
  // array of time to expiry
  const day = 60 * 60 * 24
  const timeToExpiry = [day * 7, day * 14, day * 28, day * 42, day * 56]
  // array of upper bound value correspond to time to expiry
  const expiryToValue = [
    scaleNum(0.1678, 27),
    scaleNum(0.237, 27),
    scaleNum(0.3326, 27),
    scaleNum(0.4032, 27),
    scaleNum(0.4603, 27),
  ]
  const usdcDust = scaleNum(1, usdcDecimals)
  const shortStrike = 2000
  const isPut = true
  const shortAmount = 1

  let addressBook: AddressBookInstance
  let calculator: MarginCalculatorInstance
  let controllerProxy: ControllerInstance
  let controllerImplementation: ControllerInstance
  let marginPool: MarginPoolInstance
  let whitelist: WhitelistInstance
  let otokenImplementation: OtokenInstance
  let otokenFactory: OtokenFactoryInstance
  let oracle: MockOracleInstance
  let usdc: MockERC20Instance
  let weth: MockERC20Instance
  let shortOtoken: OtokenInstance

  let optionExpiry: BigNumber

  const errorDelta = 0.1

  before('set up contracts', async () => {
    // setup usdc and weth
    usdc = await MockERC20.new('USDC', 'USDC', usdcDecimals)
    weth = await MockERC20.new('WETH', 'WETH', wethDecimals)

    // initiate addressbook first.
    addressBook = await AddressBook.new()
    // setup margin pool
    marginPool = await MarginPool.new(addressBook.address)
    // setup margin vault
    const lib = await MarginVault.new()
    // setup controllerProxy module
    await Controller.link('MarginVault', lib.address)
    controllerImplementation = await Controller.new(addressBook.address)
    // setup mock Oracle module
    oracle = await MockOracle.new(addressBook.address)
    // setup calculator
    calculator = await MarginCalculator.new(oracle.address)
    // setup whitelist module
    whitelist = await Whitelist.new(addressBook.address)
    // setup otoken
    otokenImplementation = await Otoken.new()
    // setup factory
    otokenFactory = await OTokenFactory.new(addressBook.address)

    // config whitelist module
    await whitelist.whitelistCollateral(usdc.address)
    await whitelist.whitelistCollateral(weth.address)
    whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, isPut)

    // config addressbook
    await addressBook.setOracle(oracle.address)
    await addressBook.setMarginCalculator(calculator.address)
    await addressBook.setWhitelist(whitelist.address)
    await addressBook.setMarginPool(marginPool.address)
    await addressBook.setOtokenFactory(otokenFactory.address)
    await addressBook.setOtokenImpl(otokenImplementation.address)
    await addressBook.setController(controllerImplementation.address)

    const controllerProxyAddress = await addressBook.getController()
    controllerProxy = await Controller.at(controllerProxyAddress)

    // config calculator
    await calculator.setSpotShock(weth.address, usdc.address, usdc.address, isPut, productSpotShockValue)
    await calculator.setOracleDeviation(oracleDeviationValue, {from: owner})
    await calculator.setCollateralDust(usdc.address, usdcDust, {from: owner})
    for (let i = 0; i < expiryToValue.length; i++) {
      // set for put product
      await calculator.setTimeToExpiryValue(
        weth.address,
        usdc.address,
        usdc.address,
        isPut,
        timeToExpiry[i],
        expiryToValue[i],
        {from: owner},
      )
      await calculator.setProductTimeToExpiry(weth.address, usdc.address, usdc.address, isPut, timeToExpiry[i], {
        from: owner,
      })
    }

    const now = (await time.latest()).toNumber()
    optionExpiry = new BigNumber(createValidExpiry(now, 14))

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(shortStrike, 8),
      optionExpiry,
      isPut,
    )

    const shortOtokenAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(shortStrike, 8),
      optionExpiry,
      isPut,
    )

    shortOtoken = await Otoken.at(shortOtokenAddress)

    // mint usdc to user
    await usdc.mint(accountOwner1, createTokenAmount(10000, usdcDecimals))
    await usdc.mint(liquidator, createTokenAmount(10000, usdcDecimals))
  })

  describe('open position - update price far OTM - update price to go underwater - update price to go overcollateral - update price to go underwater & fully liquidate', () => {
    let vaultCounter: BigNumber
    let scaledUnderlyingPrice: BigNumber
    let roundId: BigNumber

    it('should open position', async () => {
      // set underlying price in oracle
      const underlyingPrice = 2300
      scaledUnderlyingPrice = scaleBigNum(underlyingPrice, 8)
      await oracle.setRealTimePrice(weth.address, scaledUnderlyingPrice)

      vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)

      const collateralToDeposit = await calculator.getNakedMarginRequired(
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
          amount: collateralToDeposit.toString(),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      const userUsdcBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const poolUsdcBefore = new BigNumber(await usdc.balanceOf(marginPool.address))

      await usdc.approve(marginPool.address, collateralToDeposit.toString(), {from: accountOwner1})
      await controllerProxy.operate(mintArgs, {from: accountOwner1})

      const userUsdcAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const poolUsdcAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
      const userVaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter)

      assert.equal(
        userUsdcBefore.minus(userUsdcAfter).toString(),
        collateralToDeposit.toString(),
        'User balance after openining position mismatch',
      )
      assert.equal(
        poolUsdcAfter.minus(collateralToDeposit).toString(),
        poolUsdcBefore.toString(),
        'Pool balance after openining position mismatch',
      )
      assert.equal(
        userVaultAfter[0].collateralAmounts[0].toString(),
        collateralToDeposit.toString(),
        'User vault collateral amount mismatch',
      )
      assert.equal(
        userVaultAfter[0].shortAmounts[0].toString(),
        createTokenAmount(shortAmount),
        'User vault short amount mismatch',
      )
      assert.equal(userVaultAfter[1].toString(), '1', 'User vault type mismatch')
      assert.equal(
        userVaultAfter[2].toString(),
        new BigNumber(await time.latest()).toString(),
        'User vault latest update timestamp mismatch',
      )
    })

    it('update price, option goes far OTM, collateral required decrease, user should be able to remove excess collateral', async () => {
      const underlyingPrice = 3000
      scaledUnderlyingPrice = scaleBigNum(underlyingPrice, 8)
      await oracle.setRealTimePrice(weth.address, scaledUnderlyingPrice)

      const collateralNeeded = await calculator.getNakedMarginRequired(
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
      const userVaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const amountToWithdraw = new BigNumber(userVaultBefore[0].collateralAmounts[0]).minus(collateralNeeded)
      const withdrawArgs = [
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter.toString(),
          amount: amountToWithdraw.toString(),
          index: '0',
          data: ZERO_ADDR,
        },
      ]
      const userCollateralBefore = new BigNumber(await usdc.balanceOf(accountOwner1))

      await controllerProxy.operate(withdrawArgs, {from: accountOwner1})

      const userVaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const userCollateralAfter = new BigNumber(await usdc.balanceOf(accountOwner1))

      assert.equal(
        userCollateralAfter.toString(),
        userCollateralBefore.plus(amountToWithdraw).toString(),
        'User collateral after withdraw excess mismatch',
      )
      assert.equal(
        userVaultBefore[0].collateralAmounts[0].toString(),
        new BigNumber(userVaultAfter[0].collateralAmounts[0]).plus(amountToWithdraw).toString(),
        'Vault collateral after withdraw excess mismatch',
      )
    })

    it('update price, ATM position is underwater, should revert when user call sync()', async () => {
      const underlyingPrice = 2000
      scaledUnderlyingPrice = scaleBigNum(underlyingPrice, 8)
      await oracle.setRealTimePrice(weth.address, scaledUnderlyingPrice)

      await expectRevert(
        controllerProxy.sync(accountOwner1, vaultCounter, {from: accountOwner1}),
        'Controller: invalid final vault state',
      )

      roundId = new BigNumber(10)
      await oracle.setChainlinkRoundData(weth.address, roundId, scaledUnderlyingPrice, (await time.latest()).toString())
    })

    it('update price, OTM position is overcollateralized again, user call sync, liquidation should revert with price timestamp T at underwater', async () => {
      await shortOtoken.transfer(liquidator, createTokenAmount(shortAmount), {from: accountOwner1})

      const underlyingPrice = 3000
      scaledUnderlyingPrice = scaleBigNum(underlyingPrice, 8)
      await oracle.setRealTimePrice(weth.address, scaledUnderlyingPrice)

      await controllerProxy.sync(accountOwner1, vaultCounter, {from: accountOwner1})

      const userVault = await controllerProxy.getVault(accountOwner1, vaultCounter)

      assert.equal(
        userVault[2].toString(),
        (await time.latest()).toString(),
        'User vault latest update timestamp mismatch',
      )

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

      await expectRevert(
        controllerProxy.operate(liquidateArgs, {from: liquidator}),
        'MarginCalculator: auction timestamp should be post vault latest update',
      )

      await shortOtoken.transfer(accountOwner1, createTokenAmount(shortAmount), {from: liquidator})
    })

    it('update price, position near ATM, undercollateralized, liquidator should be able to liquidate', async () => {
      await shortOtoken.transfer(liquidator, createTokenAmount(shortAmount), {from: accountOwner1})

      const underlyingPrice = 2500
      roundId = new BigNumber(15)
      scaledUnderlyingPrice = scaleBigNum(underlyingPrice, 8)
      await oracle.setRealTimePrice(weth.address, scaledUnderlyingPrice)
      await oracle.setChainlinkRoundData(weth.address, roundId, scaledUnderlyingPrice, (await time.latest()).toString())

      // advance time
      await time.increase(600)

      const isLiquidatable = await controllerProxy.isLiquidatable(accountOwner1, vaultCounter.toString(), roundId)

      assert.equal(isLiquidatable[0], true, 'Vault liquidation state mismatch')

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
      const vaultBeforeLiquidation = (await controllerProxy.getVault(accountOwner1, vaultCounter.toString()))[0]

      await controllerProxy.operate(liquidateArgs, {from: liquidator})

      const liquidatorCollateralBalanceAfter = new BigNumber(await usdc.balanceOf(liquidator))
      const vaultAfterLiquidation = (await controllerProxy.getVault(accountOwner1, vaultCounter.toString()))[0]

      assert.equal(vaultAfterLiquidation.shortAmounts[0].toString(), '0', 'Vault was not fully liquidated')
      assert.isAtMost(
        calcRelativeDiff(
          vaultAfterLiquidation.collateralAmounts[0],
          new BigNumber(vaultBeforeLiquidation.collateralAmounts[0]).minus(isLiquidatable[1]),
        ).toNumber(),
        errorDelta,
        'Vault collateral mismatch after liquidation',
      )
      assert.equal(
        liquidatorCollateralBalanceAfter.toString(),
        liquidatorCollateralBalanceBefore.plus(isLiquidatable[1].toString()).toString(),
        'Liquidator collateral balance mismatch after liquidation',
      )
    })
  })
})
