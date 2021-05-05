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

const {time} = require('@openzeppelin/test-helpers')
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

contract('Long Call Spread Option expires Otm flow', ([accountOwner1, nakedBuyer, accountOwner2]) => {
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

  let higherStrikeCall: OtokenInstance
  let lowerStrikeCall: OtokenInstance
  const higherStrike = 200
  const lowerStrike = 100

  const optionsAmount = 10
  const collateralAmount = (Math.abs(lowerStrike - higherStrike) * optionsAmount) / lowerStrike

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
    await whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, true)
    await whitelist.whitelistProduct(weth.address, usdc.address, weth.address, false)
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
      createTokenAmount(lowerStrike, 8),
      expiry,
      false,
    )

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    const lowerStrikeCallAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(lowerStrike, 8),
      expiry,
      false,
    )

    lowerStrikeCall = await Otoken.at(lowerStrikeCallAddress)

    const higherStrikeCallAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    higherStrikeCall = await Otoken.at(higherStrikeCallAddress)

    // mint weth to user
    const accountOwner1Weth = createTokenAmount(2 * collateralAmount, wethDecimals)
    const accountOwner2Weth = createTokenAmount(lowerStrike * optionsAmount, wethDecimals)
    const nakedBuyerWeth = createTokenAmount(lowerStrike * optionsAmount, wethDecimals)
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

  describe('Integration test: Close a long call spread after it expires OTM', () => {
    const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
    const expirySpotPrice = 50
    before(
      'accountOwner2 mints the lower strike call option, sends it to accountOwner1. accountOwner1 opens a long call spread',
      async () => {
        const collateralToMintLong = optionsAmount
        const scaledCollateralAmount = createTokenAmount(collateralToMintLong, wethDecimals)

        const actionArgsAccountOwner2 = [
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
            asset: lowerStrikeCall.address,
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
            amount: scaledCollateralAmount,
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await controllerProxy.operate(actionArgsAccountOwner2, {from: accountOwner2})

        // accountOwner2 transfers their lower strike call option to accountOwner1
        await lowerStrikeCall.transfer(accountOwner1, scaledOptionsAmount, {from: accountOwner2})

        const actionArgsAccountOwner1 = [
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
            asset: higherStrikeCall.address,
            vaultId: vaultCounter1,
            amount: scaledOptionsAmount,
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositLongOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: lowerStrikeCall.address,
            vaultId: vaultCounter1,
            amount: scaledOptionsAmount,
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await lowerStrikeCall.approve(marginPool.address, scaledOptionsAmount, {from: accountOwner1})
        await controllerProxy.operate(actionArgsAccountOwner1, {from: accountOwner1})
      },
    )

    it('accountOwner1: close an OTM long call spread position after expiry', async () => {
      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerHigherStrikeCallBalanceBefore = new BigNumber(await higherStrikeCall.balanceOf(accountOwner1))
      const ownerLowerStrikeCallBalanceBefore = new BigNumber(await lowerStrikeCall.balanceOf(accountOwner1))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCall.totalSupply())
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCall.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      // Set the oracle price
      if ((await time.latest()) < expiry) {
        await time.increaseTo(expiry + 2)
      }
      const scaledETHPrice = createTokenAmount(expirySpotPrice, 8)
      const scaledUSDCPrice = createTokenAmount(1)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, scaledETHPrice, true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, scaledUSDCPrice, true)

      // Check that after expiry, the vault excess balance has updated as expected
      const vaultStateBeforeSettlement = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBeforeSettlement[0].toString(), '0')
      assert.equal(vaultStateBeforeSettlement[1], true)

      const actionArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter1,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerWethBalanceAfter = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))

      const ownerHigherStrikeCallBalanceAfter = new BigNumber(await higherStrikeCall.balanceOf(accountOwner1))
      const ownerLowerStrikeCallBalanceAfter = new BigNumber(await lowerStrikeCall.balanceOf(accountOwner1))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCall.totalSupply())
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCall.totalSupply())

      // check balances before and after changed as expected
      assert.equal(ownerWethBalanceBefore.toString(), ownerWethBalanceAfter.toString())
      assert.equal(marginPoolWethBalanceBefore.toString(), marginPoolWethBalanceAfter.toString())
      assert.equal(ownerHigherStrikeCallBalanceBefore.toString(), ownerHigherStrikeCallBalanceAfter.toString())
      assert.equal(ownerLowerStrikeCallBalanceBefore.toString(), ownerLowerStrikeCallBalanceAfter.toString())
      assert.equal(higherStrikeCallSupplyBefore.toString(), higherStrikeCallSupplyAfter.toString())
      assert.equal(
        lowerStrikeCallSupplyBefore.minus(scaledOptionsAmount).toString(),
        lowerStrikeCallSupplyAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter1)
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

    it('nakedBuyer: redeem the higher strike OTM call option after expiry', async () => {
      // accountOwner1 transfers their higher strike call option to the naked buyer
      await higherStrikeCall.transfer(nakedBuyer, scaledOptionsAmount, {from: accountOwner1})

      // Keep track of balances before
      const nakedBuyerWethBalanceBefore = new BigNumber(await weth.balanceOf(nakedBuyer))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const nakedBuyerOtokenBalanceBefore = new BigNumber(await higherStrikeCall.balanceOf(nakedBuyer))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCall.totalSupply())

      const actionArgs = [
        {
          actionType: ActionType.Redeem,
          owner: nakedBuyer,
          secondAddress: nakedBuyer,
          asset: higherStrikeCall.address,
          vaultId: '0',
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: nakedBuyer})

      // keep track of balances after
      const nakedBuyerWethBalanceAfter = new BigNumber(await weth.balanceOf(nakedBuyer))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))
      const nakedBuyerOtokenBalanceAfter = new BigNumber(await higherStrikeCall.balanceOf(nakedBuyer))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCall.totalSupply())

      // check balances before and after changed as expected
      assert.equal(nakedBuyerWethBalanceBefore.toString(), nakedBuyerWethBalanceAfter.toString())
      assert.equal(marginPoolWethBalanceBefore.toString(), marginPoolWethBalanceAfter.toString())
      assert.equal(
        nakedBuyerOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        nakedBuyerOtokenBalanceAfter.toString(),
      )
      assert.equal(
        higherStrikeCallSupplyBefore.minus(scaledOptionsAmount).toString(),
        higherStrikeCallSupplyAfter.toString(),
      )
    })

    it('accountOwner2: close an OTM short call position after expiry', async () => {
      const scaledCollateralAmount = createTokenAmount(optionsAmount, wethDecimals)

      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner2))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerHigherStrikeCallBalanceBefore = new BigNumber(await higherStrikeCall.balanceOf(accountOwner2))
      const ownerLowerStrikeCallBalanceBefore = new BigNumber(await lowerStrikeCall.balanceOf(accountOwner2))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCall.totalSupply())
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCall.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner2, vaultCounter2)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), scaledCollateralAmount)
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: ZERO_ADDR,
          vaultId: vaultCounter2,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner2})

      // keep track of balances after
      const ownerWethBalanceAfter = new BigNumber(await weth.balanceOf(accountOwner2))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))

      const ownerHigherStrikeCallBalanceAfter = new BigNumber(await higherStrikeCall.balanceOf(accountOwner2))
      const ownerLowerStrikeCallBalanceAfter = new BigNumber(await lowerStrikeCall.balanceOf(accountOwner2))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCall.totalSupply())
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCall.totalSupply())

      // check balances before and after changed as expected
      assert.equal(ownerWethBalanceBefore.plus(scaledCollateralAmount).toString(), ownerWethBalanceAfter.toString())
      assert.equal(
        marginPoolWethBalanceBefore.minus(scaledCollateralAmount).toString(),
        marginPoolWethBalanceAfter.toString(),
      )
      assert.equal(ownerHigherStrikeCallBalanceBefore.toString(), ownerHigherStrikeCallBalanceAfter.toString())
      assert.equal(ownerLowerStrikeCallBalanceBefore.toString(), ownerLowerStrikeCallBalanceAfter.toString())
      assert.equal(higherStrikeCallSupplyBefore.toString(), higherStrikeCallSupplyAfter.toString())
      assert.equal(lowerStrikeCallSupplyBefore.toString(), lowerStrikeCallSupplyAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVault(accountOwner2, vaultCounter2)
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
  })
})
