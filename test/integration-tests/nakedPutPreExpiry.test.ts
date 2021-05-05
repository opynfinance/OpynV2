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

contract('Naked Put Option closed before expiry flow', ([accountOwner1]) => {
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
  let oracle: MockOracleInstance

  let usdc: MockERC20Instance
  let weth: MockERC20Instance

  let ethPut: OtokenInstance
  const strikePrice = 300

  const optionsAmount = 10
  const collateralAmount = optionsAmount * strikePrice
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
    // setup margin vault
    const lib = await MarginVault.new()
    // setup controller module
    await Controller.link('MarginVault', lib.address)
    controllerImplementation = await Controller.new(addressBook.address)
    // setup mock Oracle module
    oracle = await MockOracle.new(addressBook.address)
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
    // set up controller proxy
    const controllerProxyAddress = await addressBook.getController()
    controllerProxy = await Controller.at(controllerProxyAddress)

    // create the eth put option
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
    const accountOwner1Usdc = createTokenAmount(2 * collateralAmount, usdcDecimals)
    await usdc.mint(accountOwner1, accountOwner1Usdc)

    // have the user approve all the usdc transfers
    await usdc.approve(marginPool.address, accountOwner1Usdc, {from: accountOwner1})
    // get the vault counter
    const vaultCounterBefore = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
    vaultCounter = vaultCounterBefore.toNumber() + 1
  })

  describe('Integration test: Sell a naked short put and close it before expiry', () => {
    const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
    const scaledCollateralAmount = createTokenAmount(collateralAmount, usdcDecimals)
    it('Seller should be able to open a short put option', async () => {
      // Keep track of owner and pool balances
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceBefore = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const oTokenSupplyBefore = new BigNumber(await ethPut.totalSupply())

      // Check that the vault has 0 exess collateral
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0', 'Incorrect amount of excess collateral')
      assert.equal(vaultStateBefore[1], true, 'Incorrect boolean of excess collateral')

      // Check the vault state stored in the contract
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

      // keep track of owner and pool balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerOtokenBalanceAfter = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const oTokenSupplyAfter = new BigNumber(await ethPut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(
        ownerUsdcBalanceBefore.minus(scaledCollateralAmount).toString(),
        ownerUsdcBalanceAfter.toString(),
        "Incorrect change in owner's usdc balance",
      )
      assert.equal(
        marginPoolUsdcBalanceBefore.plus(scaledCollateralAmount).toString(),
        marginPoolUsdcBalanceAfter.toString(),
        "Incorrect change in margin pool's usdc balance",
      )
      assert.equal(
        ownerOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        ownerOtokenBalanceAfter.toString(),
        "Incorrect change in owner's otoken balance",
      )
      assert.equal(
        oTokenSupplyBefore.plus(scaledOptionsAmount).toString(),
        oTokenSupplyAfter.toString(),
        "Incorrect change in margin pool's otoken balance",
      )

      // Check that we have 0 excess collateral in the vault after
      const vaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0', 'Incorrect amount of excess collateral')
      assert.equal(vaultStateAfter[1], true, 'Incorrect boolean of excess collateral')

      // Check the vault state stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], ethPut.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].collateralAssets[0], usdc.address, 'Incorrect collateral asset in the vault')

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

    it('should be able to close out the short position', async () => {
      // Keep track of pool and user balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceBefore = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const oTokenSupplyBefore = new BigNumber(await ethPut.totalSupply())

      // Check that there is 0 excess collateral
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0', 'Incorrect amount of excess collateral')
      assert.equal(vaultStateBefore[1], true, 'Incorrect boolean of excess collateral')

      const actionArgs = [
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: scaledCollateralAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.BurnShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ethPut.address,
          vaultId: vaultCounter,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner1})

      // keep track of user and pool balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerOtokenBalanceAfter = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const oTokenSupplyAfter = new BigNumber(await ethPut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(ownerUsdcBalanceBefore.plus(scaledCollateralAmount).toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(
        marginPoolUsdcBalanceBefore.minus(scaledCollateralAmount).toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )
      assert.equal(ownerOtokenBalanceBefore.minus(scaledOptionsAmount).toString(), ownerOtokenBalanceAfter.toString())
      assert.equal(oTokenSupplyBefore.minus(scaledOptionsAmount).toString(), oTokenSupplyAfter.toString())

      // Check that there is 0 excess collateral after
      const vaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0', 'Incorrect amount of excess collateral')
      assert.equal(vaultStateAfter[1], true, 'Incorrect boolean of excess collateral')

      // Check the vault state stored in the contract
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
