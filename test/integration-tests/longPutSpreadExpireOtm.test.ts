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
import {createTokenAmount, getExpiry} from '../utils'
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
const MarginAccount = artifacts.require('MarginAccount.sol')
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
  Exercise,
  Call,
}

contract('Long Put Spread Option expires Otm flow', ([accountOwner1, nakedBuyer, accountOwner2]) => {
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
    expiry = await getExpiry()

    // setup usdc and weth
    usdc = await MockERC20.new('USDC', 'USDC', usdcDecimals)
    weth = await MockERC20.new('WETH', 'WETH', wethDecimals)

    // initiate addressbook first.
    addressBook = await AddressBook.new()
    // setup calculator
    calculator = await MarginCalculator.new(addressBook.address)
    // setup margin pool
    marginPool = await MarginPool.new(addressBook.address)
    // setup margin account
    const lib = await MarginAccount.new()
    // setup controllerProxy module
    await Controller.link('MarginAccount', lib.address)
    controllerImplementation = await Controller.new(addressBook.address)
    // setup mock Oracle module
    oracle = await MockOracle.new(addressBook.address)
    // setup whitelist module
    whitelist = await Whitelist.new(addressBook.address)
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
    await controllerProxy.refreshConfiguration()

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(higherStrike, 18),
      expiry,
      true,
    )

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(lowerStrike, 18),
      expiry,
      true,
    )

    const higherStrikePutAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(higherStrike, 18),
      expiry,
      true,
    )

    higherStrikePut = await Otoken.at(higherStrikePutAddress)

    const lowerStrikePutAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(lowerStrike, 18),
      expiry,
      true,
    )

    lowerStrikePut = await Otoken.at(lowerStrikePutAddress)

    // mint usdc to user
    const accountOwner1Usdc = createTokenAmount(2 * collateralAmount, usdcDecimals)
    const accountOwner2Usdc = createTokenAmount(higherStrike * optionsAmount, usdcDecimals)
    const nakedBuyerUsdc = createTokenAmount(higherStrike * optionsAmount, usdcDecimals)

    usdc.mint(accountOwner1, accountOwner1Usdc)
    usdc.mint(accountOwner2, accountOwner2Usdc)
    usdc.mint(nakedBuyer, nakedBuyerUsdc)

    // have the user approve all the usdc transfers
    usdc.approve(marginPool.address, accountOwner1Usdc, {from: accountOwner1})
    usdc.approve(marginPool.address, accountOwner2Usdc, {from: accountOwner2})

    const vaultCounter1Before = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
    vaultCounter1 = vaultCounter1Before.toNumber() + 1
    const vaultCounter2Before = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner2))
    vaultCounter2 = vaultCounter2Before.toNumber() + 1
  })

  describe('Integration test: Open a long put spread and close it after expires OTM', () => {
    before(
      'accountOwner2 mints the higher strike put option, sends it to accountOwner1. accountOwner1 opens a long put spread',
      async () => {
        const collateralToMintLong = higherStrike * optionsAmount
        const scaledOptionsAmount = createTokenAmount(optionsAmount, 18)
        const scaledCollateralAmount = createTokenAmount(collateralToMintLong, usdcDecimals)

        const actionArgsAccountOwner2 = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner2,
            sender: accountOwner2,
            asset: ZERO_ADDR,
            vaultId: vaultCounter2,
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner2,
            sender: accountOwner2,
            asset: higherStrikePut.address,
            vaultId: vaultCounter2,
            amount: scaledOptionsAmount,
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner2,
            sender: accountOwner2,
            asset: usdc.address,
            vaultId: vaultCounter2,
            amount: scaledCollateralAmount,
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await controllerProxy.operate(actionArgsAccountOwner2, {from: accountOwner2})

        // accountOwner2 transfers their higher strike put option to accountOwner1
        higherStrikePut.transfer(accountOwner1, scaledOptionsAmount, {from: accountOwner2})

        const actionArgsAccountOwner1 = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            sender: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: vaultCounter1,
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner1,
            sender: accountOwner1,
            asset: lowerStrikePut.address,
            vaultId: vaultCounter1,
            amount: scaledOptionsAmount,
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositLongOption,
            owner: accountOwner1,
            sender: accountOwner1,
            asset: higherStrikePut.address,
            vaultId: vaultCounter1,
            amount: scaledOptionsAmount,
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await higherStrikePut.approve(marginPool.address, scaledOptionsAmount, {from: accountOwner1})
        await controllerProxy.operate(actionArgsAccountOwner1, {from: accountOwner1})
      },
    )

    it('accountOwner1: close an OTM long put spread position after expiry', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 18)
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceBefore = new BigNumber(await lowerStrikePut.balanceOf(accountOwner1))
      const shortOtokenSupplyBefore = new BigNumber(await lowerStrikePut.totalSupply())
      const ownerLongOtokenBalanceBefore = new BigNumber(await higherStrikePut.balanceOf(accountOwner1))
      const longOtokenSupplyBefore = new BigNumber(await higherStrikePut.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore)
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      // Set the oracle price
      if ((await time.latest()) < expiry) {
        await time.increaseTo(expiry + 2)
      }
      const strikePriceChange = 100
      const expirySpotPrice = higherStrike + strikePriceChange
      const scaledETHPrice = createTokenAmount(expirySpotPrice, 18)
      const scaledUSDCPrice = createTokenAmount(1, 18)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, scaledETHPrice, true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, scaledUSDCPrice, true)

      // Check that after expiry, the vault excess balance has updated as expected
      const vaultStateBeforeSettlement = await calculator.getExcessCollateral(vaultBefore)
      assert.equal(vaultStateBeforeSettlement[0].toString(), '0')
      assert.equal(vaultStateBeforeSettlement[1], true)

      const actionArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter1,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await lowerStrikePut.balanceOf(accountOwner1))
      const shortOtokenSupplyAfter = new BigNumber(await lowerStrikePut.totalSupply())

      const ownerLongOtokenBalanceAfter = new BigNumber(await higherStrikePut.balanceOf(accountOwner1))
      const longOtokenSupplyAfter = new BigNumber(await higherStrikePut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(ownerUsdcBalanceBefore.toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(marginPoolUsdcBalanceBefore.toString(), marginPoolUsdcBalanceAfter.toString())
      assert.equal(ownerShortOtokenBalanceBefore.toString(), ownerShortOtokenBalanceAfter.toString())
      assert.equal(shortOtokenSupplyBefore.toString(), shortOtokenSupplyAfter.toString())

      // excess long otoken in the vault should get burned, but no change to balance
      assert.equal(ownerLongOtokenBalanceBefore.toString(), ownerLongOtokenBalanceAfter.toString())
      assert.equal(
        longOtokenSupplyBefore.minus(scaledOptionsAmount).toString(),
        longOtokenSupplyAfter.toString(),
        'long otokens should be burned during settle vault',
      )

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVault(accountOwner1, vaultCounter1)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter)
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter.shortOtokens.length, 0, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter.collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter.longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter.shortAmounts.length, 0, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter.collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter.longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')
    })

    it('nakedBuyer: exercise lower strike OTM put option after expiry', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 18)
      // accountOwner1 transfers their lower strike put option
      lowerStrikePut.transfer(nakedBuyer, scaledOptionsAmount, {from: accountOwner1})

      // Keep track of balances before
      const nakedBuyerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(nakedBuyer))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const nakedBuyerOtokenBalanceBefore = new BigNumber(await lowerStrikePut.balanceOf(nakedBuyer))
      const oTokenSupplyBefore = new BigNumber(await lowerStrikePut.totalSupply())

      const actionArgs = [
        {
          actionType: ActionType.Exercise,
          owner: nakedBuyer,
          sender: nakedBuyer,
          asset: lowerStrikePut.address,
          vaultId: '0',
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: nakedBuyer})

      // keep track of balances after
      const nakedBuyerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(nakedBuyer))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
      const nakedBuyerOtokenBalanceAfter = new BigNumber(await lowerStrikePut.balanceOf(nakedBuyer))
      const oTokenSupplyAfter = new BigNumber(await lowerStrikePut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(nakedBuyerUsdcBalanceBefore.toString(), nakedBuyerUsdcBalanceAfter.toString())
      assert.equal(marginPoolUsdcBalanceBefore.toString(), marginPoolUsdcBalanceAfter.toString())
      assert.equal(
        nakedBuyerOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        nakedBuyerOtokenBalanceAfter.toString(),
      )
      assert.equal(oTokenSupplyBefore.minus(scaledOptionsAmount).toString(), oTokenSupplyAfter.toString())
    })

    it('accountOwner2: close an OTM naked short put position after expiry', async () => {
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceBefore = new BigNumber(await higherStrikePut.balanceOf(accountOwner2))
      const shortOtokenSupplyBefore = new BigNumber(await higherStrikePut.totalSupply())

      // calculate payout
      const collateralPayout = higherStrike * optionsAmount
      const scaledPayoutAmount = createTokenAmount(collateralPayout, usdcDecimals)

      // Check that after expiry, the vault excess balance has updated as expected
      const vaultBefore = await controllerProxy.getVault(accountOwner2, vaultCounter1)
      const vaultStateBeforeSettlement = await calculator.getExcessCollateral(vaultBefore)
      assert.equal(vaultStateBeforeSettlement[0].toString(), scaledPayoutAmount)
      assert.equal(vaultStateBeforeSettlement[1], true)

      const actionArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner2,
          sender: accountOwner2,
          asset: ZERO_ADDR,
          vaultId: vaultCounter1,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, {from: accountOwner2})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await higherStrikePut.balanceOf(accountOwner2))
      const shortOtokenSupplyAfter = new BigNumber(await higherStrikePut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(ownerUsdcBalanceBefore.plus(scaledPayoutAmount).toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(
        marginPoolUsdcBalanceBefore.minus(scaledPayoutAmount).toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )
      // short otoken balance should not change
      assert.equal(ownerShortOtokenBalanceBefore.toString(), ownerShortOtokenBalanceAfter.toString())
      assert.equal(shortOtokenSupplyBefore.toString(), shortOtokenSupplyAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVault(accountOwner2, vaultCounter1)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter)
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter.shortOtokens.length, 0, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter.collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter.longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter.shortAmounts.length, 0, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter.collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter.longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')
    })
  })
})
