import {
  OtokenFactoryInstance,
  OtokenInstance,
  MockOtokenInstance,
  AddressBookInstance,
  MockERC20Instance,
  MarginPoolInstance,
  ControllerInstance,
  WhitelistInstance,
  MockOracleInstance,
} from '../../build/types/truffle-types'

import {assert} from 'chai'
import {createScaledNumber as createScaled, createTokenAmount, createValidExpiry} from '../utils'
const {expectRevert, time} = require('@openzeppelin/test-helpers')

const Controller = artifacts.require('Controller.sol')
const MockERC20 = artifacts.require('MockERC20.sol')

// real contract instances for Testing
const Otoken = artifacts.require('Otoken.sol')
const OTokenFactory = artifacts.require('OtokenFactory.sol')
const AddressBook = artifacts.require('AddressBook.sol')
const Whitelist = artifacts.require('Whitelist.sol')
const Calculator = artifacts.require('MarginCalculator.sol')
const MarginPool = artifacts.require('MarginPool.sol')
const MarginVault = artifacts.require('MarginVault.sol')
const MockOracle = artifacts.require('MockOracle.sol')

// used for testing change of Otoken impl address in AddressBook
const MockOtoken = artifacts.require('MockOtoken.sol')

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

contract('OTokenFactory + Otoken: Cloning of real otoken instances.', ([owner, user1, user2, random]) => {
  let otokenImpl: OtokenInstance
  let otoken1: OtokenInstance
  let otoken2: OtokenInstance
  let addressBook: AddressBookInstance
  let otokenFactory: OtokenFactoryInstance
  let whitelist: WhitelistInstance
  let marginPool: MarginPoolInstance
  let oracle: MockOracleInstance

  let usdc: MockERC20Instance
  let dai: MockERC20Instance
  let weth: MockERC20Instance
  let randomERC20: MockERC20Instance

  let controller: ControllerInstance

  const strikePrice = createTokenAmount(200)
  const isPut = true
  let expiry: number

  before('Deploy addressBook, otoken logic, whitelist, Factory contract', async () => {
    expiry = createValidExpiry(Number(await time.latest()), 100)
    usdc = await MockERC20.new('USDC', 'USDC', 6)
    dai = await MockERC20.new('DAI', 'DAI', 18)
    weth = await MockERC20.new('wETH', 'WETH', 18)
    randomERC20 = await MockERC20.new('RANDOM', 'RAM', 10)

    // Setup AddresBook
    addressBook = await AddressBook.new({from: owner})

    oracle = await MockOracle.new(addressBook.address, {from: owner})
    otokenImpl = await Otoken.new({from: owner})
    whitelist = await Whitelist.new(addressBook.address, {from: owner})
    otokenFactory = await OTokenFactory.new(addressBook.address, {from: owner})
    marginPool = await MarginPool.new(addressBook.address)
    const calculator = await Calculator.new(addressBook.address, {from: owner})

    // setup addressBook
    await addressBook.setOtokenImpl(otokenImpl.address, {from: owner})
    await addressBook.setWhitelist(whitelist.address, {from: owner})
    await addressBook.setOtokenFactory(otokenFactory.address, {from: owner})
    await addressBook.setMarginCalculator(calculator.address, {from: owner})
    await addressBook.setMarginPool(marginPool.address, {from: owner})
    await addressBook.setOracle(oracle.address, {from: owner})

    // deploy the controller instance
    const lib = await MarginVault.new()
    await Controller.link('MarginVault', lib.address)
    controller = await Controller.new()
    await controller.initialize(addressBook.address, owner)

    // set the controller as controller (so it has access to minting tokens)
    await addressBook.setController(controller.address)
    controller = await Controller.at(await addressBook.getController())
  })

  describe('Otoken Creation before whitelisting', () => {
    it('Should revert before admin whitelist any product', async () => {
      await expectRevert(
        otokenFactory.createOtoken(weth.address, usdc.address, usdc.address, strikePrice, expiry, isPut, {
          from: user1,
        }),
        'OtokenFactory: Unsupported Product',
      )
    })
  })

  describe('Otoken Creation after whitelisting products and collateral', () => {
    before('Whitelist product from admin', async () => {
      await whitelist.whitelistCollateral(usdc.address, {from: owner})
      await whitelist.whitelistCollateral(dai.address, {from: owner})
      await whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, isPut, {from: owner})
      await whitelist.whitelistProduct(weth.address, dai.address, dai.address, isPut, {from: owner})
    })

    it('Should init otoken1 with correct name and symbol', async () => {
      // otoken1: eth-usdc option
      const targetAddress1 = await otokenFactory.getTargetOtokenAddress(
        weth.address,
        usdc.address,
        usdc.address,
        strikePrice,
        expiry,
        isPut,
      )
      await otokenFactory.createOtoken(weth.address, usdc.address, usdc.address, strikePrice, expiry, isPut, {
        from: user1,
      })
      otoken1 = await Otoken.at(targetAddress1)
      assert.isTrue((await otoken1.name()).includes('200Put USDC Collateral'))
      assert.isTrue((await otoken1.symbol()).includes('oWETHUSDC/USDC-'))
    })

    it('Should init otoken2 with correct name and symbol', async () => {
      // otoken2: eth-dai option
      const targetAddress2 = await otokenFactory.getTargetOtokenAddress(
        weth.address,
        dai.address,
        dai.address,
        strikePrice,
        expiry,
        isPut,
      )
      await otokenFactory.createOtoken(weth.address, dai.address, dai.address, strikePrice, expiry, isPut, {
        from: user2,
      })
      otoken2 = await Otoken.at(targetAddress2)
      assert.isTrue((await otoken2.name()).includes('200Put DAI Collateral'))
      assert.isTrue((await otoken2.symbol()).includes('oWETHDAI'))
    })

    it('The newly created tokens should be whitelisted in the whitelist module', async () => {
      assert.equal(await whitelist.isWhitelistedOtoken(otoken1.address), true)
      assert.equal(await whitelist.isWhitelistedOtoken(otoken2.address), true)
    })

    it('The owner of whitelist contract can blacklist specific otoken', async () => {
      await whitelist.blacklistOtoken(otoken2.address)

      assert.equal(await whitelist.isWhitelistedOtoken(otoken2.address), false)
    })

    it('should revert creating otoken after the owner blacklist the product', async () => {
      await whitelist.blacklistProduct(weth.address, usdc.address, usdc.address, isPut)
      const newStrikePrice = createScaled(188)
      await expectRevert(
        otokenFactory.createOtoken(weth.address, usdc.address, usdc.address, newStrikePrice, expiry, isPut, {
          from: user1,
        }),
        'OtokenFactory: Unsupported Product',
      )
    })

    it('Should revert when calling init after createOtoken', async () => {
      /* Should revert because the init function is already called by the factory in createOtoken() */
      await expectRevert(
        otoken1.init(addressBook.address, usdc.address, usdc.address, usdc.address, strikePrice, expiry, isPut),
        'Contract instance has already been initialized',
      )

      await expectRevert(
        otoken2.init(addressBook.address, randomERC20.address, dai.address, usdc.address, strikePrice, expiry, isPut),
        'Contract instance has already been initialized',
      )
    })

    it('Calling init on otoken logic contract should not affecting the minimal proxies.', async () => {
      // someone call init on the logic function for no reason
      await otokenImpl.init(
        addressBook.address,
        randomERC20.address,
        randomERC20.address,
        weth.address,
        strikePrice,
        expiry,
        isPut,
      )

      const strikeOfOtoken1 = await otoken1.strikeAsset()
      const collateralOfOtoken1 = await otoken1.collateralAsset()

      const strikeOfOtoken2 = await otoken2.strikeAsset()
      const collateralOfOtoken2 = await otoken2.collateralAsset()

      assert.equal(strikeOfOtoken1, usdc.address)
      assert.equal(strikeOfOtoken2, dai.address)
      assert.equal(collateralOfOtoken1, usdc.address)
      assert.equal(collateralOfOtoken2, dai.address)
    })
  })

  describe('Controller only functions on cloned otokens', () => {
    const amountToMint = createTokenAmount(10)

    it('should revert when mintOtoken is called by random address', async () => {
      await expectRevert(
        otoken1.mintOtoken(user1, amountToMint, {from: random}),
        'Otoken: Only Controller can mint Otokens',
      )
    })

    it('should be able to mint token1 from controller', async () => {
      // the controller will call otoken1.mintOtoken()
      await whitelist.whitelistCollateral(usdc.address, {from: owner})
      const vaultCounter = 1
      const amountCollateral = createTokenAmount(2000, 6)
      await usdc.mint(user1, amountCollateral)
      await usdc.approve(marginPool.address, amountCollateral, {from: user1})
      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: user1,
          secondAddress: user1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: user1,
          secondAddress: user1,
          asset: otoken1.address,
          vaultId: vaultCounter,
          amount: amountToMint,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: user1,
          secondAddress: user1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: amountCollateral,
          index: '0',
          data: ZERO_ADDR,
        },
      ]
      await controller.operate(actionArgs, {from: user1})
      // await controller.testMintOtoken(otoken1.address, user1, amountToMint.toString())
      const balance = await otoken1.balanceOf(user1)
      assert.equal(balance.toString(), amountToMint.toString())
    })

    it('should revert when burnOtoken is called by random address', async () => {
      await expectRevert(
        otoken1.burnOtoken(user1, amountToMint, {from: random}),
        'Otoken: Only Controller can burn Otokens',
      )
    })

    it('should be able to burn tokens from controller', async () => {
      const vaultCounter = 1
      const amountCollateral = createTokenAmount(2000, 6)
      await otoken1.approve(marginPool.address, amountToMint, {from: user1})

      const actionArgs = [
        {
          actionType: ActionType.BurnShortOption,
          owner: user1,
          secondAddress: user1,
          asset: otoken1.address,
          vaultId: vaultCounter,
          amount: amountToMint,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.WithdrawCollateral,
          owner: user1,
          secondAddress: user1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: amountCollateral,
          index: '0',
          data: ZERO_ADDR,
        },
      ]
      await controller.operate(actionArgs, {from: user1})
      const balance = await otoken1.balanceOf(user1)
      assert.equal(balance.toString(), '0')
    })
  })

  describe('Otoken Implementation address upgrade ', () => {
    const amountToMint = createScaled(10)

    before('whitelist product again', async () => {
      await whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, isPut, {from: owner})
    })

    it('should not affect existing otoken instances', async () => {
      const newOtoken = await MockOtoken.new()
      // mint some otoken1
      const vaultCounter = 1
      const amountCollateral = createTokenAmount(2000, 6)
      await usdc.mint(user1, amountCollateral)
      await usdc.approve(marginPool.address, amountCollateral, {from: user1})
      const actionArgs = [
        {
          actionType: ActionType.MintShortOption,
          owner: user1,
          secondAddress: user1,
          asset: otoken1.address,
          vaultId: vaultCounter,
          amount: amountToMint,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: user1,
          secondAddress: user1,
          asset: usdc.address,
          vaultId: vaultCounter,
          amount: amountCollateral,
          index: '0',
          data: ZERO_ADDR,
        },
      ]
      await controller.operate(actionArgs, {from: user1})

      // update otokenimpl address in addressbook
      await addressBook.setOtokenImpl(newOtoken.address, {from: owner})

      const balance = await otoken1.balanceOf(user1)
      assert.equal(balance.toString(), amountToMint.toString())
    })

    it('should deploy MockOtoken after upgrade', async () => {
      const newExpiry = expiry + 86400
      const address = await otokenFactory.getTargetOtokenAddress(
        weth.address,
        usdc.address,
        usdc.address,
        strikePrice,
        newExpiry,
        isPut,
      )
      await otokenFactory.createOtoken(weth.address, usdc.address, usdc.address, strikePrice, newExpiry, isPut)

      const mockedToken: MockOtokenInstance = await MockOtoken.at(address)
      // Only MockOtoken has this method, if it return true that means we created a MockOtoken instance.
      const inited = await mockedToken.inited()
      assert.isTrue(inited)
    })
  })

  describe('Market creation after addressbook update', () => {
    before('update the factory address in the address book', async () => {
      await addressBook.setOtokenFactory(random)
    })

    it('should revert when trying to create oToken', async () => {
      const newStrikePrice = createScaled(400)
      await expectRevert(
        otokenFactory.createOtoken(weth.address, usdc.address, usdc.address, newStrikePrice, expiry, isPut, {
          from: user1,
        }),
        'Whitelist: Sender is not OtokenFactory',
      )
    })
  })
})
