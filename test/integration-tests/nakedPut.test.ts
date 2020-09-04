import {
  MockERC20Instance,
  MarginCalculatorInstance,
  MockAddressBookInstance,
  MockOracleInstance,
  OtokenInstance,
  ControllerInstance,
  MockWhitelistModuleInstance,
  MarginPoolInstance,
} from '../../build/types/truffle-types'
import {createVault, createScaledUint256, createScaledNumber} from '../utils'
import {assert} from 'chai'
import BigNumber from 'bignumber.js'

import Reverter from '../Reverter'

const {expectRevert, time} = require('@openzeppelin/test-helpers')
const AddressBook = artifacts.require('MockAddressBook.sol')
const MockOracle = artifacts.require('MockOracle.sol')
const Otoken = artifacts.require('Otoken.sol')
const MockERC20 = artifacts.require('MockERC20.sol')
const MarginCalculator = artifacts.require('MarginCalculator.sol')
const MockWhitelist = artifacts.require('MockWhitelistModule.sol')
const MarginPool = artifacts.require('MarginPool.sol')
const Controller = artifacts.require('Controller.sol')
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

contract('Naked Put Option flow', ([admin, accountOwner1, accountOperator1, buyer]) => {
  const reverter = new Reverter(web3)

  let expiry: number

  let addressBook: MockAddressBookInstance
  let calculator: MarginCalculatorInstance
  let controller: ControllerInstance
  let marginPool: MarginPoolInstance

  // whitelist module mock
  let whitelist: MockWhitelistModuleInstance
  // oracle modulce mock
  let oracle: MockOracleInstance

  let usdc: MockERC20Instance
  let dai: MockERC20Instance
  let weth: MockERC20Instance

  let ethPut: OtokenInstance
  const strikePrice = 300

  const optionsAmount = 10
  const collateralAmount = optionsAmount * strikePrice
  let vaultCounter: number

  before('set up contracts', async () => {
    const now = (await time.latest()).toNumber()
    expiry = now + time.duration.days(500).toNumber()

    // initiate addressbook first.
    addressBook = await AddressBook.new()
    // setup calculator
    calculator = await MarginCalculator.new()
    await calculator.init(addressBook.address)
    // setup margin pool
    marginPool = await MarginPool.new(addressBook.address)
    // setup controller module
    controller = await Controller.new(addressBook.address)
    // setup mock Oracle module
    oracle = await MockOracle.new(addressBook.address)
    // setup mock whitelist module
    whitelist = await MockWhitelist.new()

    // setup usdc and weth
    // TODO: change USDC to 6
    usdc = await MockERC20.new('USDC', 'USDC', 18)
    dai = await MockERC20.new('DAI', 'DAI', 18)
    weth = await MockERC20.new('WETH', 'WETH', 18)

    // TODO: setup address book
    await addressBook.setOracle(oracle.address)
    await addressBook.setController(controller.address)
    await addressBook.setMarginCalculator(calculator.address)
    await addressBook.setWhitelist(whitelist.address)
    await addressBook.setMarginPool(marginPool.address)

    ethPut = await Otoken.new()
    await ethPut.init(
      addressBook.address,
      weth.address,
      usdc.address,
      usdc.address,
      createScaledUint256(strikePrice, 18),
      expiry,
      true,
    )

    // setup the whitelist module
    await whitelist.whitelistOtoken(ethPut.address)
    await whitelist.whitelistCollateral(usdc.address)

    // mint usdc to user
    usdc.mint(accountOwner1, createScaledUint256(2 * collateralAmount, (await usdc.decimals()).toNumber()))

    // have the user approve all the usdc transfers
    usdc.approve(marginPool.address, '10000000000000000000000', {from: accountOwner1})

    const vaultCounterBefore = new BigNumber(await controller.getAccountVaultCounter(accountOwner1))
    vaultCounter = vaultCounterBefore.toNumber() + 1
  })

  describe('Integration test: Sell a naked short put', () => {
    it('Seller should be able to open a short put option', async () => {
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceBefore = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const marginPoolOtokenSupplyBefore = new BigNumber(await ethPut.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controller.getVault(accountOwner1, vaultCounter)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore)
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultBefore.shortOtokens.length, 0, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultBefore.collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultBefore.longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultBefore.shortAmounts.length, 0, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultBefore.collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultBefore.longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: ethPut.address,
          vaultId: vaultCounter,
          amount: createScaledUint256(optionsAmount, 18),
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controller.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerOtokenBalanceAfter = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const marginPoolOtokenSupplyAfter = new BigNumber(await ethPut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(
        ownerUsdcBalanceBefore
          .minus(createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()))
          .toString(),
        ownerUsdcBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolUsdcBalanceBefore
          .plus(createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()))
          .toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )
      assert.equal(
        ownerOtokenBalanceBefore.plus(createScaledUint256(optionsAmount, 18)).toString(),
        ownerOtokenBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolOtokenSupplyBefore.plus(createScaledUint256(optionsAmount, 18)).toString(),
        marginPoolOtokenSupplyAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controller.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter)
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter.shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter.collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter.longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter.shortOtokens[0], ethPut.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter.collateralAssets[0], usdc.address, 'Incorrect collateral asset in the vault')

      assert.equal(vaultAfter.shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter.collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter.longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(
        vaultAfter.shortAmounts[0].toString(),
        createScaledUint256(optionsAmount, 18),
        'Incorrect amount of short stored in the vault',
      )
      assert.equal(
        vaultAfter.collateralAmounts[0].toString(),
        createScaledUint256(collateralAmount, 18),
        'Incorrect amount of collateral stored in the vault',
      )

      await reverter.snapshot()
    })

    it('deposit more collateral into the safe vault', async () => {
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))

      const actionArgs = [
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controller.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(
        ownerUsdcBalanceBefore
          .minus(createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()))
          .toString(),
        ownerUsdcBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolUsdcBalanceBefore
          .plus(createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()))
          .toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )

      // Check that there is excess margin
      const vaultAfter = await controller.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter)
      assert.equal(
        vaultStateAfter[0].toString(),
        createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()),
      )
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter.shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter.collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter.longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter.shortOtokens[0], ethPut.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter.collateralAssets[0], usdc.address, 'Incorrect collateral asset in the vault')

      assert.equal(vaultAfter.shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter.collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter.longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(
        vaultAfter.shortAmounts[0].toString(),
        createScaledUint256(optionsAmount, 18),
        'Incorrect amount of short options stored in the vault',
      )
      assert.equal(
        vaultAfter.collateralAmounts[0].toString(),
        createScaledUint256(2 * collateralAmount, (await usdc.decimals()).toNumber()),
        'Incorrect amount of collateral stored in the vault',
      )
    })
    it('withdraw excess collateral from the safe vault', async () => {
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))

      const actionArgs = [
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controller.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(
        ownerUsdcBalanceBefore
          .plus(createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()))
          .toString(),
        ownerUsdcBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolUsdcBalanceBefore
          .minus(createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()))
          .toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )

      // Check that we end at a valid state with no extra collateral
      const vaultAfter = await controller.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter)
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter.shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter.collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter.longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter.shortOtokens[0], ethPut.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter.collateralAssets[0], usdc.address, 'Incorrect collateral asset in the vault')

      assert.equal(vaultAfter.shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter.collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter.longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(
        vaultAfter.shortAmounts[0].toString(),
        createScaledUint256(optionsAmount, 18),
        'Incorrect amount of short stored in the vault',
      )
      assert.equal(
        vaultAfter.collateralAmounts[0].toString(),
        createScaledUint256(collateralAmount, 18),
        'Incorrect amount of collateral stored in the vault',
      )
    })

    it('withdrawing collateral from the safe vault without excess colalteral should fail', async () => {
      const actionArgs = [
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()),
          index: '0',
          data: ZERO_ADDR,
        },
      ]
      // TODO: Revert message to be updated
      await expectRevert.unspecified(controller.operate(actionArgs, {from: accountOwner1}))
    })

    it('should be able to transfer long otokens to another address', async () => {
      // keep track of balances
      const ownerOtokenBalanceBeforeSell = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const buyerBalanceBeforeSell = new BigNumber(await ethPut.balanceOf(buyer))

      // owner sells their put option
      ethPut.transfer(buyer, createScaledUint256(optionsAmount, 18), {from: accountOwner1})

      const ownerOtokenBalanceAfterSell = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const buyerBalanceAfterSell = new BigNumber(await ethPut.balanceOf(buyer))

      assert.equal(
        ownerOtokenBalanceBeforeSell.minus(createScaledUint256(optionsAmount, 18)).toString(),
        ownerOtokenBalanceAfterSell.toString(),
      )
      assert.equal(
        buyerBalanceBeforeSell.plus(createScaledUint256(optionsAmount, 18)).toString(),
        buyerBalanceAfterSell.toString(),
      )

      // owner buys back their put option
      ethPut.transfer(accountOwner1, createScaledUint256(optionsAmount, 18), {from: buyer})
    })

    xit('should be able to close out the short position', async () => {
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceBefore = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const marginPoolOtokenSupplyBefore = new BigNumber(await ethPut.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controller.getVault(accountOwner1, vaultCounter)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore)
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()),
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.BurnShortOption,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: ethPut.address,
          vaultId: vaultCounter,
          amount: createScaledUint256(optionsAmount, 18),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controller.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerOtokenBalanceAfter = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const marginPoolOtokenSupplyAfter = new BigNumber(await ethPut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(
        ownerUsdcBalanceBefore
          .plus(createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()))
          .toString(),
        ownerUsdcBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolUsdcBalanceBefore
          .minus(createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()))
          .toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )
      assert.equal(
        ownerOtokenBalanceBefore.minus(createScaledUint256(optionsAmount, 18)).toString(),
        ownerOtokenBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolOtokenSupplyBefore.minus(createScaledUint256(optionsAmount, 18)).toString(),
        marginPoolOtokenSupplyAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controller.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter)
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter.shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter.collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter.longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter.shortOtokens[0], ZERO_ADDR, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter.collateralAssets[0], ZERO_ADDR, 'Incorrect collateral asset in the vault')

      assert.equal(vaultAfter.shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter.collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter.longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(vaultAfter.shortAmounts[0].toString(), '0', 'Incorrect amount of short stored in the vault')
      assert.equal(
        vaultAfter.collateralAmounts[0].toString(),
        '0',
        'Incorrect amount of collateral stored in the vault',
      )
    })
    it('Seller: close an OTM position after expiry', async () => {
      await reverter.revert()
      // Set the oracle price
      if ((await time.latest()) < expiry) {
        await time.increaseTo(expiry + 2)
      }
      await oracle.setIsFinalized(weth.address, expiry, true)
      const strikePriceChange = 100
      const expirySpotPrice = strikePrice + strikePriceChange
      await oracle.setExpiryPrice(weth.address, expiry, createScaledUint256(expirySpotPrice, 18))

      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceBefore = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const marginPoolOtokenSupplyBefore = new BigNumber(await ethPut.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controller.getVault(accountOwner1, vaultCounter)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore)
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controller.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerOtokenBalanceAfter = new BigNumber(await ethPut.balanceOf(accountOwner1))
      const marginPoolOtokenSupplyAfter = new BigNumber(await ethPut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(
        ownerUsdcBalanceBefore
          .plus(createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()))
          .toString(),
        ownerUsdcBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolUsdcBalanceBefore
          .minus(createScaledUint256(collateralAmount, (await usdc.decimals()).toNumber()))
          .toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )
      assert.equal(ownerOtokenBalanceBefore.toString(), ownerOtokenBalanceAfter.toString())
      assert.equal(marginPoolOtokenSupplyBefore.toString(), marginPoolOtokenSupplyAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controller.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter)
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter.shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter.collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter.longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter.shortOtokens[0], ZERO_ADDR, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter.collateralAssets[0], ZERO_ADDR, 'Incorrect collateral asset in the vault')

      assert.equal(vaultAfter.shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter.collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter.longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(vaultAfter.shortAmounts[0].toString(), '0', 'Incorrect amount of short stored in the vault')
      assert.equal(
        vaultAfter.collateralAmounts[0].toString(),
        '0',
        'Incorrect amount of collateral stored in the vault',
      )
    })

    it('Buyer: exercise OTM put option after expiry', async () => {
      // owner sells their put option
      ethPut.transfer(buyer, createScaledUint256(optionsAmount, 18), {from: accountOwner1})

      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(buyer))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceBefore = new BigNumber(await ethPut.balanceOf(buyer))
      const marginPoolOtokenSupplyBefore = new BigNumber(await ethPut.totalSupply())

      const actionArgs = [
        {
          actionType: ActionType.Exercise,
          owner: buyer,
          sender: buyer,
          asset: ethPut.address,
          vaultId: '0',
          amount: createScaledUint256(optionsAmount, 18),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await ethPut.approve(marginPool.address, createScaledUint256(optionsAmount, 18), {from: buyer})
      await controller.operate(actionArgs, {from: buyer})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(buyer))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceAfter = new BigNumber(await ethPut.balanceOf(buyer))
      const marginPoolOtokenSupplyAfter = new BigNumber(await ethPut.totalSupply())

      // check balances before and after changed as expected
      assert.equal(ownerUsdcBalanceBefore.toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(marginPoolUsdcBalanceBefore.toString(), marginPoolUsdcBalanceAfter.toString())
      assert.equal(
        ownerOtokenBalanceBefore.minus(createScaledUint256(optionsAmount, 18)).toString(),
        ownerOtokenBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolOtokenSupplyBefore.minus(createScaledUint256(optionsAmount, 18)).toString(),
        marginPoolOtokenSupplyAfter.toString(),
      )
    })
  })

  xit('Seller: close an ITM position after expiry', async () => {
    await reverter.revert()
    // Set the oracle price
    if ((await time.latest()) < expiry) {
      await time.increaseTo(expiry + 2)
    }
    await oracle.setIsFinalized(weth.address, expiry, true)
    const strikePriceChange = 100
    const expirySpotPrice = strikePrice - strikePriceChange
    await oracle.setExpiryPrice(weth.address, expiry, createScaledUint256(expirySpotPrice, 18))

    // Keep track of balances before
    const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
    const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
    const ownerOtokenBalanceBefore = new BigNumber(await ethPut.balanceOf(accountOwner1))
    const marginPoolOtokenSupplyBefore = new BigNumber(await ethPut.totalSupply())

    // Check that we start at a valid state
    const vaultBefore = await controller.getVault(accountOwner1, vaultCounter)
    const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore)
    assert.equal(vaultStateBefore[0].toString(), '0')
    assert.equal(vaultStateBefore[1], true)

    const actionArgs = [
      {
        actionType: ActionType.SettleVault,
        owner: accountOwner1,
        sender: accountOwner1,
        asset: ZERO_ADDR,
        vaultId: vaultCounter,
        amount: '0',
        index: '0',
        data: ZERO_ADDR,
      },
    ]

    await controller.operate(actionArgs, {from: accountOwner1})

    // keep track of balances after
    const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
    const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

    const ownerOtokenBalanceAfter = new BigNumber(await ethPut.balanceOf(accountOwner1))
    const marginPoolOtokenSupplyAfter = new BigNumber(await ethPut.totalSupply())

    const collateralPayout = collateralAmount - strikePriceChange * optionsAmount

    // check balances before and after changed as expected
    assert.equal(
      ownerUsdcBalanceBefore.plus(createScaledUint256(collateralPayout, (await usdc.decimals()).toNumber())).toString(),
      ownerUsdcBalanceAfter.toString(),
    )
    assert.equal(
      marginPoolUsdcBalanceBefore
        .minus(createScaledUint256(collateralPayout, (await usdc.decimals()).toNumber()))
        .toString(),
      marginPoolUsdcBalanceAfter.toString(),
    )
    assert.equal(ownerOtokenBalanceBefore.toString(), ownerOtokenBalanceAfter.toString())
    assert.equal(marginPoolOtokenSupplyBefore.toString(), marginPoolOtokenSupplyAfter.toString())

    // Check that we end at a valid state
    const vaultAfter = await controller.getVault(accountOwner1, vaultCounter)
    const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter)
    assert.equal(vaultStateAfter[0].toString(), '0')
    assert.equal(vaultStateAfter[1], true)

    // Check the vault balances stored in the contract
    assert.equal(vaultAfter.shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
    assert.equal(vaultAfter.collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
    assert.equal(vaultAfter.longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

    assert.equal(vaultAfter.shortOtokens[0], ZERO_ADDR, 'Incorrect short otoken in the vault')
    assert.equal(vaultAfter.collateralAssets[0], ZERO_ADDR, 'Incorrect collateral asset in the vault')

    assert.equal(vaultAfter.shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
    assert.equal(
      vaultAfter.collateralAmounts.length,
      1,
      'Length of the collateral amounts array in the vault is incorrect',
    )
    assert.equal(vaultAfter.longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

    assert.equal(vaultAfter.shortAmounts[0].toString(), '0', 'Incorrect amount of short stored in the vault')
    assert.equal(vaultAfter.collateralAmounts[0].toString(), '0', 'Incorrect amount of collateral stored in the vault')
  })

  xit('Buyer: exercise ITM put option after expiry', async () => {
    // owner sells their put option
    ethPut.transfer(buyer, createScaledUint256(optionsAmount, 18), {from: accountOwner1})
    // oracle orice decreases
    const strikePriceChange = 100

    // Keep track of balances before
    const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(buyer))
    const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
    const ownerOtokenBalanceBefore = new BigNumber(await ethPut.balanceOf(buyer))
    const marginPoolOtokenSupplyBefore = new BigNumber(await ethPut.totalSupply())

    const actionArgs = [
      {
        actionType: ActionType.Exercise,
        owner: buyer,
        sender: buyer,
        asset: ethPut.address,
        vaultId: '0',
        amount: createScaledUint256(optionsAmount, 18),
        index: '0',
        data: ZERO_ADDR,
      },
    ]

    await ethPut.approve(marginPool.address, createScaledUint256(optionsAmount, 18), {from: buyer})
    await controller.operate(actionArgs, {from: buyer})

    // keep track of balances after
    const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(buyer))
    const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
    const ownerOtokenBalanceAfter = new BigNumber(await ethPut.balanceOf(buyer))
    const marginPoolOtokenSupplyAfter = new BigNumber(await ethPut.totalSupply())

    const payout = strikePriceChange * optionsAmount

    // check balances before and after changed as expected
    assert.equal(
      ownerUsdcBalanceBefore.plus(createScaledUint256(payout, (await usdc.decimals()).toNumber())).toString(),
      ownerUsdcBalanceAfter.toString(),
    )
    assert.equal(
      marginPoolUsdcBalanceBefore.minus(createScaledUint256(payout, (await usdc.decimals()).toNumber())).toString(),
      marginPoolUsdcBalanceAfter.toString(),
    )
    assert.equal(
      ownerOtokenBalanceBefore.minus(createScaledUint256(optionsAmount, 18)).toString(),
      ownerOtokenBalanceAfter.toString(),
    )
    assert.equal(
      marginPoolOtokenSupplyBefore.minus(createScaledUint256(optionsAmount, 18)).toString(),
      marginPoolOtokenSupplyAfter.toString(),
    )
  })
})