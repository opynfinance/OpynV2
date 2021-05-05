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
import {createTokenAmount, createValidExpiry} from '../utils'
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
}

contract('Short Call Spread Option closed before expiry flow', ([accountOwner1, nakedBuyer, accountOwner2]) => {
  let expiry: number

  let addressBook: AddressBookInstance
  let calculator: MarginCalculatorInstance
  let controllerProxy: ControllerInstance
  let controllerImplementation: ControllerInstance
  let marginPool: MarginPoolInstance
  let whitelist: WhitelistInstance
  let otokenImplementation: OtokenInstance
  let otokenFactory: OtokenFactoryInstance

  // oracle modulce mock
  let oracle: MockOracleInstance

  let usdc: MockERC20Instance
  let weth: MockERC20Instance

  let lowerStrikeCall: OtokenInstance
  let higherStrikeCall: OtokenInstance
  const lowerStrike = 100
  const higherStrike = 200

  const optionsAmount = 10
  const collateralAmount = (Math.abs(higherStrike - lowerStrike) * optionsAmount) / higherStrike

  let vaultCounter1: number
  let vaultCounter2: number

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
    await whitelist.whitelistCollateral(weth.address)
    await whitelist.whitelistCollateral(usdc.address)
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
      weth.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(lowerStrike, 8),
      expiry,
      false,
    )

    const higherStrikeCallAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    higherStrikeCall = await Otoken.at(higherStrikeCallAddress)

    const lowerStrikeCallAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(lowerStrike, 8),
      expiry,
      false,
    )

    lowerStrikeCall = await Otoken.at(lowerStrikeCallAddress)

    // mint weth to user
    const accountOwner1Weth = createTokenAmount(2 * collateralAmount, wethDecimals)
    const accountOwner2Weth = createTokenAmount(higherStrike * optionsAmount, wethDecimals)
    const nakedBuyerWeth = createTokenAmount(higherStrike * optionsAmount, wethDecimals)

    await weth.mint(accountOwner1, accountOwner1Weth)
    await weth.mint(accountOwner2, accountOwner2Weth)
    await weth.mint(nakedBuyer, nakedBuyerWeth)

    // have the user approve all the weth transfers
    await weth.approve(marginPool.address, accountOwner1Weth, {from: accountOwner1})
    await weth.approve(marginPool.address, accountOwner2Weth, {from: accountOwner2})
    await weth.approve(marginPool.address, nakedBuyerWeth, {from: nakedBuyer})

    const vaultCounter1Before = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
    vaultCounter1 = vaultCounter1Before.toNumber() + 1
    const vaultCounter2Before = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner2))
    vaultCounter2 = vaultCounter2Before.toNumber() + 1
  })

  describe('Integration test: Open a short call spread and close it before expiry', () => {
    const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
    const scaledCollateralAmount = createTokenAmount(collateralAmount, wethDecimals)
    before('accountOwner2 mints the higher strike call option, sends it to accountOwner1', async () => {
      const collateralToMintLong = optionsAmount
      const scaledCollateralToMintLong = createTokenAmount(collateralToMintLong, wethDecimals)

      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: ZERO_ADDR,
          vaultId: vaultCounter2,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: higherStrikeCall.address,
          vaultId: vaultCounter2,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: weth.address,
          vaultId: vaultCounter2,
          amount: scaledCollateralToMintLong,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner2})

      // accountOwner2 transfers their higher strike Call option to accountOwner1
      await higherStrikeCall.transfer(accountOwner1, scaledOptionsAmount, {from: accountOwner2})
    })
    it('accountOwner1 should be able to open a short call spread', async () => {
      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceBefore = new BigNumber(await lowerStrikeCall.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCall.totalSupply())

      const ownerlongOtokenBalanceBefore = new BigNumber(await higherStrikeCall.balanceOf(accountOwner1))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCall.totalSupply())
      const marginPoolLongOtokenBalanceBefore = new BigNumber(await higherStrikeCall.balanceOf(marginPool.address))

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultBefore[0].shortOtokens.length, 0, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(
        vaultBefore[0].collateralAssets.length,
        0,
        'Length of the collateral array in the vault is incorrect',
      )
      assert.equal(vaultBefore[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultBefore[0].shortAmounts.length, 0, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultBefore[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultBefore[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter1,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: lowerStrikeCall.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: weth.address,
          vaultId: vaultCounter1,
          amount: scaledCollateralAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositLongOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: higherStrikeCall.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await higherStrikeCall.approve(marginPool.address, scaledOptionsAmount, {from: accountOwner1})
      await controllerProxy.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerWethBalanceAfter = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await lowerStrikeCall.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCall.totalSupply())

      const ownerlongOtokenBalanceAfter = new BigNumber(await higherStrikeCall.balanceOf(accountOwner1))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCall.totalSupply())
      const marginPoolLongOtokenBalanceAfter = new BigNumber(await higherStrikeCall.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(ownerWethBalanceBefore.minus(scaledCollateralAmount).toString(), ownerWethBalanceAfter.toString())
      assert.equal(
        marginPoolWethBalanceBefore.plus(scaledCollateralAmount).toString(),
        marginPoolWethBalanceAfter.toString(),
      )
      assert.equal(
        ownerShortOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        lowerStrikeCallSupplyBefore.plus(scaledOptionsAmount).toString(),
        lowerStrikeCallSupplyAfter.toString(),
      )

      assert.equal(
        ownerlongOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerlongOtokenBalanceAfter.toString(),
      )
      assert.equal(higherStrikeCallSupplyBefore.toString(), higherStrikeCallSupplyAfter.toString())
      assert.equal(
        marginPoolLongOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        marginPoolLongOtokenBalanceAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter1)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], lowerStrikeCall.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].collateralAssets[0], weth.address, 'Incorrect collateral asset in the vault')
      assert.equal(vaultAfter[0].longOtokens[0], higherStrikeCall.address, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(
        vaultAfter[0].shortAmounts[0].toString(),
        scaledOptionsAmount,
        'Incorrect amount of short options stored in the vault',
      )
      assert.equal(
        vaultAfter[0].collateralAmounts[0].toString(),
        scaledCollateralAmount,
        'Incorrect amount of collateral stored in the vault',
      )
      assert.equal(
        vaultAfter[0].longAmounts[0].toString(),
        scaledOptionsAmount,
        'Incorrect amount of long options stored in the vault',
      )
    })

    it('accountOwner1 should be able to close out the short call spread position before expiry', async () => {
      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceBefore = new BigNumber(await lowerStrikeCall.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCall.totalSupply())

      const ownerlongOtokenBalanceBefore = new BigNumber(await higherStrikeCall.balanceOf(accountOwner1))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCall.totalSupply())
      const marginPoolLongOtokenBalanceBefore = new BigNumber(await higherStrikeCall.balanceOf(marginPool.address))

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: weth.address,
          vaultId: vaultCounter1,
          amount: scaledCollateralAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.BurnShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: lowerStrikeCall.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.WithdrawLongOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: higherStrikeCall.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerWethBalanceAfter = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await lowerStrikeCall.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCall.totalSupply())

      const ownerlongOtokenBalanceAfter = new BigNumber(await higherStrikeCall.balanceOf(accountOwner1))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCall.totalSupply())
      const marginPoolLongOtokenBalanceAfter = new BigNumber(await higherStrikeCall.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(ownerWethBalanceBefore.plus(scaledCollateralAmount).toString(), ownerWethBalanceAfter.toString())
      assert.equal(
        marginPoolWethBalanceBefore.minus(scaledCollateralAmount).toString(),
        marginPoolWethBalanceAfter.toString(),
      )
      assert.equal(
        ownerShortOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        lowerStrikeCallSupplyBefore.minus(scaledOptionsAmount).toString(),
        lowerStrikeCallSupplyAfter.toString(),
      )

      assert.equal(
        ownerlongOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        ownerlongOtokenBalanceAfter.toString(),
      )
      assert.equal(higherStrikeCallSupplyBefore.toString(), higherStrikeCallSupplyAfter.toString())
      assert.equal(
        marginPoolLongOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        marginPoolLongOtokenBalanceAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter1)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], ZERO_ADDR, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].collateralAssets[0], ZERO_ADDR, 'Incorrect collateral asset in the vault')
      assert.equal(vaultAfter[0].longOtokens[0], ZERO_ADDR, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts[0].toString(), '0', 'Incorrect amount of short stored in the vault')
      assert.equal(
        vaultAfter[0].collateralAmounts[0].toString(),
        '0',
        'Incorrect amount of collateral stored in the vault',
      )
      assert.equal(vaultAfter[0].longAmounts[0].toString(), '0', 'Incorrect amount of long stored in the vault')
    })
    it('accountOwner2 should be able to close out the short call position before expiry', async () => {
      const collateralAmount = optionsAmount
      const scaledCollateralAmount = createTokenAmount(collateralAmount, wethDecimals)

      await higherStrikeCall.transfer(accountOwner2, scaledOptionsAmount, {from: accountOwner1})

      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner2))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceBefore = new BigNumber(await higherStrikeCall.balanceOf(accountOwner2))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCall.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner2, vaultCounter2)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: weth.address,
          vaultId: vaultCounter2,
          amount: scaledCollateralAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.BurnShortOption,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: higherStrikeCall.address,
          vaultId: vaultCounter2,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner2})

      // keep track of balances after
      const ownerWethBalanceAfter = new BigNumber(await weth.balanceOf(accountOwner2))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await higherStrikeCall.balanceOf(accountOwner2))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCall.totalSupply())

      // check balances before and after changed as expected
      assert.equal(ownerWethBalanceBefore.plus(scaledCollateralAmount).toString(), ownerWethBalanceAfter.toString())
      assert.equal(
        marginPoolWethBalanceBefore.minus(scaledCollateralAmount).toString(),
        marginPoolWethBalanceAfter.toString(),
      )
      assert.equal(
        ownerShortOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        higherStrikeCallSupplyBefore.minus(scaledOptionsAmount).toString(),
        higherStrikeCallSupplyAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVault(accountOwner2, vaultCounter2)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], ZERO_ADDR, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].collateralAssets[0], ZERO_ADDR, 'Incorrect collateral asset in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts[0].toString(), '0', 'Incorrect amount of short stored in the vault')
      assert.equal(
        vaultAfter[0].collateralAmounts[0].toString(),
        '0',
        'Incorrect amount of collateral stored in the vault',
      )
    })
  })
})
