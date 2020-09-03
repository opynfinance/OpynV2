import {
  MockERC20Instance,
  MarginCalculatorInstance,
  AddressBookInstance,
  MockOracleInstance,
  OtokenInstance,
  ControllerInstance,
  MockWhitelistModuleInstance,
  MarginPoolInstance,
} from '../../build/types/truffle-types'
import {createVault, createScaledUint256} from '../utils'
import {assert} from 'chai'
import BigNumber from 'bignumber.js'

const {expectRevert, time} = require('@openzeppelin/test-helpers')
const AddressBook = artifacts.require('AddressBook.sol')
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

contract('Put Spread Option flow', ([admin, accountOwner1, accountOperator1, random]) => {
  let expiry: number

  let addressBook: AddressBookInstance
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

  let shortPut: OtokenInstance
  let longPut: OtokenInstance
  const shortStrike = 300
  const longStrike = 200

  const optionsAmount = 10
  const collateralAmount = Math.abs(shortStrike - longStrike) * optionsAmount

  let vaultCounter: number

  before('set up contracts', async () => {
    const now = (await time.latest()).toNumber()
    expiry = now + time.duration.days(30).toNumber()

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
    usdc = await MockERC20.new('USDC', 'USDC', 6)
    dai = await MockERC20.new('DAI', 'DAI', 18)
    weth = await MockERC20.new('WETH', 'WETH', 18)

    // TODO: setup address book
    // await addressBook.setOracle(oracle.address)
    // await addressBook.setController(controller.address)
    // await addressBook.setMarginCalculator(calculator.address)
    // await addressBook.setWhitelist(whitelist.address)
    // await addressBook.setMarginPool(marginPool.address)

    shortPut = await Otoken.new()
    await shortPut.init(
      addressBook.address,
      weth.address,
      usdc.address,
      usdc.address,
      createScaledUint256(shortStrike, 18),
      expiry,
      true,
    )

    longPut = await Otoken.new()
    await longPut.init(
      addressBook.address,
      weth.address,
      usdc.address,
      usdc.address,
      createScaledUint256(shortStrike, 18),
      expiry,
      true,
    )

    // mint usdc to user
    usdc.mint(accountOwner1, createScaledUint256(2 * collateralAmount, (await usdc.decimals()).toNumber()))
    usdc.mint(random, createScaledUint256(longStrike * optionsAmount, (await usdc.decimals()).toNumber()))

    // have the user approve all the usdc transfers
    usdc.approve(marginPool.address, '10000000000000000000000', {from: accountOwner1})
    usdc.approve(marginPool.address, '10000000000000000000000', {from: random})

    const vaultCounterBefore = new BigNumber(await controller.getAccountVaultCounter(accountOwner1))
    vaultCounter = vaultCounterBefore.toNumber() + 1
  })

  describe('Integration test: Sell a short put spread and close it before expiry', () => {
    before('Someone else mints the long option and sends it to the seller', async () => {
      const collateralToMintLong = longStrike * optionsAmount
      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: random,
          sender: random,
          asset: ZERO_ADDR,
          vaultId: vaultCounter,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: random,
          sender: random,
          asset: longPut.address,
          vaultId: vaultCounter,
          amount: createScaledUint256(optionsAmount, 18),
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: random,
          sender: random,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: createScaledUint256(collateralToMintLong, (await usdc.decimals()).toNumber()),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controller.operate(actionArgs, {from: random})

      // random sells their long put option to owner
      longPut.transfer(random, createScaledUint256(optionsAmount, 18), {from: accountOwner1})
    })
    it('Seller should be able to open a short put spread', async () => {
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceBefore = new BigNumber(await shortPut.balanceOf(accountOwner1))
      const marginPoolShortOtokenSupplyBefore = new BigNumber(await shortPut.totalSupply())

      const ownerlongOtokenBalanceBefore = new BigNumber(await longPut.balanceOf(accountOwner1))
      const marginPoolLongOtokenSupplyBefore = new BigNumber(await longPut.totalSupply())
      const marginPoolLongOtokenBalanceBefore = new BigNumber(await longPut.balanceOf(marginPool.address))

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
          asset: shortPut.address,
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
        {
          actionType: ActionType.DepositLongOption,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: longPut.address,
          vaultId: vaultCounter,
          amount: createScaledUint256(optionsAmount, 18),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await longPut.approve(marginPool.address, '1000000000000000000000', {from: accountOwner1})
      await controller.operate(actionArgs, {from: accountOwner1})

      // keep track of balances after
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await shortPut.balanceOf(accountOwner1))
      const marginPoolShortOtokenSupplyAfter = new BigNumber(await shortPut.totalSupply())

      const ownerlongOtokenBalanceAfter = new BigNumber(await longPut.balanceOf(accountOwner1))
      const marginPoolLongOtokenSupplyAfter = new BigNumber(await longPut.totalSupply())
      const marginPoolLongOtokenBalanceAfter = new BigNumber(await longPut.balanceOf(marginPool.address))

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
        ownerShortOtokenBalanceBefore.plus(createScaledUint256(optionsAmount, 18)).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolShortOtokenSupplyBefore.plus(createScaledUint256(optionsAmount, 18)).toString(),
        marginPoolShortOtokenSupplyAfter.toString(),
      )

      assert.equal(
        ownerlongOtokenBalanceBefore.minus(createScaledUint256(optionsAmount, 18)).toString(),
        ownerlongOtokenBalanceAfter.toString(),
      )
      assert.equal(marginPoolLongOtokenSupplyBefore.toString(), marginPoolLongOtokenSupplyAfter.toString())
      assert.equal(
        marginPoolLongOtokenBalanceBefore.plus(createScaledUint256(optionsAmount, 18)).toString(),
        marginPoolLongOtokenBalanceAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controller.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter)
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter.shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter.collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter.longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter.shortOtokens[0], shortPut.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter.collateralAssets[0], usdc.address, 'Incorrect collateral asset in the vault')
      assert.equal(vaultAfter.longOtokens[0], longPut.address, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter.shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter.collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter.longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(
        vaultAfter.shortAmounts[0].toString(),
        createScaledUint256(optionsAmount, 18),
        'Incorrect amount of short options stored in the vault',
      )
      assert.equal(
        vaultAfter.collateralAmounts[0].toString(),
        createScaledUint256(collateralAmount, 18),
        'Incorrect amount of collateral stored in the vault',
      )
      assert.equal(
        vaultAfter.longAmounts[0].toString(),
        createScaledUint256(optionsAmount, 18),
        'Incorrect amount of long options stored in the vault',
      )
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
      assert.equal(vaultAfter.longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter.shortOtokens[0], shortPut.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter.collateralAssets[0], usdc.address, 'Incorrect collateral asset in the vault')
      assert.equal(vaultAfter.longOtokens[0], longPut.address, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter.shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter.collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter.longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(
        vaultAfter.shortAmounts[0].toString(),
        createScaledUint256(optionsAmount, 18),
        'Incorrect amount of short options stored in the vault',
      )
      assert.equal(
        vaultAfter.collateralAmounts[0].toString(),
        createScaledUint256(2 * collateralAmount, 18),
        'Incorrect amount of collateral stored in the vault',
      )
      assert.equal(
        vaultAfter.longAmounts[0].toString(),
        createScaledUint256(optionsAmount, 18),
        'Incorrect amount of long options stored in the vault',
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
      assert.equal(vaultAfter.longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter.shortOtokens[0], shortPut.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter.collateralAssets[0], usdc.address, 'Incorrect collateral asset in the vault')
      assert.equal(vaultAfter.longOtokens[0], longPut.address, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter.shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter.collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter.longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(
        vaultAfter.shortAmounts[0].toString(),
        createScaledUint256(optionsAmount, 18),
        'Incorrect amount of short options stored in the vault',
      )
      assert.equal(
        vaultAfter.collateralAmounts[0].toString(),
        createScaledUint256(collateralAmount, 18),
        'Incorrect amount of collateral stored in the vault',
      )
      assert.equal(
        vaultAfter.longAmounts[0].toString(),
        createScaledUint256(optionsAmount, 18),
        'Incorrect amount of long options stored in the vault',
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

    xit('should be able to transfer long otokens to another address', async () => {
      // keep track of balances
      const ownerShortOtokenBalanceBeforeSell = new BigNumber(await shortPut.balanceOf(accountOwner1))
      const buyerBalanceBeforeSell = new BigNumber(await shortPut.balanceOf(random))

      // owner sells their put option
      shortPut.transfer(random, createScaledUint256(optionsAmount, 18), {from: accountOwner1})

      const ownerShortOtokenBalanceAfterSell = new BigNumber(await shortPut.balanceOf(accountOwner1))
      const buyerBalanceAfterSell = new BigNumber(await shortPut.balanceOf(random))

      assert.equal(
        ownerShortOtokenBalanceBeforeSell.minus(createScaledUint256(optionsAmount, 18)).toString(),
        ownerShortOtokenBalanceAfterSell.toString(),
      )
      assert.equal(
        buyerBalanceBeforeSell.plus(createScaledUint256(optionsAmount, 18)).toString(),
        buyerBalanceAfterSell.toString(),
      )

      // owner buys back their put option
      shortPut.transfer(accountOwner1, createScaledUint256(optionsAmount, 18), {from: random})
    })

    it('should be able to close out the short spread position', async () => {
      // Keep track of balances before
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceBefore = new BigNumber(await shortPut.balanceOf(accountOwner1))
      const marginPoolShortOtokenSupplyBefore = new BigNumber(await shortPut.totalSupply())

      const ownerlongOtokenBalanceBefore = new BigNumber(await longPut.balanceOf(accountOwner1))
      const marginPoolLongOtokenSupplyBefore = new BigNumber(await longPut.totalSupply())
      const marginPoolLongOtokenBalanceBefore = new BigNumber(await longPut.balanceOf(marginPool.address))

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
          asset: shortPut.address,
          vaultId: vaultCounter,
          amount: createScaledUint256(optionsAmount, 18),
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.WithdrawLongOption,
          owner: accountOwner1,
          sender: accountOwner1,
          asset: longPut.address,
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

      const ownerShortOtokenBalanceAfter = new BigNumber(await shortPut.balanceOf(accountOwner1))
      const marginPoolShortOtokenSupplyAfter = new BigNumber(await shortPut.totalSupply())

      const ownerlongOtokenBalanceAfter = new BigNumber(await longPut.balanceOf(accountOwner1))
      const marginPoolLongOtokenSupplyAfter = new BigNumber(await longPut.totalSupply())
      const marginPoolLongOtokenBalanceAfter = new BigNumber(await longPut.balanceOf(marginPool.address))

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
        ownerShortOtokenBalanceBefore.minus(createScaledUint256(optionsAmount, 18)).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        marginPoolShortOtokenSupplyBefore.minus(createScaledUint256(optionsAmount, 18)).toString(),
        marginPoolShortOtokenSupplyAfter.toString(),
      )

      assert.equal(
        ownerlongOtokenBalanceBefore.plus(createScaledUint256(optionsAmount, 18)).toString(),
        ownerlongOtokenBalanceAfter.toString(),
      )
      assert.equal(marginPoolLongOtokenSupplyBefore.toString(), marginPoolLongOtokenSupplyAfter.toString())
      assert.equal(
        marginPoolLongOtokenBalanceBefore.minus(createScaledUint256(optionsAmount, 18)).toString(),
        marginPoolLongOtokenBalanceAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controller.getVault(accountOwner1, vaultCounter)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter)
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter.shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter.collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter.longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter.shortOtokens[0], ZERO_ADDR, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter.collateralAssets[0], ZERO_ADDR, 'Incorrect collateral asset in the vault')
      assert.equal(vaultAfter.longOtokens[0], ZERO_ADDR, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter.shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter.collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter.longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(vaultAfter.shortAmounts[0].toString(), '0', 'Incorrect amount of short stored in the vault')
      assert.equal(
        vaultAfter.collateralAmounts[0].toString(),
        '0',
        'Incorrect amount of collateral stored in the vault',
      )
      assert.equal(vaultAfter.longAmounts[0].toString(), '0', 'Incorrect amount of long stored in the vault')
    })
  })
})
