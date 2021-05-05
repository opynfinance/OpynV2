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

contract('Rollover Naked Put Option flow', ([accountOwner1, accountOperator1, buyer]) => {
  let expiry1: number
  let expiry2: number

  let addressBook: AddressBookInstance
  let calculator: MarginCalculatorInstance
  let controllerImplementation: ControllerInstance
  let controllerProxy: ControllerInstance
  let marginPool: MarginPoolInstance
  let whitelist: WhitelistInstance
  let otokenImplementation: OtokenInstance
  let otokenFactory: OtokenFactoryInstance

  // oracle module mock
  let oracle: MockOracleInstance

  let usdc: MockERC20Instance
  let weth: MockERC20Instance

  let ethPut1: OtokenInstance
  let ethPut2: OtokenInstance
  const strikePrice1 = 300
  const strikePrice2 = 200

  const optionsAmount = 10
  const collateralAmount1 = optionsAmount * strikePrice1
  const collateralAmount2 = optionsAmount * strikePrice2
  let vaultCounter: number

  const usdcDecimals = 6
  const wethDecimals = 18

  before('set up contracts', async () => {
    let now = (await time.latest()).toNumber()
    expiry1 = createValidExpiry(now, 30)

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

    const controllerProxyAddress = await addressBook.getController()
    controllerProxy = await Controller.at(controllerProxyAddress)

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(strikePrice1),
      expiry1,
      true,
    )
    const ethPut1Address = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(strikePrice1),
      expiry1,
      true,
    )

    ethPut1 = await Otoken.at(ethPut1Address)

    now = (await time.latest()).toNumber()
    expiry2 = createValidExpiry(now, 35)

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(strikePrice2),
      expiry2,
      true,
    )
    const ethPut2Address = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(strikePrice2),
      expiry2,
      true,
    )

    ethPut2 = await Otoken.at(ethPut2Address)

    await controllerProxy.setOperator(accountOperator1, true, {from: accountOwner1})

    // mint usdc to user
    const accountOwner1Usdc = createTokenAmount(2 * collateralAmount1, usdcDecimals)
    await usdc.mint(accountOwner1, accountOwner1Usdc)

    // have the user approve all the usdc transfers
    await usdc.approve(marginPool.address, accountOwner1Usdc, {from: accountOwner1})

    const vaultCounterBefore = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
    vaultCounter = vaultCounterBefore.toNumber() + 1
  })

  describe('Integration test: vault operator rolls over a naked short put before expiry', () => {
    it('accountOperator1 should be able to open a short put option on behalf of accountOwner1, taking usdc from accountOwner1', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      const scaledCollateralAmount = createTokenAmount(collateralAmount1, usdcDecimals)
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const operatorOtokenBalanceBefore = new BigNumber(await ethPut1.balanceOf(accountOwner1))
      const oTokenSupplyBefore = new BigNumber(await ethPut1.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter)
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
          secondAddress: accountOperator1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOperator1,
          asset: ethPut1.address,
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

      await controllerProxy.operate(actionArgs, {from: accountOperator1})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const operatorOtokenBalanceAfter = new BigNumber(await ethPut1.balanceOf(accountOperator1))
      const oTokenSupplyAfter = new BigNumber(await ethPut1.totalSupply())

      // check balances before and after changed as expected
      assert.equal(ownerUsdcBalanceBefore.minus(scaledCollateralAmount).toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(
        marginPoolUsdcBalanceBefore.plus(scaledCollateralAmount).toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )
      assert.equal(
        operatorOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        operatorOtokenBalanceAfter.toString(),
      )
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

      assert.equal(vaultAfter[0].shortOtokens[0], ethPut1.address, 'Incorrect short otoken in the vault')
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

    it('accountOperator1 should be able to rollover the unexpired short put position on behalf of accountOwner1 and withdraw excess collateral', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      const scaledExcessCollateralAmount = createTokenAmount(collateralAmount1 - collateralAmount2, usdcDecimals)
      const scaledCollateralAmountInVault = createTokenAmount(collateralAmount2, usdcDecimals)
      // Keep track of balances before
      const operatorUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOperator1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const operatorOtoken1BalanceBefore = new BigNumber(await ethPut1.balanceOf(accountOperator1))
      const operatorOtoken2BalanceBefore = new BigNumber(await ethPut2.balanceOf(accountOperator1))
      const oToken1SupplyBefore = new BigNumber(await ethPut1.totalSupply())
      const oToken2SupplyBefore = new BigNumber(await ethPut2.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.BurnShortOption,
          owner: accountOwner1,
          secondAddress: accountOperator1,
          asset: ethPut1.address,
          vaultId: vaultCounter,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner1,
          secondAddress: accountOperator1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: scaledExcessCollateralAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOperator1,
          asset: ethPut2.address,
          vaultId: vaultCounter,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOperator1})

      // keep track of balances after
      const operatorUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOperator1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const operatorOtoken1BalanceAfter = new BigNumber(await ethPut1.balanceOf(accountOperator1))
      const oToken1SupplyAfter = new BigNumber(await ethPut1.totalSupply())
      const operatorOtoken2BalanceAfter = new BigNumber(await ethPut2.balanceOf(accountOperator1))
      const oToken2SupplyAfter = new BigNumber(await ethPut2.totalSupply())

      // check balances before and after changed as expected
      assert.equal(
        operatorUsdcBalanceBefore.plus(scaledExcessCollateralAmount).toString(),
        operatorUsdcBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolUsdcBalanceBefore.minus(scaledExcessCollateralAmount).toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )
      assert.equal(
        operatorOtoken1BalanceBefore.minus(scaledOptionsAmount).toString(),
        operatorOtoken1BalanceAfter.toString(),
      )
      assert.equal(oToken1SupplyBefore.minus(scaledOptionsAmount).toString(), oToken1SupplyAfter.toString())

      assert.equal(
        operatorOtoken2BalanceBefore.plus(scaledOptionsAmount).toString(),
        operatorOtoken2BalanceAfter.toString(),
      )
      assert.equal(oToken2SupplyBefore.plus(scaledOptionsAmount).toString(), oToken2SupplyAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], ethPut2.address, 'Incorrect short otoken in the vault')
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
        scaledCollateralAmountInVault,
        'Incorrect amount of collateral stored in the vault',
      )
    })
  })

  describe('Integration test: vault operator rolls over a naked short put after expiry', () => {
    before(
      'accountOperator1 opens a short put option on behalf of accountOwner1, taking usdc from accountOwner1',
      async () => {
        const vaultCounterBefore = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        vaultCounter = vaultCounterBefore.toNumber() + 1

        const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
        const scaledCollateralAmount = createTokenAmount(collateralAmount1, usdcDecimals)

        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOperator1,
            asset: ZERO_ADDR,
            vaultId: vaultCounter,
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner1,
            secondAddress: accountOperator1,
            asset: ethPut1.address,
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

        await controllerProxy.operate(actionArgs, {from: accountOperator1})
      },
    )

    it('accountOperator1 should be able to rollover the expired short put position on behalf of accountOwner1 and withdraw excess collateral', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      const scaledExcessCollateralAmount = createTokenAmount(collateralAmount1 - collateralAmount2, usdcDecimals)
      const scaledCollateralAmount2 = createTokenAmount(collateralAmount2, usdcDecimals)
      const scaledCollateralAmount1 = createTokenAmount(collateralAmount1, usdcDecimals)

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateBeforeExpiry = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBeforeExpiry[0].toString(), '0')
      assert.equal(vaultStateBeforeExpiry[1], true)

      //set expiry
      if ((await time.latest()) < expiry1) {
        await time.increaseTo(expiry1 + 2)
      }
      const scaledETHPrice = createTokenAmount(300)
      const scaledUSDCPrice = createTokenAmount(1)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry1, scaledETHPrice, true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry1, scaledUSDCPrice, true)
      // Keep track of balances before
      const operatorUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOperator1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const operatorOtoken1BalanceBefore = new BigNumber(await ethPut1.balanceOf(accountOperator1))
      const operatorOtoken2BalanceBefore = new BigNumber(await ethPut2.balanceOf(accountOperator1))
      const oToken1SupplyBefore = new BigNumber(await ethPut1.totalSupply())
      const oToken2SupplyBefore = new BigNumber(await ethPut2.totalSupply())

      // check that excess collateral after expiry has changed
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), scaledCollateralAmount1)
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner1,
          secondAddress: accountOperator1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: scaledExcessCollateralAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOperator1,
          asset: ethPut2.address,
          vaultId: vaultCounter,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner1,
          secondAddress: accountOperator1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: scaledCollateralAmount2,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await usdc.approve(marginPool.address, scaledCollateralAmount2, {from: accountOperator1})
      await controllerProxy.operate(actionArgs, {from: accountOperator1})

      // keep track of balances after
      const operatorUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOperator1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const operatorOtoken1BalanceAfter = new BigNumber(await ethPut1.balanceOf(accountOperator1))
      const oToken1SupplyAfter = new BigNumber(await ethPut1.totalSupply())
      const operatorOtoken2BalanceAfter = new BigNumber(await ethPut2.balanceOf(accountOperator1))
      const oToken2SupplyAfter = new BigNumber(await ethPut2.totalSupply())

      // check balances before and after changed as expected
      assert.equal(
        operatorUsdcBalanceBefore.plus(scaledExcessCollateralAmount).toString(),
        operatorUsdcBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolUsdcBalanceBefore.minus(scaledExcessCollateralAmount).toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )
      assert.equal(operatorOtoken1BalanceBefore.toString(), operatorOtoken1BalanceAfter.toString())
      assert.equal(oToken1SupplyBefore.toString(), oToken1SupplyAfter.toString())

      assert.equal(
        operatorOtoken2BalanceBefore.plus(scaledOptionsAmount).toString(),
        operatorOtoken2BalanceAfter.toString(),
      )
      assert.equal(oToken2SupplyBefore.plus(scaledOptionsAmount).toString(), oToken2SupplyAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], ethPut2.address, 'Incorrect short otoken in the vault')
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
        scaledCollateralAmount2,
        'Incorrect amount of collateral stored in the vault',
      )
    })
  })
})
