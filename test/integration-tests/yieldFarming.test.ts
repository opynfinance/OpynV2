import {
  MockERC20Instance,
  MarginCalculatorInstance,
  AddressBookInstance,
  OracleInstance,
  OtokenInstance,
  ControllerInstance,
  WhitelistInstance,
  MarginPoolInstance,
  OtokenFactoryInstance,
  MockPricerInstance,
  MockCTokenInstance,
  CompoundPricerInstance,
} from '../../build/types/truffle-types'
import {createTokenAmount, createValidExpiry} from '../utils'
import BigNumber from 'bignumber.js'

const {time} = require('@openzeppelin/test-helpers')
const AddressBook = artifacts.require('AddressBook.sol')
const Oracle = artifacts.require('Oracle.sol')
const Otoken = artifacts.require('Otoken.sol')
const MockERC20 = artifacts.require('MockERC20.sol')
const MarginCalculator = artifacts.require('MarginCalculator.sol')
const Whitelist = artifacts.require('Whitelist.sol')
const MarginPool = artifacts.require('MarginPool.sol')
const Controller = artifacts.require('Controller.sol')
const MarginVault = artifacts.require('MarginVault.sol')
const OTokenFactory = artifacts.require('OtokenFactory.sol')
const MockPricer = artifacts.require('MockPricer.sol')
const MockCToken = artifacts.require('MockCToken.sol')
const CompoundPricer = artifacts.require('CompoundPricer.sol')
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
  Exercise,
  Call,
}

contract('Yield Farming: Naked Put Option closed before expiry flow', ([admin, accountOwner1, random, buyer]) => {
  let expiry: number

  let addressBook: AddressBookInstance
  let calculator: MarginCalculatorInstance
  let controllerImplementation: ControllerInstance
  let controllerProxy: ControllerInstance
  let marginPool: MarginPoolInstance
  let whitelist: WhitelistInstance
  let otokenImplementation: OtokenInstance
  let otokenFactory: OtokenFactoryInstance

  // oracle modulce mock
  let oracle: OracleInstance

  let usdc: MockERC20Instance
  let weth: MockERC20Instance

  let ethPut: OtokenInstance
  const strikePrice = 300

  const optionsAmount = 10
  const usdcCollateralAmount = optionsAmount * strikePrice
  let vaultCounter: number

  const usdcDecimals = 6
  const wethDecimals = 18

  before('set up contracts', async () => {
    const now = (await time.latest()).toNumber()
    expiry = createValidExpiry(now, 30)

    // setup usdc and weth
    usdc = await MockERC20.new('USDC', 'USDC', usdcDecimals)
    weth = await MockERC20.new('WETH', 'WETH', wethDecimals)

    // initiate addressbook first.
    addressBook = await AddressBook.new()
    // setup margin pool
    marginPool = await MarginPool.new(addressBook.address)
    // setup margin account
    const lib = await MarginVault.new()
    // setup controller module
    await Controller.link('MarginVault', lib.address)
    controllerImplementation = await Controller.new(addressBook.address)
    // setup mock Oracle module
    oracle = await Oracle.new(addressBook.address)
    // setup calculator
    calculator = await MarginCalculator.new(oracle.address)
    // setup whitelist module
    whitelist = await Whitelist.new(addressBook.address)
    await whitelist.whitelistCollateral(usdc.address)
    await whitelist.whitelistCollateral(weth.address)
    whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, true)
    whitelist.whitelistProduct(weth.address, usdc.address, weth.address, false)
    // setup otoken
    otokenImplementation = await Otoken.new()
    // setup factory
    otokenFactory = await OTokenFactory.new(addressBook.address)

    // setup address book
    await addressBook.setOracle(oracle.address)
    await addressBook.setMarginCalculator(calculator.address)
    await addressBook.setWhitelist(whitelist.address)
    await addressBook.setMarginPool(marginPool.address)
    await addressBook.setOtokenFactory(otokenFactory.address)
    await addressBook.setOtokenImpl(otokenImplementation.address)
    await addressBook.setController(controllerImplementation.address)

    const controllerProxyAddress = await addressBook.getController()
    controllerProxy = await Controller.at(controllerProxyAddress)

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(strikePrice),
      expiry,
      true,
    )
    const ethPutAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(strikePrice),
      expiry,
      true,
    )

    ethPut = await Otoken.at(ethPutAddress)

    // mint usdc to user
    const accountOwner1Usdc = createTokenAmount(2 * usdcCollateralAmount, usdcDecimals)
    usdc.mint(accountOwner1, accountOwner1Usdc)

    // have the user approve all the usdc transfers
    usdc.approve(marginPool.address, accountOwner1Usdc, {from: accountOwner1})

    const vaultCounterBefore = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
    vaultCounter = vaultCounterBefore.plus(1).toNumber()
  })

  describe('Integration test: Admin should be able te remove excess collateral sent to margin pool', () => {
    before('Seller should be able to open a short put option', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      const scaledCollateralAmount = createTokenAmount(usdcCollateralAmount, usdcDecimals)

      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ethPut.address,
          vaultId: vaultCounter,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: scaledCollateralAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner1})
    })

    it('admin should be able to remove excess collateral sent to the margin pool', async () => {
      await marginPool.setFarmer(admin, {from: admin})
      const usdcAmount = new BigNumber(15)
      const scaledUsdcAmount = createTokenAmount(usdcAmount.toNumber(), usdcDecimals)

      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))

      // random person sends usdc to margin pool
      await usdc.mint(random, scaledUsdcAmount)
      await usdc.approve(marginPool.address, usdcAmount, {from: random})
      await usdc.transfer(marginPool.address, scaledUsdcAmount, {from: random})

      const marginPoolUsdcBalanceAfterInterestEarned = new BigNumber(await usdc.balanceOf(marginPool.address))

      assert.equal(
        marginPoolUsdcBalanceBefore.plus(scaledUsdcAmount).toString(),
        marginPoolUsdcBalanceAfterInterestEarned.toString(),
        'Margin pool usdc balanace is incorrect',
      )

      // admin should be able to remove excess balance from margin pool
      await marginPool.farm(usdc.address, admin, scaledUsdcAmount)

      const marginPoolUsdcBalanceAfterInterestRemoved = new BigNumber(await usdc.balanceOf(marginPool.address))

      assert.equal(
        marginPoolUsdcBalanceBefore.toString(),
        marginPoolUsdcBalanceAfterInterestRemoved.toString(),
        'Margin pool usdc balanace is incorrect',
      )
    })
  })

  xdescribe('Integration Test: Compound yield farming', async () => {
    let cusdcEthPut: OtokenInstance
    let cusdc: MockCTokenInstance
    let comp: MockERC20Instance
    const cusdcDecimals = 8
    const compDecimals = 18
    let wethPricer: MockPricerInstance
    let cusdcPricer: CompoundPricerInstance
    const lockingPeriod = time.duration.minutes(15).toNumber()
    const disputePeriod = time.duration.minutes(15).toNumber()
    let cusdcCollateralAmount: BigNumber
    const compRewards = createTokenAmount(10, compDecimals)
    const ethPriceAtExpiry = 200
    before('deploy an ETH put option with cUSDC as collateral', async () => {
      cusdc = await MockCToken.new('cUSDC', 'cUSDC')
      comp = await MockERC20.new('COMP', 'COMP', compDecimals)
      // whitelist cusdc
      await whitelist.whitelistCollateral(cusdc.address)
      await whitelist.whitelistProduct(weth.address, usdc.address, cusdc.address, true)

      // set up the oracle
      // deply mock pricer (to get live price and set expiry price)
      wethPricer = await MockPricer.new(weth.address, oracle.address)
      await oracle.setAssetPricer(weth.address, wethPricer.address)
      await oracle.setLockingPeriod(wethPricer.address, lockingPeriod)
      await oracle.setDisputePeriod(wethPricer.address, disputePeriod)
      // sett USDC stable price in oracle
      await oracle.setStablePrice(usdc.address, createTokenAmount(1, 8))
      cusdcPricer = await CompoundPricer.new(cusdc.address, usdc.address, oracle.address)
      await oracle.setAssetPricer(cusdc.address, cusdcPricer.address)

      await otokenFactory.createOtoken(
        weth.address,
        usdc.address,
        cusdc.address,
        createTokenAmount(strikePrice),
        expiry,
        true,
      )
      const cusdcEthPutAddress = await otokenFactory.getOtoken(
        weth.address,
        usdc.address,
        cusdc.address,
        createTokenAmount(strikePrice),
        expiry,
        true,
      )

      cusdcEthPut = await Otoken.at(cusdcEthPutAddress)

      // Set the initial prices
      const cusdcPrice = 0.02
      const scaledCusdcPrice = createTokenAmount(cusdcPrice, 16) // 1 cToken = 0.02 USD
      const usdPrice = createTokenAmount(1)
      await oracle.setStablePrice(usdc.address, usdPrice)
      await cusdc.setExchangeRate(scaledCusdcPrice)

      cusdcCollateralAmount = new BigNumber(usdcCollateralAmount).div(cusdcPrice)
      const scaledCollateralAmount = createTokenAmount(cusdcCollateralAmount.toNumber(), cusdcDecimals)
      cusdc.mint(accountOwner1, scaledCollateralAmount)
      cusdc.approve(marginPool.address, scaledCollateralAmount, {from: accountOwner1})

      const vaultCounterBefore = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
      vaultCounter = vaultCounterBefore.plus(1).toNumber()

      await marginPool.setFarmer(admin, {from: admin})
    })

    it('accountOwner1 should be able to open a short put spread position', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      const scaledCollateralAmount = createTokenAmount(cusdcCollateralAmount.toNumber(), cusdcDecimals)
      // Keep track of balances before
      const ownerCusdcBalanceBefore = new BigNumber(await cusdc.balanceOf(accountOwner1))
      const marginPoolCusdcBalanceBefore = new BigNumber(await cusdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceBefore = new BigNumber(await cusdcEthPut.balanceOf(accountOwner1))
      const oTokenSupplyBefore = new BigNumber(await cusdcEthPut.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: cusdcEthPut.address,
          vaultId: vaultCounter,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: cusdc.address,
          vaultId: vaultCounter,
          amount: scaledCollateralAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerCusdcBalanceAfter = new BigNumber(await cusdc.balanceOf(accountOwner1))
      const marginPoolCusdcBalanceAfter = new BigNumber(await cusdc.balanceOf(marginPool.address))

      const ownerOtokenBalanceAfter = new BigNumber(await cusdcEthPut.balanceOf(accountOwner1))
      const oTokenSupplyAfter = new BigNumber(await cusdcEthPut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(ownerCusdcBalanceBefore.minus(scaledCollateralAmount).toString(), ownerCusdcBalanceAfter.toString())
      assert.equal(
        marginPoolCusdcBalanceBefore.plus(scaledCollateralAmount).toString(),
        marginPoolCusdcBalanceAfter.toString(),
      )
      assert.equal(ownerOtokenBalanceBefore.plus(scaledOptionsAmount).toString(), ownerOtokenBalanceAfter.toString())
      assert.equal(oTokenSupplyBefore.plus(scaledOptionsAmount).toString(), oTokenSupplyAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], cusdcEthPut.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].collateralAssets[0], cusdc.address, 'Incorrect collateral asset in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(
        vaultAfter[0].shortAmounts[0].toString(),
        scaledOptionsAmount,
        'Incorrect amount of short stored in the vault',
      )
      assert.equal(
        vaultAfter[0].collateralAmounts[0].toString(),
        scaledCollateralAmount,
        'Incorrect amount of collateral stored in the vault',
      )
    })

    it('COMP transferred as rewards to the margin pool', async () => {
      await comp.mint(marginPool.address, compRewards)
    })

    it('accountOwner1: close an ITM position after expiry', async () => {
      // Keep track of balances before
      const ownerCusdcBalanceBefore = new BigNumber(await cusdc.balanceOf(accountOwner1))
      const marginPoolCusdcBalanceBefore = new BigNumber(await cusdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceBefore = new BigNumber(await cusdcEthPut.balanceOf(accountOwner1))
      const oTokenSupplyBefore = new BigNumber(await cusdcEthPut.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      // Make the option expired
      if ((await time.latest()) < expiry) {
        await time.increaseTo(expiry + lockingPeriod + 10)
      }
      const strikePriceChange = strikePrice - ethPriceAtExpiry
      const scaledETHPrice = createTokenAmount(ethPriceAtExpiry)
      const scaledUSDCPrice = createTokenAmount(1)
      const cusdcPrice = 0.025
      const scaledCusdcPrice = createTokenAmount(cusdcPrice, 16) // 1 cToken = 0.025 USD
      await cusdc.setExchangeRate(scaledCusdcPrice)
      await oracle.setStablePrice(usdc.address, scaledUSDCPrice)
      await wethPricer.setExpiryPriceInOracle(expiry, scaledETHPrice)
      await cusdcPricer.setExpiryPriceInOracle(expiry)

      await time.increase(disputePeriod + 10)

      const collateralPayout = cusdcCollateralAmount
        .minus(new BigNumber(strikePriceChange).times(optionsAmount).div(cusdcPrice))
        .toNumber()
      const scaledPayout = createTokenAmount(collateralPayout, cusdcDecimals)

      // Check that after expiry, the vault excess balance has updated as expected
      const vaultStateBeforeSettlement = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBeforeSettlement[0].toString(), scaledPayout)
      assert.equal(vaultStateBeforeSettlement[1], true)

      const actionArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerCusdcBalanceAfter = new BigNumber(await cusdc.balanceOf(accountOwner1))
      const marginPoolCusdcBalanceAfter = new BigNumber(await cusdc.balanceOf(marginPool.address))

      const ownerOtokenBalanceAfter = new BigNumber(await cusdcEthPut.balanceOf(accountOwner1))
      const oTokenSupplyAfter = new BigNumber(await cusdcEthPut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(ownerCusdcBalanceBefore.plus(scaledPayout).toString(), ownerCusdcBalanceAfter.toString())
      assert.equal(marginPoolCusdcBalanceBefore.minus(scaledPayout).toString(), marginPoolCusdcBalanceAfter.toString())
      assert.equal(ownerOtokenBalanceBefore.toString(), ownerOtokenBalanceAfter.toString())
      assert.equal(oTokenSupplyBefore.toString(), oTokenSupplyAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 0, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts.length, 0, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')
    })

    it('Buyer: exercise ITM put option after expiry', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      // owner sells their put option
      cusdcEthPut.transfer(buyer, scaledOptionsAmount, {from: accountOwner1})
      // oracle orice decreases
      const strikePriceChange = strikePrice - ethPriceAtExpiry

      // Keep track of balances before
      const buyerCusdcBalanceBefore = new BigNumber(await cusdc.balanceOf(buyer))
      const marginPoolCusdcBalanceBefore = new BigNumber(await cusdc.balanceOf(marginPool.address))
      const buyerOtokenBalanceBefore = new BigNumber(await cusdcEthPut.balanceOf(buyer))
      const oTokenSupplyBefore = new BigNumber(await cusdcEthPut.totalSupply())

      const actionArgs = [
        {
          actionType: ActionType.Exercise,
          owner: buyer,
          secondAddress: buyer,
          asset: cusdcEthPut.address,
          vaultId: '0',
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await cusdcEthPut.approve(marginPool.address, scaledOptionsAmount, {from: buyer})
      await controllerProxy.operate(actionArgs, {from: buyer})

      // keep track of balances after
      const buyerCusdcBalanceAfter = new BigNumber(await cusdc.balanceOf(buyer))
      const marginPoolCusdcBalanceAfter = new BigNumber(await cusdc.balanceOf(marginPool.address))
      const buyerOtokenBalanceAfter = new BigNumber(await cusdcEthPut.balanceOf(buyer))
      const oTokenSupplyAfter = new BigNumber(await cusdcEthPut.totalSupply())

      const cusdcPrice = 0.025

      const payout = (strikePriceChange * optionsAmount) / cusdcPrice
      const scaledPayout = createTokenAmount(payout, cusdcDecimals)

      // check balances before and after changed as expected
      assert.equal(buyerCusdcBalanceBefore.plus(scaledPayout).toString(), buyerCusdcBalanceAfter.toString())
      assert.equal(marginPoolCusdcBalanceBefore.minus(scaledPayout).toString(), marginPoolCusdcBalanceAfter.toString())
      assert.equal(buyerOtokenBalanceBefore.minus(scaledOptionsAmount).toString(), buyerOtokenBalanceAfter.toString())
      assert.equal(oTokenSupplyBefore.minus(scaledOptionsAmount).toString(), oTokenSupplyAfter.toString())
    })
  })
})
