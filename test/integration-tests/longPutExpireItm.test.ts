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

contract('Long Put Spread Option closed ITM flow', ([accountOwner1, accountOwner2]) => {
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

  let lowerStrikePut: OtokenInstance
  let higherStrikePut: OtokenInstance
  const lowerStrike = 200
  const higherStrike = 300

  const optionsAmount = 10
  const collateralAmount = Math.abs(lowerStrike - higherStrike) * optionsAmount

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
      createTokenAmount(higherStrike, 8),
      expiry,
      true,
    )

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(lowerStrike, 8),
      expiry,
      true,
    )

    const higherStrikePutAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      true,
    )

    higherStrikePut = await Otoken.at(higherStrikePutAddress)

    const lowerStrikePutAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(lowerStrike, 8),
      expiry,
      true,
    )

    lowerStrikePut = await Otoken.at(lowerStrikePutAddress)

    // mint usdc to user
    const accountOwner1Usdc = createTokenAmount(2 * collateralAmount, usdcDecimals)
    const accountOwner2Usdc = createTokenAmount(higherStrike * optionsAmount, usdcDecimals)

    await usdc.mint(accountOwner1, accountOwner1Usdc)
    await usdc.mint(accountOwner2, accountOwner2Usdc)

    // have the user approve all the usdc transfers
    await usdc.approve(marginPool.address, accountOwner1Usdc, {from: accountOwner1})
    await usdc.approve(marginPool.address, accountOwner2Usdc, {from: accountOwner2})

    const vaultCounter1Before = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
    vaultCounter1 = vaultCounter1Before.toNumber() + 1
    const vaultCounter2Before = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner2))
    vaultCounter2 = vaultCounter2Before.toNumber() + 1
  })

  describe('Integration test: Close a long put spread after it expires ITM', () => {
    const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
    before('accountOwner2 mints the higher strike put option, sends it to accountOwner1', async () => {
      const collateralToMintLong = higherStrike * optionsAmount
      const scaledCollateralAmount = createTokenAmount(collateralToMintLong, usdcDecimals)

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
          asset: higherStrikePut.address,
          vaultId: vaultCounter2,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: usdc.address,
          vaultId: vaultCounter2,
          amount: scaledCollateralAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner2})

      // accountOwner2 transfers their higher strike put option to accountOwner1
      await higherStrikePut.transfer(accountOwner1, scaledOptionsAmount, {from: accountOwner2})
    })
    it('accountOwner1 should be able to open a long put spread', async () => {
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceBefore = new BigNumber(await lowerStrikePut.balanceOf(accountOwner1))
      const lowerStrikePutSupplyBefore = new BigNumber(await lowerStrikePut.totalSupply())

      const ownerlongOtokenBalanceBefore = new BigNumber(await higherStrikePut.balanceOf(accountOwner1))
      const higherStrikePutSupplyBefore = new BigNumber(await higherStrikePut.totalSupply())
      const marginPoolLongOtokenBalanceBefore = new BigNumber(await higherStrikePut.balanceOf(marginPool.address))

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
          asset: lowerStrikePut.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositLongOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: higherStrikePut.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await higherStrikePut.approve(marginPool.address, scaledOptionsAmount, {from: accountOwner1})
      await controllerProxy.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await lowerStrikePut.balanceOf(accountOwner1))
      const lowerStrikePutSupplyAfter = new BigNumber(await lowerStrikePut.totalSupply())

      const ownerlongOtokenBalanceAfter = new BigNumber(await higherStrikePut.balanceOf(accountOwner1))
      const higherStrikePutSupplyAfter = new BigNumber(await higherStrikePut.totalSupply())
      const marginPoolLongOtokenBalanceAfter = new BigNumber(await higherStrikePut.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(ownerUsdcBalanceBefore.toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(marginPoolUsdcBalanceBefore.toString(), marginPoolUsdcBalanceAfter.toString())
      assert.equal(
        ownerShortOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        lowerStrikePutSupplyBefore.plus(scaledOptionsAmount).toString(),
        lowerStrikePutSupplyAfter.toString(),
      )

      assert.equal(
        ownerlongOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerlongOtokenBalanceAfter.toString(),
      )
      assert.equal(higherStrikePutSupplyBefore.toString(), higherStrikePutSupplyAfter.toString())
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
      assert.equal(vaultAfter[0].collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], lowerStrikePut.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].longOtokens[0], higherStrikePut.address, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(
        vaultAfter[0].shortAmounts[0].toString(),
        scaledOptionsAmount,
        'Incorrect amount of short options stored in the vault',
      )
      assert.equal(
        vaultAfter[0].longAmounts[0].toString(),
        scaledOptionsAmount,
        'Incorrect amount of long options stored in the vault',
      )
    })

    it('accountOwner1 should be able to close out the long put spread position before expiry', async () => {
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceBefore = new BigNumber(await lowerStrikePut.balanceOf(accountOwner1))
      const lowerStrikePutSupplyBefore = new BigNumber(await lowerStrikePut.totalSupply())

      const ownerlongOtokenBalanceBefore = new BigNumber(await higherStrikePut.balanceOf(accountOwner1))
      const higherStrikePutSupplyBefore = new BigNumber(await higherStrikePut.totalSupply())
      const marginPoolLongOtokenBalanceBefore = new BigNumber(await higherStrikePut.balanceOf(marginPool.address))

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.BurnShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: lowerStrikePut.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.WithdrawLongOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: higherStrikePut.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await lowerStrikePut.balanceOf(accountOwner1))
      const lowerStrikePutSupplyAfter = new BigNumber(await lowerStrikePut.totalSupply())

      const ownerlongOtokenBalanceAfter = new BigNumber(await higherStrikePut.balanceOf(accountOwner1))
      const higherStrikePutSupplyAfter = new BigNumber(await higherStrikePut.totalSupply())
      const marginPoolLongOtokenBalanceAfter = new BigNumber(await higherStrikePut.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(ownerUsdcBalanceBefore.toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(marginPoolUsdcBalanceBefore.toString(), marginPoolUsdcBalanceAfter.toString())
      assert.equal(
        ownerShortOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        lowerStrikePutSupplyBefore.minus(scaledOptionsAmount).toString(),
        lowerStrikePutSupplyAfter.toString(),
      )

      assert.equal(
        ownerlongOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        ownerlongOtokenBalanceAfter.toString(),
      )
      assert.equal(higherStrikePutSupplyBefore.toString(), higherStrikePutSupplyAfter.toString())
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
      assert.equal(vaultAfter[0].collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], ZERO_ADDR, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].longOtokens[0], ZERO_ADDR, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts[0].toString(), '0', 'Incorrect amount of short stored in the vault')
      assert.equal(vaultAfter[0].longAmounts[0].toString(), '0', 'Incorrect amount of long stored in the vault')
    })

    it('accountOwner2 should be able to close out the naked short put position before expiry', async () => {
      const collateralAmount = higherStrike * optionsAmount
      const scaledCollateralAmount = createTokenAmount(collateralAmount, usdcDecimals)

      await higherStrikePut.transfer(accountOwner2, scaledOptionsAmount, {from: accountOwner1})
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceBefore = new BigNumber(await higherStrikePut.balanceOf(accountOwner2))
      const higherStrikePutSupplyBefore = new BigNumber(await higherStrikePut.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner2, vaultCounter2)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.BurnShortOption,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: higherStrikePut.address,
          vaultId: vaultCounter2,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: usdc.address,
          vaultId: vaultCounter2,
          amount: scaledCollateralAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner2})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await higherStrikePut.balanceOf(accountOwner2))
      const higherStrikePutSupplyAfter = new BigNumber(await higherStrikePut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(ownerUsdcBalanceBefore.plus(scaledCollateralAmount).toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(
        marginPoolUsdcBalanceBefore.minus(scaledCollateralAmount).toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )
      assert.equal(
        ownerShortOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        higherStrikePutSupplyBefore.minus(scaledOptionsAmount).toString(),
        higherStrikePutSupplyAfter.toString(),
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
