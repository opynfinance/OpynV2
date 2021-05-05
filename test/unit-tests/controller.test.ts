import {
  CallTesterInstance,
  MarginCalculatorInstance,
  MockOtokenInstance,
  MockERC20Instance,
  MockOracleInstance,
  MockWhitelistModuleInstance,
  MarginPoolInstance,
  ControllerInstance,
  AddressBookInstance,
  OwnedUpgradeabilityProxyInstance,
} from '../../build/types/truffle-types'
import BigNumber from 'bignumber.js'
import {createTokenAmount, createScaledNumber} from '../utils'

const {expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers')

const CallTester = artifacts.require('CallTester.sol')
const MockERC20 = artifacts.require('MockERC20.sol')
const MockOtoken = artifacts.require('MockOtoken.sol')
const MockOracle = artifacts.require('MockOracle.sol')
const OwnedUpgradeabilityProxy = artifacts.require('OwnedUpgradeabilityProxy.sol')
const MarginCalculator = artifacts.require('MarginCalculator.sol')
const MockWhitelistModule = artifacts.require('MockWhitelistModule.sol')
const AddressBook = artifacts.require('AddressBook.sol')
const MarginPool = artifacts.require('MarginPool.sol')
const Controller = artifacts.require('Controller.sol')
const MarginVault = artifacts.require('MarginVault.sol')

// address(0)
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
  InvalidAction,
}

contract(
  'Controller',
  ([owner, accountOwner1, accountOwner2, accountOperator1, holder1, fullPauser, partialPauser, random]) => {
    // ERC20 mock
    let usdc: MockERC20Instance
    let weth: MockERC20Instance
    let weth2: MockERC20Instance
    // Oracle module
    let oracle: MockOracleInstance
    // calculator module
    let calculator: MarginCalculatorInstance
    // margin pool module
    let marginPool: MarginPoolInstance
    // whitelist module mock
    let whitelist: MockWhitelistModuleInstance
    // addressbook module mock
    let addressBook: AddressBookInstance
    // controller module
    let controllerImplementation: ControllerInstance
    let controllerProxy: ControllerInstance

    const usdcDecimals = 6
    const wethDecimals = 18

    before('Deployment', async () => {
      // addressbook deployment
      addressBook = await AddressBook.new()
      // ERC20 deployment
      usdc = await MockERC20.new('USDC', 'USDC', usdcDecimals)
      weth = await MockERC20.new('WETH', 'WETH', wethDecimals)
      weth2 = await MockERC20.new('WETH', 'WETH', wethDecimals)
      // deploy Oracle module
      oracle = await MockOracle.new(addressBook.address, {from: owner})
      // calculator deployment
      calculator = await MarginCalculator.new(oracle.address)
      // margin pool deployment
      marginPool = await MarginPool.new(addressBook.address)
      // whitelist module
      whitelist = await MockWhitelistModule.new()
      // set margin pool in addressbook
      await addressBook.setMarginPool(marginPool.address)
      // set calculator in addressbook
      await addressBook.setMarginCalculator(calculator.address)
      // set oracle in AddressBook
      await addressBook.setOracle(oracle.address)
      // set whitelist module address
      await addressBook.setWhitelist(whitelist.address)
      // deploy Controller module
      const lib = await MarginVault.new()
      await Controller.link('MarginVault', lib.address)
      controllerImplementation = await Controller.new()

      // set controller address in AddressBook
      await addressBook.setController(controllerImplementation.address, {from: owner})

      // check controller deployment
      const controllerProxyAddress = await addressBook.getController()
      controllerProxy = await Controller.at(controllerProxyAddress)
      const proxy: OwnedUpgradeabilityProxyInstance = await OwnedUpgradeabilityProxy.at(controllerProxyAddress)

      assert.equal(await proxy.proxyOwner(), addressBook.address, 'Proxy owner address mismatch')
      assert.equal(await controllerProxy.owner(), owner, 'Controller owner address mismatch')
      assert.equal(await controllerProxy.systemPartiallyPaused(), false, 'system is partially paused')

      // make everyone rich
      await usdc.mint(accountOwner1, createTokenAmount(10000, usdcDecimals))
      await usdc.mint(accountOperator1, createTokenAmount(10000, usdcDecimals))
      await usdc.mint(random, createTokenAmount(10000, usdcDecimals))
    })

    describe('Controller initialization', () => {
      it('should revert when calling initialize if it is already initalized', async () => {
        await expectRevert(
          controllerProxy.initialize(addressBook.address, owner),
          'Contract instance has already been initialized',
        )
      })

      it('should revert when calling initialize with addressbook equal to zero', async () => {
        const controllerImplementation = await Controller.new()

        await expectRevert(
          controllerImplementation.initialize(ZERO_ADDR, owner),
          'Controller: invalid addressbook address',
        )
      })

      it('should revert when calling initialize with owner equal to zero', async () => {
        const controllerImplementation = await Controller.new()

        await expectRevert(
          controllerImplementation.initialize(addressBook.address, ZERO_ADDR),
          'Controller: invalid owner address',
        )
      })
    })

    describe('Account operator', () => {
      it('should set operator', async () => {
        assert.equal(
          await controllerProxy.isOperator(accountOwner1, accountOperator1),
          false,
          'Address is already an operator',
        )

        await controllerProxy.setOperator(accountOperator1, true, {from: accountOwner1})

        assert.equal(
          await controllerProxy.isOperator(accountOwner1, accountOperator1),
          true,
          'Operator address mismatch',
        )
      })

      it('should revert when set an already operator', async () => {
        await expectRevert(
          controllerProxy.setOperator(accountOperator1, true, {from: accountOwner1}),
          'Controller: invalid input',
        )
      })

      it('should be able to remove operator', async () => {
        await controllerProxy.setOperator(accountOperator1, false, {from: accountOwner1})

        assert.equal(
          await controllerProxy.isOperator(accountOwner1, accountOperator1),
          false,
          'Operator address mismatch',
        )
      })

      it('should revert when removing an already removed operator', async () => {
        await expectRevert(
          controllerProxy.setOperator(accountOperator1, false, {from: accountOwner1}),
          'Controller: invalid input',
        )
      })
    })

    describe('Vault', () => {
      it('should get vault', async () => {
        const vaultId = new BigNumber(0)
        await controllerProxy.getVault(accountOwner1, vaultId)
      })

      it('should get vault balance', async () => {
        const vaultId = new BigNumber(0)
        const proceed = await controllerProxy.getProceed(accountOwner1, vaultId)
        assert.equal(proceed.toString(), '0')
      })
    })

    describe('Open vault', () => {
      it('should revert opening a vault an an account from random address', async () => {
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: random,
            asset: ZERO_ADDR,
            vaultId: '1',
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await expectRevert(
          controllerProxy.operate(actionArgs, {from: random}),
          'Controller: msg.sender is not authorized to run action',
        )
      })

      it('should revert opening a vault a vault with id equal to zero', async () => {
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: '0',
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: can not run actions on inexistent vault',
        )
      })

      it('should revert opening multiple vaults in the same operate call', async () => {
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: '1',
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: '2',
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: can not run actions on different vaults',
        )
      })

      it('should revert opening a vault with vault type other than 0 or 1', async () => {
        const invalidVault = web3.eth.abi.encodeParameter('uint256', 2)

        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: '1',
            amount: '0',
            index: '0',
            data: invalidVault,
          },
        ]

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Actions: cannot open vault with an invalid type',
        )
      })

      it('should revert opening multiple vaults for different owners in the same operate call', async () => {
        await controllerProxy.setOperator(accountOwner1, true, {from: accountOwner2})
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: '1',
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner2,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: '1',
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: can not run actions for different owners',
        )
      })

      it('should open vault', async () => {
        const vaultCounterBefore = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        assert.equal(vaultCounterBefore.toString(), '0', 'vault counter before mismatch')

        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: vaultCounterBefore.toNumber() + 1,
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await controllerProxy.operate(actionArgs, {from: accountOwner1})

        const vaultCounterAfter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        assert.equal(vaultCounterAfter.minus(vaultCounterBefore).toString(), '1', 'vault counter after mismatch')
      })

      it('should open vault from account operator', async () => {
        await controllerProxy.setOperator(accountOperator1, true, {from: accountOwner1})
        assert.equal(
          await controllerProxy.isOperator(accountOwner1, accountOperator1),
          true,
          'Operator address mismatch',
        )

        const vaultCounterBefore = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))

        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOperator1,
            asset: ZERO_ADDR,
            vaultId: vaultCounterBefore.toNumber() + 1,
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await controllerProxy.operate(actionArgs, {from: accountOperator1})

        const vaultCounterAfter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        assert.equal(vaultCounterAfter.minus(vaultCounterBefore).toString(), '1', 'vault counter after mismatch')
      })
    })

    describe('Long otoken', () => {
      let longOtoken: MockOtokenInstance

      before(async () => {
        const expiryTime = new BigNumber(60 * 60 * 24) // after 1 day

        longOtoken = await MockOtoken.new()
        // init otoken
        await longOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(200),
          new BigNumber(await time.latest()).plus(expiryTime),
          true,
        )

        await longOtoken.mintOtoken(accountOwner1, createTokenAmount(100))
        await longOtoken.mintOtoken(accountOperator1, createTokenAmount(100))
      })

      describe('deposit long otoken', () => {
        it('should revert depositing a non-whitelisted long otoken into vault', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const longToDeposit = createTokenAmount(20)
          const actionArgs = [
            {
              actionType: ActionType.DepositLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await longOtoken.approve(marginPool.address, longToDeposit, {from: accountOwner1})
          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'Controller: otoken is not whitelisted to be used as collateral',
          )
        })

        it('should revert depositing long with invalid vault id', async () => {
          // whitelist otoken
          await whitelist.whitelistOtoken(longOtoken.address)

          const vaultCounter = new BigNumber('100')

          const longToDeposit = createTokenAmount(20)
          const actionArgs = [
            {
              actionType: ActionType.DepositLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await longOtoken.approve(marginPool.address, longToDeposit, {from: accountOwner1})
          await expectRevert(controllerProxy.operate(actionArgs, {from: accountOwner1}), 'Controller: invalid vault id')
        })

        it('should revert depositing long from an address that is not the msg.sender nor the owner account address', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))

          const longToDeposit = createTokenAmount(20)
          const actionArgs = [
            {
              actionType: ActionType.DepositLongOption,
              owner: accountOwner1,
              secondAddress: random,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await longOtoken.approve(marginPool.address, longToDeposit, {from: random})
          await longOtoken.approve(marginPool.address, longToDeposit, {from: accountOperator1})
          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOperator1}),
            'Controller: cannot deposit long otoken from this address',
          )
        })

        it('should deposit long otoken into vault from account owner', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const longToDeposit = createTokenAmount(20)
          const actionArgs = [
            {
              actionType: ActionType.DepositLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await longOtoken.balanceOf(accountOwner1))

          await longOtoken.approve(marginPool.address, longToDeposit, {from: accountOwner1})
          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await longOtoken.balanceOf(accountOwner1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceAfter.minus(marginPoolBalanceBefore).toString(),
            longToDeposit,
            'Margin pool balance long otoken balance mismatch',
          )
          assert.equal(
            senderBalanceBefore.minus(senderBalanceAfter).toString(),
            longToDeposit,
            'Sender balance long otoken balance mismatch',
          )
          assert.equal(vaultAfter.longOtokens.length, 1, 'Vault long otoken array length mismatch')
          assert.equal(
            vaultAfter.longOtokens[0],
            longOtoken.address,
            'Long otoken address deposited into vault mismatch',
          )
          assert.equal(
            new BigNumber(vaultAfter.longAmounts[0]).toString(),
            longToDeposit,
            'Long otoken amount deposited into vault mismatch',
          )
        })

        it('should deposit long otoken into vault from account operator', async () => {
          assert.equal(
            await controllerProxy.isOperator(accountOwner1, accountOperator1),
            true,
            'Operator address mismatch',
          )

          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const longToDeposit = createTokenAmount(20)
          const actionArgs = [
            {
              actionType: ActionType.DepositLongOption,
              owner: accountOwner1,
              secondAddress: accountOperator1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await longOtoken.balanceOf(accountOperator1))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await longOtoken.approve(marginPool.address, longToDeposit, {from: accountOperator1})
          await controllerProxy.operate(actionArgs, {from: accountOperator1})

          const marginPoolBalanceAfter = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await longOtoken.balanceOf(accountOperator1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceAfter.minus(marginPoolBalanceBefore).toString(),
            longToDeposit.toString(),
            'Margin pool balance long otoken balance mismatch',
          )
          assert.equal(
            senderBalanceBefore.minus(senderBalanceAfter).toString(),
            longToDeposit.toString(),
            'Sender balance long otoken balance mismatch',
          )
          assert.equal(vaultAfter.longOtokens.length, 1, 'Vault long otoken array length mismatch')
          assert.equal(
            vaultAfter.longOtokens[0],
            longOtoken.address,
            'Long otoken address deposited into vault mismatch',
          )
          assert.equal(
            new BigNumber(vaultAfter.longAmounts[0]).minus(new BigNumber(vaultBefore.longAmounts[0])).toString(),
            longToDeposit.toString(),
            'Long otoken amount deposited into vault mismatch',
          )
        })

        it('should execute depositing long otoken into vault in multiple actions', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const longToDeposit = new BigNumber(createTokenAmount(20))
          const actionArgs = [
            {
              actionType: ActionType.DepositLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToDeposit.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.DepositLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToDeposit.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await longOtoken.balanceOf(accountOwner1))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await longOtoken.approve(marginPool.address, longToDeposit.multipliedBy(2).toString(), {from: accountOwner1})
          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await longOtoken.balanceOf(accountOwner1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceAfter.minus(marginPoolBalanceBefore).toString(),
            longToDeposit.multipliedBy(2).toString(),
            'Margin pool balance long otoken balance mismatch',
          )
          assert.equal(
            senderBalanceBefore.minus(senderBalanceAfter).toString(),
            longToDeposit.multipliedBy(2).toString(),
            'Sender balance long otoken balance mismatch',
          )
          assert.equal(vaultAfter.longOtokens.length, 1, 'Vault long otoken array length mismatch')
          assert.equal(
            vaultAfter.longOtokens[0],
            longOtoken.address,
            'Long otoken address deposited into vault mismatch',
          )
          assert.equal(
            new BigNumber(vaultAfter.longAmounts[0]).minus(new BigNumber(vaultBefore.longAmounts[0])).toString(),
            longToDeposit.multipliedBy(2).toString(),
            'Long otoken amount deposited into vault mismatch',
          )
        })

        it('should revert depositing long otoken with amount equal to zero', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const longToDeposit = createTokenAmount(20)
          const actionArgs = [
            {
              actionType: ActionType.DepositLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: '0',
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await longOtoken.approve(marginPool.address, longToDeposit, {from: accountOwner1})
          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'MarginVault: invalid long otoken amount',
          )
        })

        it('should revert depositing an expired long otoken', async () => {
          // deploy expired Otoken
          const expiredLongOtoken: MockOtokenInstance = await MockOtoken.new()
          // init otoken
          await expiredLongOtoken.init(
            addressBook.address,
            weth.address,
            usdc.address,
            usdc.address,
            createTokenAmount(200),
            '1219926985', // 2008
            true,
          )
          await expiredLongOtoken.mintOtoken(accountOwner1, new BigNumber('100'))

          // whitelist otoken
          await whitelist.whitelistOtoken(expiredLongOtoken.address)

          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const longToDeposit = createTokenAmount(20)
          const actionArgs = [
            {
              actionType: ActionType.DepositLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: expiredLongOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expiredLongOtoken.approve(marginPool.address, longToDeposit, {from: accountOwner1})
          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'Controller: otoken used as collateral is already expired',
          )
        })

        it('should revert when vault have more than 1 long otoken', async () => {
          const expiryTime = new BigNumber(60 * 60) // after 1 hour
          const longToDeposit = createTokenAmount(20)
          // deploy second Otoken
          const secondLongOtoken: MockOtokenInstance = await MockOtoken.new()
          // init otoken
          await secondLongOtoken.init(
            addressBook.address,
            weth.address,
            usdc.address,
            usdc.address,
            createTokenAmount(200),
            new BigNumber(await time.latest()).plus(expiryTime),
            true,
          )
          await secondLongOtoken.mintOtoken(accountOwner1, longToDeposit)
          // whitelist otoken
          await whitelist.whitelistOtoken(secondLongOtoken.address)
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const actionArgs = [
            {
              actionType: ActionType.DepositLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: secondLongOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToDeposit,
              index: '1',
              data: ZERO_ADDR,
            },
          ]

          await secondLongOtoken.approve(marginPool.address, longToDeposit, {from: accountOwner1})
          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'MarginCalculator: Too many long otokens in the vault',
          )
        })

        it('should revert deposting long from controller implementation contract instead of the controller proxy', async () => {
          await controllerImplementation.initialize(addressBook.address, owner)
          const longToDeposit = createTokenAmount(20)
          const actionArgs = [
            {
              actionType: ActionType.OpenVault,
              owner: accountOwner1,
              secondAddress: random,
              asset: ZERO_ADDR,
              vaultId: '1',
              amount: '0',
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.DepositLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: 1,
              amount: longToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await longOtoken.approve(marginPool.address, longToDeposit, {from: accountOwner1})
          await expectRevert(
            controllerImplementation.operate(actionArgs, {from: accountOwner1}),
            'MarginPool: Sender is not Controller',
          )
        })
      })

      describe('withdraw long otoken', () => {
        it('should revert withdrawing long otoken with wrong index from a vault', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const longToWithdraw = createTokenAmount(20)
          const actionArgs = [
            {
              actionType: ActionType.WithdrawLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToWithdraw.toString(),
              index: '1',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'MarginVault: invalid long otoken index',
          )
        })

        it('should revert withdrawing long otoken from random address other than account owner or operator', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const longToWithdraw = createTokenAmount(20)
          const actionArgs = [
            {
              actionType: ActionType.WithdrawLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToWithdraw,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: random}),
            'Controller: msg.sender is not authorized to run action',
          )
        })

        it('should revert withdrawing long otoken amount greater than the vault balance', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]
          const longToWithdraw = new BigNumber(vaultBefore.longAmounts[0]).plus(1)
          const actionArgs = [
            {
              actionType: ActionType.WithdrawLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToWithdraw.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'SafeMath: subtraction overflow',
          )
        })

        it('should revert withdrawing long with invalid vault id', async () => {
          const vaultCounter = new BigNumber('100')

          const longToWithdraw = createTokenAmount(10)
          const actionArgs = [
            {
              actionType: ActionType.WithdrawLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToWithdraw,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(controllerProxy.operate(actionArgs, {from: accountOwner1}), 'Controller: invalid vault id')
        })

        it('should withdraw long otoken to any random address where msg.sender is account owner', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const longToWithdraw = createTokenAmount(10)
          const actionArgs = [
            {
              actionType: ActionType.WithdrawLongOption,
              owner: accountOwner1,
              secondAddress: random,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToWithdraw,
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const receiverBalanceBefore = new BigNumber(await longOtoken.balanceOf(random))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const receiverBalanceAfter = new BigNumber(await longOtoken.balanceOf(random))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            longToWithdraw.toString(),
            'Margin pool balance long otoken balance mismatch',
          )
          assert.equal(
            receiverBalanceAfter.minus(receiverBalanceBefore).toString(),
            longToWithdraw.toString(),
            'Receiver long otoken balance mismatch',
          )
          assert.equal(vaultAfter.longOtokens.length, 1, 'Vault long otoken array length mismatch')
          assert.equal(
            new BigNumber(vaultBefore.longAmounts[0]).minus(new BigNumber(vaultAfter.longAmounts[0])).toString(),
            longToWithdraw.toString(),
            'Long otoken amount in vault after withdraw mismatch',
          )
        })

        it('should withdraw long otoken to any random address where msg.sender is account operator', async () => {
          assert.equal(
            await controllerProxy.isOperator(accountOwner1, accountOperator1),
            true,
            'Operator address mismatch',
          )

          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const longToWithdraw = createTokenAmount(10)
          const actionArgs = [
            {
              actionType: ActionType.WithdrawLongOption,
              owner: accountOwner1,
              secondAddress: random,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToWithdraw,
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const receiverBalanceBefore = new BigNumber(await longOtoken.balanceOf(random))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await controllerProxy.operate(actionArgs, {from: accountOperator1})

          const marginPoolBalanceAfter = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const receiverBalanceAfter = new BigNumber(await longOtoken.balanceOf(random))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            longToWithdraw.toString(),
            'Margin pool balance long otoken balance mismatch',
          )
          assert.equal(
            receiverBalanceAfter.minus(receiverBalanceBefore).toString(),
            longToWithdraw.toString(),
            'Receiver long otoken balance mismatch',
          )
          assert.equal(vaultAfter.longOtokens.length, 1, 'Vault long otoken array length mismatch')
          assert.equal(
            new BigNumber(vaultBefore.longAmounts[0]).minus(new BigNumber(vaultAfter.longAmounts[0])).toString(),
            longToWithdraw.toString(),
            'Long otoken amount in vault after withdraw mismatch',
          )
        })

        it('should execute withdrawing long otoken in mutliple actions', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const longToWithdraw = new BigNumber(createTokenAmount(10))
          const actionArgs = [
            {
              actionType: ActionType.WithdrawLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToWithdraw.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.WithdrawLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToWithdraw.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const receiverBalanceBefore = new BigNumber(await longOtoken.balanceOf(accountOwner1))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const receiverBalanceAfter = new BigNumber(await longOtoken.balanceOf(accountOwner1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            longToWithdraw.multipliedBy(2).toString(),
            'Margin pool balance long otoken balance mismatch',
          )
          assert.equal(
            receiverBalanceAfter.minus(receiverBalanceBefore).toString(),
            longToWithdraw.multipliedBy(2).toString(),
            'Receiver long otoken balance mismatch',
          )
          assert.equal(vaultAfter.longOtokens.length, 1, 'Vault long otoken array length mismatch')
          assert.equal(
            new BigNumber(vaultBefore.longAmounts[0]).minus(new BigNumber(vaultAfter.longAmounts[0])).toString(),
            longToWithdraw.multipliedBy(2).toString(),
            'Long otoken amount in vault after withdraw mismatch',
          )
        })

        it('should remove otoken address from otoken array if amount is equal to zero after withdrawing', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          const longToWithdraw = new BigNumber(vaultBefore.longAmounts[0])
          const actionArgs = [
            {
              actionType: ActionType.WithdrawLongOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: longToWithdraw.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const receiverBalanceBefore = new BigNumber(await longOtoken.balanceOf(accountOwner1))

          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await longOtoken.balanceOf(marginPool.address))
          const receiverBalanceAfter = new BigNumber(await longOtoken.balanceOf(accountOwner1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            longToWithdraw.toString(),
            'Margin pool balance long otoken balance mismatch',
          )
          assert.equal(
            receiverBalanceAfter.minus(receiverBalanceBefore).toString(),
            longToWithdraw.toString(),
            'Receiver long otoken balance mismatch',
          )
          assert.equal(vaultAfter.longOtokens.length, 1, 'Vault long otoken array length mismatch')
          assert.equal(vaultAfter.longOtokens[0], ZERO_ADDR, 'Vault long otoken address after clearing mismatch')
          assert.equal(
            new BigNumber(vaultBefore.longAmounts[0]).minus(new BigNumber(vaultAfter.longAmounts[0])).toString(),
            longToWithdraw.toString(),
            'Long otoken amount in vault after withdraw mismatch',
          )
        })

        describe('withdraw expired long otoken', () => {
          let expiredLongOtoken: MockOtokenInstance

          before(async () => {
            const expiryTime = new BigNumber(60 * 60) // after 1 hour
            expiredLongOtoken = await MockOtoken.new()
            // init otoken
            await expiredLongOtoken.init(
              addressBook.address,
              weth.address,
              usdc.address,
              usdc.address,
              createTokenAmount(200),
              new BigNumber(await time.latest()).plus(expiryTime),
              true,
            )
            // some free money for the account owner
            const longToDeposit = createTokenAmount(100)
            await expiredLongOtoken.mintOtoken(accountOwner1, longToDeposit)
            // whitelist otoken
            await whitelist.whitelistOtoken(expiredLongOtoken.address, {from: owner})
            // deposit long otoken into vault
            const vaultId = new BigNumber('1')
            const actionArgs = [
              {
                actionType: ActionType.DepositLongOption,
                owner: accountOwner1,
                secondAddress: accountOwner1,
                asset: expiredLongOtoken.address,
                vaultId: vaultId.toNumber(),
                amount: longToDeposit,
                index: '0',
                data: ZERO_ADDR,
              },
            ]
            await expiredLongOtoken.approve(marginPool.address, longToDeposit, {from: accountOwner1})
            await controllerProxy.operate(actionArgs, {from: accountOwner1})
            const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultId))[0]
            assert.equal(vaultAfter.longOtokens.length, 1, 'Vault long otoken array length mismatch')
            assert.equal(
              vaultAfter.longOtokens[0],
              expiredLongOtoken.address,
              'Long otoken address deposited into vault mismatch',
            )
            assert.equal(
              new BigNumber(vaultAfter.longAmounts[0]).toString(),
              longToDeposit.toString(),
              'Long otoken amount deposited into vault mismatch',
            )
          })

          it('should revert withdrawing an expired long otoken', async () => {
            // increment time after expiredLongOtoken expiry
            await time.increase(3601) // increase time with one hour in seconds

            const vaultId = new BigNumber('1')
            const vault = (await controllerProxy.getVault(accountOwner1, vaultId))[0]
            const longToWithdraw = new BigNumber(vault.longAmounts[0])
            const actionArgs = [
              {
                actionType: ActionType.WithdrawLongOption,
                owner: accountOwner1,
                secondAddress: accountOwner1,
                asset: expiredLongOtoken.address,
                vaultId: vaultId.toNumber(),
                amount: longToWithdraw.toString(),
                index: '0',
                data: ZERO_ADDR,
              },
            ]

            assert.equal(
              await controllerProxy.hasExpired(expiredLongOtoken.address),
              true,
              'Long otoken is not expired yet',
            )

            await expectRevert(
              controllerProxy.operate(actionArgs, {from: accountOwner1}),
              'Controller: can not withdraw an expired otoken',
            )
          })
        })
      })
    })

    describe('Collateral asset', () => {
      describe('Deposit collateral asset', () => {
        it('should deposit a whitelisted collateral asset from account owner', async () => {
          // whitelist usdc
          await whitelist.whitelistCollateral(usdc.address)
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const collateralToDeposit = createTokenAmount(10, usdcDecimals)
          const actionArgs = [
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))

          await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceAfter.minus(marginPoolBalanceBefore).toString(),
            collateralToDeposit.toString(),
            'Margin pool balance collateral asset balance mismatch',
          )
          assert.equal(
            senderBalanceBefore.minus(senderBalanceAfter).toString(),
            collateralToDeposit.toString(),
            'Sender balance collateral asset balance mismatch',
          )
          assert.equal(vaultAfter.collateralAssets.length, 1, 'Vault collateral assets array length mismatch')
          assert.equal(
            vaultAfter.collateralAssets[0],
            usdc.address,
            'Collateral asset address deposited into vault mismatch',
          )
          assert.equal(
            new BigNumber(vaultAfter.collateralAmounts[0]).toString(),
            collateralToDeposit.toString(),
            'Collateral asset amount deposited into vault mismatch',
          )
        })

        it('should deposit a whitelisted collateral asset from account operator', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const collateralToDeposit = createTokenAmount(10, usdcDecimals)
          const actionArgs = [
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOperator1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await usdc.balanceOf(accountOperator1))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOperator1})
          await controllerProxy.operate(actionArgs, {from: accountOperator1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await usdc.balanceOf(accountOperator1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceAfter.minus(marginPoolBalanceBefore).toString(),
            collateralToDeposit.toString(),
            'Margin pool balance collateral asset balance mismatch',
          )
          assert.equal(
            senderBalanceBefore.minus(senderBalanceAfter).toString(),
            collateralToDeposit.toString(),
            'Sender balance collateral asset balance mismatch',
          )
          assert.equal(vaultAfter.collateralAssets.length, 1, 'Vault collateral assets array length mismatch')
          assert.equal(
            vaultAfter.collateralAssets[0],
            usdc.address,
            'Collateral asset address deposited into vault mismatch',
          )
          assert.equal(
            new BigNumber(vaultAfter.collateralAmounts[0])
              .minus(new BigNumber(vaultBefore.collateralAmounts[0]))
              .toString(),
            collateralToDeposit.toString(),
            'Long otoken amount deposited into vault mismatch',
          )
        })

        it('should revert depositing collateral asset with invalid vault id', async () => {
          const vaultCounter = new BigNumber('100')

          const collateralToDeposit = createTokenAmount(10, usdcDecimals)
          const actionArgs = [
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
          await expectRevert(controllerProxy.operate(actionArgs, {from: accountOwner1}), 'Controller: invalid vault id')
        })

        it('should revert depositing long from an address that is not the msg.sender nor the owner account address', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))

          const collateralToDeposit = createTokenAmount(10, usdcDecimals)
          const actionArgs = [
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: random,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await usdc.approve(marginPool.address, collateralToDeposit, {from: random})
          await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOperator1})
          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOperator1}),
            'Controller: cannot deposit collateral from this address',
          )
        })

        it('should revert depositing a collateral asset with amount equal to zero', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const collateralToDeposit = createTokenAmount(0, usdcDecimals)
          const actionArgs = [
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'MarginVault: invalid collateral amount',
          )
        })

        it('should execute depositing collateral into vault in multiple actions', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const collateralToDeposit = new BigNumber(createTokenAmount(20, usdcDecimals))
          const actionArgs = [
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDeposit.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDeposit.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await usdc.approve(marginPool.address, collateralToDeposit.multipliedBy(2), {from: accountOwner1})
          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceAfter.minus(marginPoolBalanceBefore).toString(),
            collateralToDeposit.multipliedBy(2).toString(),
            'Margin pool collateral balance mismatch',
          )
          assert.equal(
            senderBalanceBefore.minus(senderBalanceAfter).toString(),
            collateralToDeposit.multipliedBy(2).toString(),
            'Sender collateral asset balance mismatch',
          )
          assert.equal(vaultAfter.collateralAmounts.length, 1, 'Vault collateral asset array length mismatch')
          assert.equal(
            vaultAfter.collateralAssets[0],
            usdc.address,
            'Collateral asset address deposited into vault mismatch',
          )
          assert.equal(
            new BigNumber(vaultAfter.collateralAmounts[0])
              .minus(new BigNumber(vaultBefore.collateralAmounts[0]))
              .toString(),
            collateralToDeposit.multipliedBy(2).toString(),
            'Collateral asset amount deposited into vault mismatch',
          )
        })

        describe('Deposit un-whitelisted collateral asset', () => {
          it('should revert depositing a collateral asset that is not whitelisted', async () => {
            // deploy a shitcoin
            const trx: MockERC20Instance = await MockERC20.new('TRX', 'TRX', 18)
            await trx.mint(accountOwner1, new BigNumber('1000'))

            const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
            assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

            const collateralDeposit = createTokenAmount(10, wethDecimals)
            const actionArgs = [
              {
                actionType: ActionType.DepositCollateral,
                owner: accountOwner1,
                secondAddress: accountOwner1,
                asset: trx.address,
                vaultId: vaultCounter.toNumber(),
                amount: collateralDeposit,
                index: '0',
                data: ZERO_ADDR,
              },
            ]

            await trx.approve(marginPool.address, collateralDeposit, {from: accountOwner1})
            await expectRevert(
              controllerProxy.operate(actionArgs, {from: accountOwner1}),
              'Controller: asset is not whitelisted to be used as collateral',
            )
          })
        })

        it('should revert when vault have more than 1 collateral type', async () => {
          const collateralToDeposit = createTokenAmount(10, wethDecimals)
          //whitelist weth to use in this test
          await whitelist.whitelistCollateral(weth.address)
          await weth.mint(accountOwner1, collateralToDeposit)

          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const actionArgs = [
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: weth.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDeposit,
              index: '1',
              data: ZERO_ADDR,
            },
          ]

          await weth.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'MarginCalculator: Too many collateral assets in the vault',
          )
        })
      })

      describe('withdraw collateral', () => {
        it('should revert withdrawing collateral asset with wrong index from a vault', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const collateralToWithdraw = createTokenAmount(20, usdcDecimals)
          const actionArgs = [
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToWithdraw,
              index: '1',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'MarginVault: invalid collateral asset index',
          )
        })

        it('should revert withdrawing collateral asset from an invalid id', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const collateralToWithdraw = createTokenAmount(20, usdcDecimals)
          const actionArgs = [
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: '1350',
              amount: collateralToWithdraw,
              index: '1',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(controllerProxy.operate(actionArgs, {from: accountOwner1}), 'Controller: invalid vault id')
        })

        it('should revert withdrawing collateral asset amount greater than the vault balance', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]
          const collateralToWithdraw = new BigNumber(vaultBefore.collateralAmounts[0]).plus(1)
          const actionArgs = [
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToWithdraw.toNumber(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'SafeMath: subtraction overflow',
          )
        })

        it('should withdraw collateral to any random address where msg.sender is account owner', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const collateralToWithdraw = createTokenAmount(10, usdcDecimals)
          const actionArgs = [
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: random,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToWithdraw,
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const receiverBalanceBefore = new BigNumber(await usdc.balanceOf(random))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const receiverBalanceAfter = new BigNumber(await usdc.balanceOf(random))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            collateralToWithdraw.toString(),
            'Margin pool collateral asset balance mismatch',
          )
          assert.equal(
            receiverBalanceAfter.minus(receiverBalanceBefore).toString(),
            collateralToWithdraw.toString(),
            'Receiver collateral asset balance mismatch',
          )
          assert.equal(vaultAfter.collateralAssets.length, 1, 'Vault collateral asset array length mismatch')
          assert.equal(
            new BigNumber(vaultBefore.collateralAmounts[0])
              .minus(new BigNumber(vaultAfter.collateralAmounts[0]))
              .toString(),
            collateralToWithdraw.toString(),
            'Collateral asset amount in vault after withdraw mismatch',
          )
        })

        it('should withdraw collateral asset to any random address where msg.sender is account operator', async () => {
          assert.equal(
            await controllerProxy.isOperator(accountOwner1, accountOperator1),
            true,
            'Operator address mismatch',
          )

          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const collateralToWithdraw = createTokenAmount(10, usdcDecimals)
          const actionArgs = [
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: random,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToWithdraw,
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const receiverBalanceBefore = new BigNumber(await usdc.balanceOf(random))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await controllerProxy.operate(actionArgs, {from: accountOperator1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const receiverBalanceAfter = new BigNumber(await usdc.balanceOf(random))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            collateralToWithdraw.toString(),
            'Margin pool collateral asset balance mismatch',
          )
          assert.equal(
            receiverBalanceAfter.minus(receiverBalanceBefore).toString(),
            collateralToWithdraw.toString(),
            'Receiver collateral asset balance mismatch',
          )
          assert.equal(vaultAfter.collateralAssets.length, 1, 'Vault collateral asset array length mismatch')
          assert.equal(
            new BigNumber(vaultBefore.collateralAmounts[0])
              .minus(new BigNumber(vaultAfter.collateralAmounts[0]))
              .toString(),
            collateralToWithdraw.toString(),
            'Collateral asset amount in vault after withdraw mismatch',
          )
        })

        it('should execute withdrawing collateral asset in mutliple actions', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const collateralToWithdraw = new BigNumber(createTokenAmount(10, usdcDecimals))
          const actionArgs = [
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToWithdraw.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToWithdraw.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const receiverBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const receiverBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            collateralToWithdraw.multipliedBy(2).toString(),
            'Margin pool collateral asset balance mismatch',
          )
          assert.equal(
            receiverBalanceAfter.minus(receiverBalanceBefore).toString(),
            collateralToWithdraw.multipliedBy(2).toString(),
            'Receiver collateral asset balance mismatch',
          )
          assert.equal(vaultAfter.collateralAssets.length, 1, 'Vault long otoken array length mismatch')
          assert.equal(
            new BigNumber(vaultBefore.collateralAmounts[0])
              .minus(new BigNumber(vaultAfter.collateralAmounts[0]))
              .toString(),
            collateralToWithdraw.multipliedBy(2).toString(),
            'Collateral asset amount in vault after withdraw mismatch',
          )
        })

        it('should remove collateral asset address from collateral array if amount is equal to zero after withdrawing', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          const collateralToWithdraw = new BigNumber(vaultBefore.collateralAmounts[0])
          const actionArgs = [
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToWithdraw.toNumber(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const receiverBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))

          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const receiverBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            collateralToWithdraw.toString(),
            'Margin pool balance long otoken balance mismatch',
          )
          assert.equal(
            receiverBalanceAfter.minus(receiverBalanceBefore).toString(),
            collateralToWithdraw.toString(),
            'Receiver long otoken balance mismatch',
          )
          assert.equal(vaultAfter.collateralAssets.length, 1, 'Vault collateral asset array length mismatch')
          assert.equal(
            vaultAfter.collateralAssets[0],
            ZERO_ADDR,
            'Vault collater asset address after clearing mismatch',
          )
          assert.equal(
            new BigNumber(vaultBefore.collateralAmounts[0])
              .minus(new BigNumber(vaultAfter.collateralAmounts[0]))
              .toString(),
            collateralToWithdraw.toString(),
            'Collateral asset amount in vault after withdraw mismatch',
          )
        })
      })
    })

    describe('Short otoken', () => {
      let longOtoken: MockOtokenInstance
      let shortOtoken: MockOtokenInstance

      before(async () => {
        const expiryTime = new BigNumber(60 * 60 * 24) // after 1 day

        longOtoken = await MockOtoken.new()
        shortOtoken = await MockOtoken.new()
        // init otoken
        await longOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(250),
          new BigNumber(await time.latest()).plus(expiryTime),
          true,
        )
        await shortOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(200),
          new BigNumber(await time.latest()).plus(expiryTime),
          true,
        )

        // whitelist short otoken to be used in the protocol
        await whitelist.whitelistOtoken(shortOtoken.address, {from: owner})

        // give free money
        await longOtoken.mintOtoken(accountOwner1, new BigNumber('100'))
        await longOtoken.mintOtoken(accountOperator1, new BigNumber('100'))
        await usdc.mint(accountOwner1, new BigNumber('1000000'))
        await usdc.mint(accountOperator1, new BigNumber('1000000'))
        await usdc.mint(random, new BigNumber('1000000'))
      })

      describe('Mint short otoken', () => {
        it('should revert minting from random address other than owner or operator', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const amountToMint = createTokenAmount(1)
          const actionArgs = [
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: random,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: random}),
            'Controller: msg.sender is not authorized to run action',
          )
        })

        it('should revert minting using un-marginable collateral asset', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const collateralToDeposit = new BigNumber(await shortOtoken.strikePrice()).dividedBy(1e8)
          const amountToMint = createTokenAmount(1, wethDecimals)
          const actionArgs = [
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint,
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: weth.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDeposit.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          // free money
          await weth.mint(accountOwner1, collateralToDeposit)

          await weth.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'MarginCalculator: collateral asset not marginable for short asset',
          )
        })

        it('should revert minting short with invalid vault id', async () => {
          const vaultCounter = new BigNumber('100')

          const amountToMint = createTokenAmount(1)
          const actionArgs = [
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(controllerProxy.operate(actionArgs, {from: accountOwner1}), 'Controller: invalid vault id')
        })

        it('mint naked short otoken from owner', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const collateralToDeposit = new BigNumber(await shortOtoken.strikePrice()).dividedBy(100)
          const amountToMint = createTokenAmount(1)
          const actionArgs = [
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint,
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDeposit.toNumber(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
          const senderShortBalanceBefore = new BigNumber(await shortOtoken.balanceOf(accountOwner1))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
          const senderShortBalanceAfter = new BigNumber(await shortOtoken.balanceOf(accountOwner1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceAfter.minus(marginPoolBalanceBefore).toString(),
            collateralToDeposit.toString(),
            'Margin pool collateral asset balance mismatch',
          )
          assert.equal(
            senderBalanceBefore.minus(senderBalanceAfter).toString(),
            collateralToDeposit.toString(),
            'Sender collateral asset balance mismatch',
          )
          assert.equal(vaultAfter.collateralAssets.length, 1, 'Vault collateral asset array length mismatch')
          assert.equal(vaultAfter.shortOtokens.length, 1, 'Vault short otoken array length mismatch')
          assert.equal(
            vaultAfter.collateralAssets[0],
            usdc.address,
            'Collateral asset address deposited into vault mismatch',
          )
          assert.equal(
            vaultAfter.shortOtokens[0],
            shortOtoken.address,
            'Short otoken address deposited into vault mismatch',
          )
          assert.equal(
            senderShortBalanceAfter.minus(senderShortBalanceBefore).toString(),
            amountToMint.toString(),
            'Short otoken amount minted mismatch',
          )
          assert.equal(
            new BigNumber(vaultAfter.collateralAmounts[0])
              .minus(new BigNumber(vaultBefore.collateralAmounts[0]))
              .toString(),
            collateralToDeposit.toString(),
            'Collateral asset amount deposited into vault mismatch',
          )
          assert.equal(
            new BigNumber(vaultAfter.shortAmounts[0]).toString(),
            amountToMint.toString(),
            'Short otoken amount minted into vault mismatch',
          )
        })

        it('mint naked short otoken from operator', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const collateralToDeposit = new BigNumber(await shortOtoken.strikePrice()).dividedBy(100)
          const amountToMint = createTokenAmount(1)
          const actionArgs = [
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: accountOperator1,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint,
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOperator1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDeposit.toNumber(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await usdc.balanceOf(accountOperator1))
          const senderShortBalanceBefore = new BigNumber(await shortOtoken.balanceOf(accountOperator1))
          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOperator1})
          await controllerProxy.operate(actionArgs, {from: accountOperator1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await usdc.balanceOf(accountOperator1))
          const senderShortBalanceAfter = new BigNumber(await shortOtoken.balanceOf(accountOperator1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            marginPoolBalanceAfter.minus(marginPoolBalanceBefore).toString(),
            collateralToDeposit.toString(),
            'Margin pool collateral asset balance mismatch',
          )
          assert.equal(
            senderBalanceBefore.minus(senderBalanceAfter).toString(),
            collateralToDeposit.toString(),
            'Sender collateral asset balance mismatch',
          )
          assert.equal(vaultAfter.collateralAssets.length, 1, 'Vault collateral asset array length mismatch')
          assert.equal(vaultAfter.shortOtokens.length, 1, 'Vault short otoken array length mismatch')
          assert.equal(
            vaultAfter.collateralAssets[0],
            usdc.address,
            'Collateral asset address deposited into vault mismatch',
          )
          assert.equal(
            vaultAfter.shortOtokens[0],
            shortOtoken.address,
            'Short otoken address deposited into vault mismatch',
          )
          assert.equal(
            senderShortBalanceAfter.minus(senderShortBalanceBefore).toString(),
            amountToMint.toString(),
            'Short otoken amount minted mismatch',
          )
          assert.equal(
            new BigNumber(vaultAfter.collateralAmounts[0])
              .minus(new BigNumber(vaultBefore.collateralAmounts[0]))
              .toString(),
            collateralToDeposit.toString(),
            'Collateral asset amount deposited into vault mismatch',
          )
          assert.equal(
            new BigNumber(vaultAfter.shortAmounts[0]).minus(new BigNumber(vaultBefore.shortAmounts[0])).toString(),
            amountToMint.toString(),
            'Short otoken amount minted into vault mismatch',
          )
        })

        it('should revert withdrawing collateral from naked short position when net value is equal to zero', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter)

          const [netValue, isExcess] = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])

          const proceed = await controllerProxy.getProceed(accountOwner1, vaultCounter)
          assert.equal(netValue.toString(), proceed.toString())

          assert.equal(netValue.toString(), '0', 'Position net value mistmatch')
          assert.equal(isExcess, true, 'Position collateral excess mismatch')

          const collateralToWithdraw = new BigNumber(vaultBefore[0].collateralAmounts[0])
          const actionArgs = [
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToWithdraw.toNumber(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'Controller: invalid final vault state',
          )
        })

        it('should withdraw exceeded collateral from naked short position when net value > 0 ', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          // deposit more collateral
          const excessCollateralToDeposit = createTokenAmount(50, usdcDecimals)
          const firstActionArgs = [
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: excessCollateralToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          await usdc.approve(marginPool.address, excessCollateralToDeposit, {from: accountOwner1})
          await controllerProxy.operate(firstActionArgs, {from: accountOwner1})

          const vaultBefore = await controllerProxy.getVault(accountOwner1, vaultCounter)
          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const withdrawerBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))

          const [netValue, isExcess] = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])

          const proceed = await controllerProxy.getProceed(accountOwner1, vaultCounter)
          assert.equal(netValue.toString(), proceed.toString())

          assert.equal(netValue.toString(), excessCollateralToDeposit.toString(), 'Position net value mistmatch')
          assert.equal(isExcess, true, 'Position collateral excess mismatch')

          const secondActionArgs = [
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: excessCollateralToDeposit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await controllerProxy.operate(secondActionArgs, {from: accountOwner1})

          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]
          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const withdrawerBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            excessCollateralToDeposit.toString(),
            'Margin pool collateral asset balance mismatch',
          )
          assert.equal(
            withdrawerBalanceAfter.minus(withdrawerBalanceBefore).toString(),
            excessCollateralToDeposit.toString(),
            'Receiver collateral asset balance mismatch',
          )
          assert.equal(vaultAfter.collateralAssets.length, 1, 'Vault collateral asset array length mismatch')
          assert.equal(
            new BigNumber(vaultBefore[0].collateralAmounts[0])
              .minus(new BigNumber(vaultAfter.collateralAmounts[0]))
              .toString(),
            excessCollateralToDeposit.toString(),
            'Collateral asset amount in vault after withdraw mismatch',
          )
        })

        it('should revert when vault have more than 1 short otoken', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          await whitelist.whitelistOtoken(longOtoken.address, {from: owner})

          const amountToMint = '1'

          const actionArgs = [
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: longOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint,
              index: '1',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'MarginCalculator: Too many short otokens in the vault',
          )
        })

        describe('Mint un-whitelisted short otoken', () => {
          it('should revert minting an otoken that is not whitelisted in Whitelist module', async () => {
            const expiryTime = new BigNumber(60 * 60 * 24) // after 1 day

            const notWhitelistedShortOtoken: MockOtokenInstance = await MockOtoken.new()
            await notWhitelistedShortOtoken.init(
              addressBook.address,
              weth.address,
              usdc.address,
              usdc.address,
              createTokenAmount(200),
              new BigNumber(await time.latest()).plus(expiryTime),
              true,
            )

            const collateralToDeposit = new BigNumber(await notWhitelistedShortOtoken.strikePrice()).dividedBy(100)
            const amountToMint = createTokenAmount(1)
            const actionArgs = [
              {
                actionType: ActionType.OpenVault,
                owner: accountOperator1,
                secondAddress: accountOperator1,
                asset: ZERO_ADDR,
                vaultId: '1',
                amount: '0',
                index: '0',
                data: ZERO_ADDR,
              },
              {
                actionType: ActionType.MintShortOption,
                owner: accountOperator1,
                secondAddress: accountOperator1,
                asset: notWhitelistedShortOtoken.address,
                vaultId: '1',
                amount: amountToMint,
                index: '0',
                data: ZERO_ADDR,
              },
              {
                actionType: ActionType.DepositCollateral,
                owner: accountOperator1,
                secondAddress: accountOperator1,
                asset: usdc.address,
                vaultId: '1',
                amount: collateralToDeposit.toNumber(),
                index: '0',
                data: ZERO_ADDR,
              },
            ]

            await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOperator1})
            await expectRevert(
              controllerProxy.operate(actionArgs, {from: accountOperator1}),
              'Controller: otoken is not whitelisted to be minted',
            )
          })
        })

        describe('Mint negligible amount', () => {
          let oneDollarPut: MockOtokenInstance
          let smallestPut: MockOtokenInstance
          before('create options with small strike price', async () => {
            oneDollarPut = await MockOtoken.new()
            smallestPut = await MockOtoken.new()
            // init otoken
            await oneDollarPut.init(
              addressBook.address,
              weth.address,
              usdc.address,
              usdc.address,
              createTokenAmount(1),
              new BigNumber(await time.latest()).plus(86400),
              true,
            )
            await smallestPut.init(
              addressBook.address,
              weth.address,
              usdc.address,
              usdc.address,
              1,
              new BigNumber(await time.latest()).plus(86400),
              true,
            )
            await whitelist.whitelistOtoken(oneDollarPut.address)
            await whitelist.whitelistOtoken(smallestPut.address)
          })
          it('should revert if trying to mint 1 wei of oToken with strikePrice = 1 USD without putting collateral', async () => {
            const vaultId = (await controllerProxy.getAccountVaultCounter(accountOwner2)).toNumber() + 1
            const actionArgs = [
              {
                actionType: ActionType.OpenVault,
                owner: accountOwner2,
                secondAddress: accountOwner2,
                asset: ZERO_ADDR,
                vaultId: vaultId,
                amount: '0',
                index: '0',
                data: ZERO_ADDR,
              },
              {
                actionType: ActionType.MintShortOption,
                owner: accountOwner2,
                secondAddress: accountOwner2,
                asset: oneDollarPut.address,
                vaultId: vaultId,
                amount: '1',
                index: '0',
                data: ZERO_ADDR,
              },
            ]
            await expectRevert(
              controllerProxy.operate(actionArgs, {from: accountOwner2}),
              'Controller: invalid final vault state',
            )
          })

          it('should revert minting 1 wei of oToken with minimal strikePrice without putting collateral', async () => {
            const vaultId = (await controllerProxy.getAccountVaultCounter(accountOwner2)).toNumber() + 1
            const actionArgs = [
              {
                actionType: ActionType.OpenVault,
                owner: accountOwner2,
                secondAddress: accountOwner2,
                asset: ZERO_ADDR,
                vaultId: vaultId,
                amount: '0',
                index: '0',
                data: ZERO_ADDR,
              },
              {
                actionType: ActionType.MintShortOption,
                owner: accountOwner2,
                secondAddress: accountOwner2,
                asset: smallestPut.address,
                vaultId: vaultId,
                amount: '1',
                index: '0',
                data: ZERO_ADDR,
              },
            ]

            await expectRevert(
              controllerProxy.operate(actionArgs, {from: accountOwner2}),
              'Controller: invalid final vault state',
            )
          })
        })
      })

      describe('Burn short otoken', () => {
        it('should revert burning short otoken with wrong index from a vault', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const shortOtokenToBurn = await shortOtoken.balanceOf(accountOwner1)
          const actionArgs = [
            {
              actionType: ActionType.BurnShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: shortOtokenToBurn.toString(),
              index: '1',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'MarginVault: invalid short otoken index',
          )
        })

        it('should revert burning when there is no enough balance', async () => {
          // transfer operator balance
          const operatorShortBalance = new BigNumber(await shortOtoken.balanceOf(accountOperator1))
          await shortOtoken.transfer(accountOwner1, operatorShortBalance, {from: accountOperator1})

          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const shortOtokenToBurn = new BigNumber(await shortOtoken.balanceOf(accountOwner1))
          const actionArgs = [
            {
              actionType: ActionType.BurnShortOption,
              owner: accountOwner1,
              secondAddress: accountOperator1,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: shortOtokenToBurn.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOperator1}),
            'ERC20: burn amount exceeds balance',
          )

          // transfer back
          await shortOtoken.transfer(accountOperator1, operatorShortBalance, {from: accountOwner1})
        })

        it('should revert burning when called from an address other than account owner or operator', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const shortOtokenToBurn = new BigNumber(await shortOtoken.balanceOf(accountOwner1))
          const actionArgs = [
            {
              actionType: ActionType.BurnShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: shortOtokenToBurn.toString(),
              index: '1',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: random}),
            'Controller: msg.sender is not authorized to run action',
          )
        })

        it('should revert minting short with invalid vault id', async () => {
          const vaultCounter = new BigNumber('100')

          const shortOtokenToBurn = new BigNumber(await shortOtoken.balanceOf(accountOperator1))
          const actionArgs = [
            {
              actionType: ActionType.BurnShortOption,
              owner: accountOwner1,
              secondAddress: accountOperator1,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: shortOtokenToBurn.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(controllerProxy.operate(actionArgs, {from: accountOwner1}), 'Controller: invalid vault id')
        })

        it('should revert depositing long from an address that is not the msg.sender nor the owner account address', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))

          const shortOtokenToBurn = new BigNumber(await shortOtoken.balanceOf(accountOperator1))
          const actionArgs = [
            {
              actionType: ActionType.BurnShortOption,
              owner: accountOwner1,
              secondAddress: random,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: shortOtokenToBurn.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOperator1}),
            'Controller: cannot burn from this address',
          )
        })

        it('should burn short otoken when called from account operator', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          const shortOtokenToBurn = new BigNumber(await shortOtoken.balanceOf(accountOperator1))
          const actionArgs = [
            {
              actionType: ActionType.BurnShortOption,
              owner: accountOwner1,
              secondAddress: accountOperator1,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: shortOtokenToBurn.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const sellerBalanceBefore = new BigNumber(await shortOtoken.balanceOf(accountOperator1))

          await controllerProxy.operate(actionArgs, {from: accountOperator1})

          const sellerBalanceAfter = new BigNumber(await shortOtoken.balanceOf(accountOperator1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            sellerBalanceBefore.minus(sellerBalanceAfter).toString(),
            shortOtokenToBurn.toString(),
            'Short otoken burned amount mismatch',
          )
          assert.equal(vaultAfter.shortOtokens.length, 1, 'Vault short otoken array length mismatch')
          assert.equal(
            vaultAfter.shortOtokens[0],
            shortOtoken.address,
            'Vault short otoken address after burning mismatch',
          )
          assert.equal(
            new BigNumber(vaultBefore.shortAmounts[0]).minus(new BigNumber(vaultAfter.shortAmounts[0])).toString(),
            shortOtokenToBurn.toString(),
            'Short otoken amount in vault after burn mismatch',
          )
        })

        it('should remove short otoken address from short otokens array if amount is equal to zero after burning', async () => {
          // send back all short otoken to owner
          const operatorShortBalance = new BigNumber(await shortOtoken.balanceOf(accountOperator1))
          await shortOtoken.transfer(accountOwner1, operatorShortBalance, {from: accountOperator1})

          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

          const vaultBefore = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          const shortOtokenToBurn = new BigNumber(vaultBefore.shortAmounts[0])
          const actionArgs = [
            {
              actionType: ActionType.BurnShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: shortOtokenToBurn.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const sellerBalanceBefore = new BigNumber(await shortOtoken.balanceOf(accountOwner1))

          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const sellerBalanceAfter = new BigNumber(await shortOtoken.balanceOf(accountOwner1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]

          assert.equal(
            sellerBalanceBefore.minus(sellerBalanceAfter).toString(),
            shortOtokenToBurn.toString(),
            'Short otoken burned amount mismatch',
          )
          assert.equal(vaultAfter.shortOtokens.length, 1, 'Vault short otoken array length mismatch')
          assert.equal(vaultAfter.shortOtokens[0], ZERO_ADDR, 'Vault short otoken address after clearing mismatch')
          assert.equal(
            new BigNumber(vaultBefore.shortAmounts[0]).minus(new BigNumber(vaultAfter.shortAmounts[0])).toString(),
            shortOtokenToBurn.toString(),
            'Short otoken amount in vault after burn mismatch',
          )
        })

        it('should mint and burn at the same transaction', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
          // const vaultCounter = 1
          const amountToMint = createScaledNumber(1)
          const actionArgs = [
            {
              actionType: ActionType.OpenVault,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: ZERO_ADDR,
              vaultId: vaultCounter.toNumber(),
              amount: '0',
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint,
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.BurnShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: shortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint,
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          const senderShortBalanceBefore = new BigNumber(await shortOtoken.balanceOf(accountOwner1))
          await controllerProxy.operate(actionArgs, {from: accountOwner1})
          const senderShortBalanceAfter = new BigNumber(await shortOtoken.balanceOf(accountOwner1))
          const vaultAfter = (await controllerProxy.getVault(accountOwner1, vaultCounter))[0]
          assert.equal(vaultAfter.shortOtokens.length, 1, 'Vault short otoken array length mismatch')
          assert.equal(vaultAfter.shortOtokens[0], ZERO_ADDR)
          assert.equal(
            senderShortBalanceBefore.toString(),
            senderShortBalanceAfter.toString(),
            'Sender short otoken amount mismatch',
          )
        })

        describe('Expired otoken', () => {
          let expiredShortOtoken: MockOtokenInstance

          before(async () => {
            const vaultCounterBefore = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
            const expiryTime = new BigNumber(60 * 60) // after 1 hour
            expiredShortOtoken = await MockOtoken.new()
            // init otoken
            await expiredShortOtoken.init(
              addressBook.address,
              weth.address,
              usdc.address,
              usdc.address,
              createTokenAmount(200),
              new BigNumber(await time.latest()).plus(expiryTime),
              true,
            )

            // whitelist otoken to be minted
            await whitelist.whitelistOtoken(expiredShortOtoken.address, {from: owner})

            const collateralToDeposit = new BigNumber(await expiredShortOtoken.strikePrice()).dividedBy(100)
            const amountToMint = createTokenAmount(1)
            const actionArgs = [
              {
                actionType: ActionType.OpenVault,
                owner: accountOwner1,
                secondAddress: accountOwner1,
                asset: ZERO_ADDR,
                vaultId: vaultCounterBefore.toNumber() + 1,
                amount: '0',
                index: '0',
                data: ZERO_ADDR,
              },
              {
                actionType: ActionType.MintShortOption,
                owner: accountOwner1,
                secondAddress: accountOwner1,
                asset: expiredShortOtoken.address,
                vaultId: vaultCounterBefore.toNumber() + 1,
                amount: amountToMint,
                index: '0',
                data: ZERO_ADDR,
              },
              {
                actionType: ActionType.DepositCollateral,
                owner: accountOwner1,
                secondAddress: accountOwner1,
                asset: usdc.address,
                vaultId: vaultCounterBefore.toNumber() + 1,
                amount: collateralToDeposit.toNumber(),
                index: '0',
                data: ZERO_ADDR,
              },
            ]

            const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
            const senderBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))

            await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
            await controllerProxy.operate(actionArgs, {from: accountOwner1})

            const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
            const senderBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))

            assert.equal(
              marginPoolBalanceAfter.minus(marginPoolBalanceBefore).toString(),
              collateralToDeposit.toString(),
              'Margin pool collateral asset balance mismatch',
            )
            assert.equal(
              senderBalanceBefore.minus(senderBalanceAfter).toString(),
              collateralToDeposit.toString(),
              'Sender collateral asset balance mismatch',
            )
          })

          it('should revert burning an expired short otoken', async () => {
            // increment time after expiredLongOtoken expiry
            await time.increase(3601) // increase time with one hour in seconds

            const vaultId = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
            const shortAmountToBurn = new BigNumber('1')
            const actionArgs = [
              {
                actionType: ActionType.BurnShortOption,
                owner: accountOwner1,
                secondAddress: accountOwner1,
                asset: expiredShortOtoken.address,
                vaultId: vaultId.toNumber(),
                amount: shortAmountToBurn.toNumber(),
                index: '0',
                data: ZERO_ADDR,
              },
            ]

            assert.equal(
              await controllerProxy.hasExpired(expiredShortOtoken.address),
              true,
              'Long otoken is not expired yet',
            )

            await expectRevert(
              controllerProxy.operate(actionArgs, {from: accountOwner1}),
              'Controller: can not burn expired otoken',
            )
          })

          it('should revert minting an expired short otoken', async () => {
            const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
            assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

            const collateralToDeposit = new BigNumber(await expiredShortOtoken.strikePrice()).dividedBy(100)
            const amountToMint = createTokenAmount(1)
            const actionArgs = [
              {
                actionType: ActionType.MintShortOption,
                owner: accountOwner1,
                secondAddress: accountOwner1,
                asset: expiredShortOtoken.address,
                vaultId: vaultCounter.toNumber(),
                amount: amountToMint,
                index: '0',
                data: ZERO_ADDR,
              },
              {
                actionType: ActionType.DepositCollateral,
                owner: accountOwner1,
                secondAddress: accountOwner1,
                asset: usdc.address,
                vaultId: vaultCounter.toNumber(),
                amount: collateralToDeposit.toNumber(),
                index: '0',
                data: ZERO_ADDR,
              },
            ]

            await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOperator1})
            await expectRevert(
              controllerProxy.operate(actionArgs, {from: accountOwner1}),
              'Controller: can not mint expired otoken',
            )
          })
        })
      })
    })

    describe('Redeem', () => {
      let shortOtoken: MockOtokenInstance
      let fakeOtoken: MockOtokenInstance

      before(async () => {
        const expiryTime = new BigNumber(60 * 60 * 24) // after 1 day

        shortOtoken = await MockOtoken.new()
        // init otoken
        await shortOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(200),
          new BigNumber(await time.latest()).plus(expiryTime),
          true,
        )

        fakeOtoken = await MockOtoken.new()
        // init otoken
        await fakeOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(200),
          new BigNumber(await time.latest()).plus(expiryTime),
          true,
        )

        // whitelist short otoken to be used in the protocol
        await whitelist.whitelistOtoken(shortOtoken.address, {from: owner})
        // open new vault, mintnaked short, sell it to holder 1
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
        const collateralToDeposit = new BigNumber(await shortOtoken.strikePrice()).dividedBy(100)
        const amountToMint = createTokenAmount(1)
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: vaultCounter.toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: amountToMint,
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounter.toNumber(),
            amount: collateralToDeposit.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
        await controllerProxy.operate(actionArgs, {from: accountOwner1})
        // transfer minted short otoken to hodler`
        await shortOtoken.transfer(holder1, amountToMint.toString(), {from: accountOwner1})
      })
      it('should revert exercising non-whitelisted otoken', async () => {
        const shortAmountToBurn = new BigNumber('1')
        const actionArgs = [
          {
            actionType: ActionType.Redeem,
            owner: ZERO_ADDR,
            secondAddress: holder1,
            asset: fakeOtoken.address,
            vaultId: '0',
            amount: shortAmountToBurn.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: holder1}),
          'Controller: otoken is not whitelisted to be redeemed',
        )
      })

      it('should revert exercising un-expired otoken', async () => {
        const shortAmountToBurn = new BigNumber('1')
        const actionArgs = [
          {
            actionType: ActionType.Redeem,
            owner: ZERO_ADDR,
            secondAddress: holder1,
            asset: shortOtoken.address,
            vaultId: '0',
            amount: shortAmountToBurn.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        assert.equal(await controllerProxy.hasExpired(shortOtoken.address), false, 'Short otoken has already expired')

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: holder1}),
          'Controller: can not redeem un-expired otoken',
        )
      })

      it('should revert exercising after expiry, when underlying price is not finalized yet', async () => {
        // past time after expiry
        await time.increase(60 * 61 * 24) // increase time with one hour in seconds
        // set price in Oracle Mock, 150$ at expiry, expire ITM
        await oracle.setExpiryPriceFinalizedAllPeiodOver(
          await shortOtoken.underlyingAsset(),
          new BigNumber(await shortOtoken.expiryTimestamp()),
          createTokenAmount(150),
          true,
        )
        // set it as not finalized in mock
        await oracle.setIsDisputePeriodOver(
          await shortOtoken.underlyingAsset(),
          new BigNumber(await shortOtoken.expiryTimestamp()),
          false,
        )

        await oracle.setExpiryPriceFinalizedAllPeiodOver(
          await shortOtoken.strikeAsset(),
          new BigNumber(await shortOtoken.expiryTimestamp()),
          createTokenAmount(1),
          true,
        )

        const shortAmountToBurn = new BigNumber('1')
        const actionArgs = [
          {
            actionType: ActionType.Redeem,
            owner: ZERO_ADDR,
            secondAddress: holder1,
            asset: shortOtoken.address,
            vaultId: '0',
            amount: shortAmountToBurn.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        assert.equal(await controllerProxy.hasExpired(shortOtoken.address), true, 'Short otoken is not expired yet')

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: holder1}),
          'Controller: asset prices not finalized yet',
        )
      })

      it('should revert exercising if cash value receiver address in equal to address zero', async () => {
        // set it as finalized in mock
        await oracle.setIsDisputePeriodOver(
          await shortOtoken.underlyingAsset(),
          new BigNumber(await shortOtoken.expiryTimestamp()),
          true,
        )

        const shortAmountToBurn = createTokenAmount(1)
        const actionArgs = [
          {
            actionType: ActionType.Redeem,
            owner: ZERO_ADDR,
            secondAddress: ZERO_ADDR,
            asset: shortOtoken.address,
            vaultId: '0',
            amount: shortAmountToBurn,
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        assert.equal(await controllerProxy.hasExpired(shortOtoken.address), true, 'Short otoken is not expired yet')

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: holder1}),
          'Actions: cannot redeem to an invalid account',
        )
      })

      it('should redeem after expiry + price is finalized', async () => {
        const shortAmountToBurn = createTokenAmount(1)
        const actionArgs = [
          {
            actionType: ActionType.Redeem,
            owner: ZERO_ADDR,
            secondAddress: holder1,
            asset: shortOtoken.address,
            vaultId: '0',
            amount: shortAmountToBurn,
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        assert.equal(await controllerProxy.hasExpired(shortOtoken.address), true, 'Short otoken is not expired yet')

        const payout = createTokenAmount(50, usdcDecimals)
        const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
        const senderBalanceBefore = new BigNumber(await usdc.balanceOf(holder1))
        const senderShortBalanceBefore = new BigNumber(await shortOtoken.balanceOf(holder1))

        await controllerProxy.operate(actionArgs, {from: holder1})

        const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
        const senderBalanceAfter = new BigNumber(await usdc.balanceOf(holder1))
        const senderShortBalanceAfter = new BigNumber(await shortOtoken.balanceOf(holder1))

        assert.equal(
          marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
          payout.toString(),
          'Margin pool collateral asset balance mismatch',
        )
        assert.equal(
          senderBalanceAfter.minus(senderBalanceBefore).toString(),
          payout.toString(),
          'Sender collateral asset balance mismatch',
        )
        assert.equal(
          senderShortBalanceBefore.minus(senderShortBalanceAfter).toString(),
          shortAmountToBurn.toString(),
          ' Burned short otoken amount mismatch',
        )
      })

      it('should redeem call option correctly', async () => {
        const expiry = new BigNumber(await time.latest()).plus(new BigNumber(60 * 60)).toNumber()
        const call: MockOtokenInstance = await MockOtoken.new()
        await call.init(
          addressBook.address,
          weth.address,
          usdc.address,
          weth.address,
          createTokenAmount(200),
          expiry,
          false,
        )

        await whitelist.whitelistOtoken(call.address)
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
        const amountCollateral = createTokenAmount(1, wethDecimals)
        await weth.mint(accountOwner1, amountCollateral)
        await weth.approve(marginPool.address, amountCollateral, {from: accountOwner1})
        const amountOtoken = createTokenAmount(1)
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: vaultCounter.toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: weth.address,
            vaultId: vaultCounter.toNumber(),
            amount: amountCollateral,
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: call.address,
            vaultId: vaultCounter.toNumber(),
            amount: amountOtoken,
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await controllerProxy.operate(actionArgs, {from: accountOwner1})
        await call.transfer(holder1, amountOtoken, {from: accountOwner1})

        await time.increaseTo(expiry + 10)
        await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(400), true)
        await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)
        const redeemArgs = [
          {
            actionType: ActionType.Redeem,
            owner: ZERO_ADDR,
            secondAddress: holder1,
            asset: call.address,
            vaultId: '0',
            amount: amountOtoken,
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        const expectedPayout = createTokenAmount(0.5, wethDecimals)

        const userBalanceBefore = new BigNumber(await weth.balanceOf(holder1))
        await controllerProxy.operate(redeemArgs, {from: holder1})
        const userBalanceAfter = new BigNumber(await weth.balanceOf(holder1))
        assert.equal(userBalanceAfter.minus(userBalanceBefore).toString(), expectedPayout)
      })

      it('should revert redeem option if collateral is different from underlying, and collateral price is not finalized', async () => {
        const expiry = new BigNumber(await time.latest()).plus(new BigNumber(60 * 60)).toNumber()

        await whitelist.whitelistCollateral(weth2.address)
        const call: MockOtokenInstance = await MockOtoken.new()
        await call.init(
          addressBook.address,
          weth.address,
          usdc.address,
          weth2.address,
          createTokenAmount(200),
          expiry,
          false,
        )

        await oracle.setRealTimePrice(weth.address, createTokenAmount(400))
        await oracle.setRealTimePrice(weth2.address, createTokenAmount(400))

        await whitelist.whitelistOtoken(call.address)
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
        const amountCollateral = createTokenAmount(1, wethDecimals)
        await weth2.mint(accountOwner1, amountCollateral)
        await weth2.approve(marginPool.address, amountCollateral, {from: accountOwner1})

        const amountOtoken = createTokenAmount(1)
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: vaultCounter.toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: call.address,
            vaultId: vaultCounter.toNumber(),
            amount: amountOtoken,
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: weth2.address,
            vaultId: vaultCounter.toNumber(),
            amount: amountCollateral,
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await controllerProxy.operate(actionArgs, {from: accountOwner1})
        await call.transfer(holder1, amountOtoken, {from: accountOwner1})

        await time.increaseTo(expiry + 10)
        await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(400), true)
        await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)

        const redeemArgs = [
          {
            actionType: ActionType.Redeem,
            owner: ZERO_ADDR,
            secondAddress: holder1,
            asset: call.address,
            vaultId: '0',
            amount: amountOtoken,
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(
          controllerProxy.operate(redeemArgs, {from: holder1}),
          'Controller: asset prices not finalized yet',
        )
      })

      describe('Redeem multiple Otokens', () => {
        let firstOtoken: MockOtokenInstance
        let secondOtoken: MockOtokenInstance

        before(async () => {
          const expiryTime = new BigNumber(60 * 60 * 24) // after 1 day

          firstOtoken = await MockOtoken.new()
          secondOtoken = await MockOtoken.new()

          const expiry = new BigNumber(await time.latest()).plus(expiryTime)
          // init otoken
          await firstOtoken.init(
            addressBook.address,
            weth.address,
            usdc.address,
            usdc.address,
            createTokenAmount(200),
            expiry,
            true,
          )
          await secondOtoken.init(
            addressBook.address,
            weth.address,
            usdc.address,
            usdc.address,
            createTokenAmount(200),
            expiry,
            true,
          )
          // whitelist otoken to be used in the protocol
          await whitelist.whitelistOtoken(firstOtoken.address, {from: owner})
          await whitelist.whitelistOtoken(secondOtoken.address, {from: owner})

          // open new vault, mint naked short, sell it to holder 1
          const firstCollateralToDeposit = new BigNumber(await firstOtoken.strikePrice()).dividedBy(100)
          const secondCollateralToDeposit = new BigNumber(await secondOtoken.strikePrice()).dividedBy(100)
          const amountToMint = createTokenAmount(1)
          let vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
          let actionArgs = [
            {
              actionType: ActionType.OpenVault,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: ZERO_ADDR,
              vaultId: vaultCounter.toNumber(),
              amount: '0',
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: firstOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint,
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: firstCollateralToDeposit.toNumber(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          await usdc.approve(marginPool.address, firstCollateralToDeposit, {from: accountOwner1})
          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
          actionArgs = [
            {
              actionType: ActionType.OpenVault,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: ZERO_ADDR,
              vaultId: vaultCounter.toNumber(),
              amount: '0',
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: secondOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint,
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: secondCollateralToDeposit.toNumber(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          await usdc.approve(marginPool.address, firstCollateralToDeposit, {from: accountOwner1})
          await controllerProxy.operate(actionArgs, {from: accountOwner1})
          // transfer minted short otoken to hodler
          await firstOtoken.transfer(holder1, amountToMint, {from: accountOwner1})
          await secondOtoken.transfer(holder1, amountToMint, {from: accountOwner1})
        })

        it('should redeem multiple Otokens in one transaction', async () => {
          // past time after expiry
          await time.increase(60 * 61 * 24)
          // set price in Oracle Mock, 150$ at expiry, expire ITM
          await oracle.setExpiryPriceFinalizedAllPeiodOver(
            await firstOtoken.underlyingAsset(),
            new BigNumber(await firstOtoken.expiryTimestamp()),
            createTokenAmount(150),
            true,
          )
          await oracle.setExpiryPriceFinalizedAllPeiodOver(
            await secondOtoken.underlyingAsset(),
            new BigNumber(await secondOtoken.expiryTimestamp()),
            createTokenAmount(150),
            true,
          )

          await oracle.setExpiryPriceFinalizedAllPeiodOver(
            await firstOtoken.strikeAsset(),
            new BigNumber(await firstOtoken.expiryTimestamp()),
            createTokenAmount(1),
            true,
          )
          await oracle.setExpiryPriceFinalizedAllPeiodOver(
            await secondOtoken.strikeAsset(),
            new BigNumber(await firstOtoken.expiryTimestamp()),
            createTokenAmount(1),
            true,
          )

          const amountToRedeem = createTokenAmount(1)
          const actionArgs = [
            {
              actionType: ActionType.Redeem,
              owner: ZERO_ADDR,
              secondAddress: holder1,
              asset: firstOtoken.address,
              vaultId: '0',
              amount: amountToRedeem,
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.Redeem,
              owner: ZERO_ADDR,
              secondAddress: holder1,
              asset: secondOtoken.address,
              vaultId: '0',
              amount: amountToRedeem,
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          const payout = createTokenAmount(100, usdcDecimals)
          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await usdc.balanceOf(holder1))

          await controllerProxy.operate(actionArgs, {from: holder1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await usdc.balanceOf(holder1))
          const senderFirstBalanceAfter = new BigNumber(await firstOtoken.balanceOf(holder1))
          const senderSecondBalanceAfter = new BigNumber(await secondOtoken.balanceOf(holder1))

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            payout.toString(),
            'Margin pool collateral asset balance mismatch',
          )
          assert.equal(
            senderBalanceAfter.minus(senderBalanceBefore).toString(),
            payout.toString(),
            'Sender collateral asset balance mismatch',
          )
          assert.equal(senderFirstBalanceAfter.toString(), '0', ' Burned first otoken amount mismatch')
          assert.equal(senderSecondBalanceAfter.toString(), '0', ' Burned first otoken amount mismatch')
        })
      })
    })

    describe('Settle vault', () => {
      let shortOtoken: MockOtokenInstance

      before(async () => {
        const expiryTime = new BigNumber(60 * 60 * 24) // after 1 day

        shortOtoken = await MockOtoken.new()
        // init otoken
        await shortOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(200),
          new BigNumber(await time.latest()).plus(expiryTime),
          true,
        )
        // whitelist otoken to be used in the protocol
        await whitelist.whitelistOtoken(shortOtoken.address, {from: owner})
        // open new vault, mint naked short, sell it to holder 1
        const collateralToDespoit = new BigNumber(await shortOtoken.strikePrice()).dividedBy(100)
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: vaultCounter.toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounter.toNumber(),
            amount: collateralToDespoit.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await usdc.approve(marginPool.address, collateralToDespoit, {from: accountOwner1})
        await controllerProxy.operate(actionArgs, {from: accountOwner1})
      })

      it('should revert settling a vault that have no long or short otoken', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const actionArgs = [
          {
            actionType: ActionType.SettleVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          "Controller: Can't settle vault with no otoken",
        )
      })

      it('should revert settling vault before expiry', async () => {
        // mint token in vault before
        const amountToMint = createTokenAmount(1)
        let vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))

        let actionArgs = [
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: amountToMint,
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await controllerProxy.operate(actionArgs, {from: accountOwner1})
        await shortOtoken.transfer(holder1, amountToMint, {from: accountOwner1})

        vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        actionArgs = [
          {
            actionType: ActionType.SettleVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: can not settle vault with un-expired otoken',
        )
      })

      it('should revert settling an invalid vault', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const actionArgs = [
          {
            actionType: ActionType.SettleVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.plus(10000).toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(controllerProxy.operate(actionArgs, {from: accountOwner1}), 'Controller: invalid vault id')
      })

      it('should revert settling after expiry when price is not finalized', async () => {
        // past time after expiry
        await time.increase(60 * 61 * 24) // increase time with one hour in seconds
        // set price in Oracle Mock, 150$ at expiry, expire ITM
        const expiry = new BigNumber(await shortOtoken.expiryTimestamp())
        await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(150), true)
        // set it as not finalized in mock
        await oracle.setIsFinalized(
          await shortOtoken.underlyingAsset(),
          new BigNumber(await shortOtoken.expiryTimestamp()),
          false,
        )
        await oracle.setIsDisputePeriodOver(
          await shortOtoken.underlyingAsset(),
          new BigNumber(await shortOtoken.expiryTimestamp()),
          false,
        )

        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const actionArgs = [
          {
            actionType: ActionType.SettleVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        assert.equal(await controllerProxy.hasExpired(shortOtoken.address), true, 'Short otoken is not expired yet')

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: asset prices not finalized yet',
        )
      })

      it('should settle ITM otoken after expiry + price is finalized', async () => {
        const expiry = new BigNumber(await shortOtoken.expiryTimestamp())
        await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(150), true)
        await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const actionArgs = [
          {
            actionType: ActionType.SettleVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        const payout = createTokenAmount(150, usdcDecimals)
        const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
        const senderBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
        const proceed = await controllerProxy.getProceed(accountOwner1, vaultCounter)

        assert.equal(payout, proceed.toString())

        await controllerProxy.operate(actionArgs, {from: accountOwner1})

        const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
        const senderBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))

        assert.equal(
          marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
          payout.toString(),
          'Margin pool collateral asset balance mismatch',
        )
        assert.equal(
          senderBalanceAfter.minus(senderBalanceBefore).toString(),
          payout.toString(),
          'Sender collateral asset balance mismatch',
        )
      })

      it('should settle vault with only long otokens in it', async () => {
        const stirkePrice = 250
        const expiry = new BigNumber(await time.latest()).plus(86400)
        const longOtoken: MockOtokenInstance = await MockOtoken.new()
        // create a new otoken
        await longOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createScaledNumber(stirkePrice),
          expiry,
          true,
        )

        await whitelist.whitelistOtoken(longOtoken.address)

        // mint some long otokens, (so we can put it as long)
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
        const longAmount = createTokenAmount(1)
        const collateralAmount = createTokenAmount(stirkePrice, usdcDecimals)
        const mintArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: vaultCounter.toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: longOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: longAmount,
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounter.toNumber(),
            amount: collateralAmount,
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await usdc.approve(marginPool.address, collateralAmount, {from: accountOwner1})
        await controllerProxy.operate(mintArgs, {from: accountOwner1})

        // Use the newly minted otoken as long and put it in a new vault
        const newVulatId = vaultCounter.toNumber() + 1

        const newVaultArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: newVulatId,
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositLongOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: longOtoken.address,
            vaultId: newVulatId,
            amount: longAmount,
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await longOtoken.approve(marginPool.address, longAmount, {from: accountOwner1})
        await whitelist.whitelistOtoken(longOtoken.address)
        await controllerProxy.operate(newVaultArgs, {from: accountOwner1})
        // go to expiry
        await time.increaseTo(expiry.toNumber() + 10)
        const ethPriceAtExpiry = 200
        await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createScaledNumber(1), true)
        await oracle.setExpiryPriceFinalizedAllPeiodOver(
          weth.address,
          expiry,
          createScaledNumber(ethPriceAtExpiry),
          true,
        )
        // settle the secont vault (with only long otoken in it)
        const settleArgs = [
          {
            actionType: ActionType.SettleVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: newVulatId,
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        const expectedPayout = new BigNumber(createTokenAmount(stirkePrice - ethPriceAtExpiry, usdcDecimals))
        const ownerUSDCBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
        const poolOtokenBefore = new BigNumber(await longOtoken.balanceOf(marginPool.address))

        const amountPayout = await controllerProxy.getProceed(accountOwner1, newVulatId)

        assert.equal(amountPayout.toString(), expectedPayout.toString(), 'payout calculation mismatch')

        await controllerProxy.operate(settleArgs, {from: accountOwner1})
        const ownerUSDCBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
        const poolOtokenAfter = new BigNumber(await longOtoken.balanceOf(marginPool.address))
        assert.equal(
          ownerUSDCBalanceAfter.toString(),
          ownerUSDCBalanceBefore.plus(amountPayout).toString(),
          'settle long vault payout mismatch',
        )
        assert.equal(
          poolOtokenAfter.toString(),
          poolOtokenBefore.minus(new BigNumber(longAmount)).toString(),
          'settle long vault otoken mismatch',
        )
      })

      describe('Withdraw collateral from expired position', () => {
        let shortOtoken2: MockOtokenInstance
        const wethPriceAtExpiry = createTokenAmount(150)

        before(async () => {
          const expiryTime = new BigNumber(60 * 60 * 24) // after 1 day

          shortOtoken2 = await MockOtoken.new()
          // init otoken
          await shortOtoken2.init(
            addressBook.address,
            weth.address,
            usdc.address,
            usdc.address,
            createTokenAmount(200),
            new BigNumber(await time.latest()).plus(expiryTime),
            true,
          )
          // whitelist otoken to be used in the protocol
          await whitelist.whitelistOtoken(shortOtoken2.address, {from: owner})
          // open new vault, mint naked short, sell it to holder 1
          const collateralToDespoit = new BigNumber(await shortOtoken2.strikePrice()).dividedBy(100)
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
          const actionArgs = [
            {
              actionType: ActionType.OpenVault,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: ZERO_ADDR,
              vaultId: vaultCounter.toNumber(),
              amount: '0',
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: shortOtoken2.address,
              vaultId: vaultCounter.toNumber(),
              amount: createTokenAmount(1),
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDespoit.toNumber(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          await usdc.approve(marginPool.address, collateralToDespoit, {from: accountOwner1})
          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          // past time after expiry
          await time.increase(60 * 61 * 30) // increase time with one hour in seconds

          const expiry = new BigNumber(await shortOtoken2.expiryTimestamp())
          await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, wethPriceAtExpiry, true)
          await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)
        })

        it('it should revert withdrawing amount of collateral from vault after expiry more than the proceed amount', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const proceed = new BigNumber(await controllerProxy.getProceed(accountOwner1, vaultCounter))
          const amountToWithdraw = proceed.plus(100)

          const actionArgs = [
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToWithdraw.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          await expectRevert(
            controllerProxy.operate(actionArgs, {from: accountOwner1}),
            'Controller: invalid final vault state',
          )
        })

        it('withdraw collateral from expired position', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const actionArgs = [
            {
              actionType: ActionType.WithdrawCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: createTokenAmount(50, usdcDecimals),
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          const payout = createTokenAmount(50, usdcDecimals)
          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))

          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            payout.toString(),
            'Margin pool collateral asset balance mismatch',
          )
          assert.equal(
            senderBalanceAfter.minus(senderBalanceBefore).toString(),
            payout.toString(),
            'Sender collateral asset balance mismatch',
          )
        })

        it('should get correct payout amount when settling after already withdrawing from expired position', async () => {
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const actionArgs = [
            {
              actionType: ActionType.SettleVault,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: '0',
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          const payout = createTokenAmount(100, usdcDecimals)
          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))

          const proceed = await controllerProxy.getProceed(accountOwner1, vaultCounter, {from: accountOwner1})

          assert.equal(proceed.toString(), payout)

          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            payout.toString(),
            'Margin pool collateral asset balance mismatch',
          )
          assert.equal(
            senderBalanceAfter.minus(senderBalanceBefore).toString(),
            payout.toString(),
            'Sender collateral asset balance mismatch',
          )
        })
      })

      describe('Settle multiple vaults ATM and OTM', () => {
        let firstShortOtoken: MockOtokenInstance
        let secondShortOtoken: MockOtokenInstance

        before(async () => {
          let expiryTime = new BigNumber(60 * 60 * 24) // after 1 day

          firstShortOtoken = await MockOtoken.new()
          await firstShortOtoken.init(
            addressBook.address,
            weth.address,
            usdc.address,
            usdc.address,
            createTokenAmount(200),
            new BigNumber(await time.latest()).plus(expiryTime),
            true,
          )
          // whitelist otoken to be used in the protocol
          await whitelist.whitelistOtoken(firstShortOtoken.address, {from: owner})
          // open new vault, mint naked short, sell it to holder 1
          let collateralToDespoit = createTokenAmount(200, usdcDecimals)
          let amountToMint = createTokenAmount(1)
          let vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
          let actionArgs = [
            {
              actionType: ActionType.OpenVault,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: ZERO_ADDR,
              vaultId: vaultCounter.toNumber(),
              amount: '0',
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: firstShortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDespoit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          await usdc.approve(marginPool.address, collateralToDespoit, {from: accountOwner1})
          await controllerProxy.operate(actionArgs, {from: accountOwner1})

          expiryTime = new BigNumber(60 * 60 * 24 * 2) // after 1 day
          secondShortOtoken = await MockOtoken.new()
          await secondShortOtoken.init(
            addressBook.address,
            weth.address,
            usdc.address,
            usdc.address,
            createTokenAmount(200),
            new BigNumber(await time.latest()).plus(expiryTime),
            true,
          )
          // whitelist otoken to be used in the protocol
          await whitelist.whitelistOtoken(secondShortOtoken.address, {from: owner})
          // open new vault, mint naked short, sell it to holder 1
          collateralToDespoit = createTokenAmount(200, usdcDecimals)
          amountToMint = createTokenAmount(1)
          vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
          actionArgs = [
            {
              actionType: ActionType.OpenVault,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: ZERO_ADDR,
              vaultId: vaultCounter.toNumber(),
              amount: '0',
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.MintShortOption,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: secondShortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: amountToMint.toString(),
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.DepositCollateral,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: usdc.address,
              vaultId: vaultCounter.toNumber(),
              amount: collateralToDespoit,
              index: '0',
              data: ZERO_ADDR,
            },
          ]
          await usdc.approve(marginPool.address, collateralToDespoit, {from: accountOwner1})
          await controllerProxy.operate(actionArgs, {from: accountOwner1})
        })

        it('should settle multiple vaults in one transaction (ATM,OTM)', async () => {
          await time.increaseTo(new BigNumber(await secondShortOtoken.expiryTimestamp()).plus(1000).toString())
          const expiry = new BigNumber(await firstShortOtoken.expiryTimestamp())
          const expiry2 = new BigNumber(await secondShortOtoken.expiryTimestamp())
          await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(200), true)
          await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)
          await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry2, createTokenAmount(200), true)
          await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry2, createTokenAmount(1), true)
          const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
          const actionArgs = [
            {
              actionType: ActionType.SettleVault,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: secondShortOtoken.address,
              vaultId: vaultCounter.toNumber(),
              amount: '0',
              index: '0',
              data: ZERO_ADDR,
            },
            {
              actionType: ActionType.SettleVault,
              owner: accountOwner1,
              secondAddress: accountOwner1,
              asset: firstShortOtoken.address,
              vaultId: vaultCounter.minus(1).toNumber(),
              amount: '0',
              index: '0',
              data: ZERO_ADDR,
            },
          ]

          const payout = createTokenAmount(400, usdcDecimals)
          const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))

          controllerProxy.operate(actionArgs, {from: accountOwner1})

          const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
          const senderBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))

          assert.equal(
            marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
            payout,
            'Margin pool collateral asset balance mismatch',
          )
          assert.equal(
            senderBalanceAfter.minus(senderBalanceBefore).toString(),
            payout,
            'Sender collateral asset balance mismatch',
          )
        })
      })
    })

    describe('Check if price is finalized', () => {
      let expiredOtoken: MockOtokenInstance
      let expiry: BigNumber

      before(async () => {
        expiry = new BigNumber(await time.latest())
        expiredOtoken = await MockOtoken.new()
        // init otoken
        await expiredOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(200),
          new BigNumber(await time.latest()),
          true,
        )

        // set finalized
        await oracle.setIsFinalized(weth.address, expiry, true)
        await oracle.setIsDisputePeriodOver(weth.address, expiry, true)
      })

      it('should return false when price is pushed and dispute period not over yet', async () => {
        const priceMock = new BigNumber('200')

        // Mock oracle returned data.
        await oracle.setIsLockingPeriodOver(weth.address, expiry, true)
        await oracle.setIsDisputePeriodOver(weth.address, expiry, false)
        await oracle.setExpiryPrice(weth.address, expiry, priceMock)

        const underlying = await expiredOtoken.underlyingAsset()
        const strike = await expiredOtoken.strikeAsset()
        const collateral = await expiredOtoken.collateralAsset()
        const expiryTimestamp = await expiredOtoken.expiryTimestamp()

        const expectedResutl = false
        assert.equal(
          await controllerProxy.isSettlementAllowed(underlying, strike, collateral, expiryTimestamp),
          expectedResutl,
          'Price is not finalized because dispute period is not over yet',
        )
      })

      it('should return true when price is finalized', async () => {
        expiredOtoken = await MockOtoken.new()
        const expiry = new BigNumber(await time.latest())
        // init otoken
        await expiredOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(200),
          expiry,
          true,
        )

        // Mock oracle: dispute periodd over, set price to 200.
        const priceMock = new BigNumber('200')
        await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, priceMock, true)
        await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)

        const underlying = await expiredOtoken.underlyingAsset()
        const strike = await expiredOtoken.strikeAsset()
        const collateral = await expiredOtoken.collateralAsset()
        const expiryTimestamp = await expiredOtoken.expiryTimestamp()

        const expectedResutl = true
        assert.equal(
          await controllerProxy.isSettlementAllowed(underlying, strike, collateral, expiryTimestamp),
          expectedResutl,
          'Price is not finalized',
        )
      })
    })

    describe('Expiry', () => {
      it('should return false for non expired otoken', async () => {
        const otoken: MockOtokenInstance = await MockOtoken.new()
        await otoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(200),
          new BigNumber(await time.latest()).plus(60000 * 60000),
          true,
        )

        assert.equal(await controllerProxy.hasExpired(otoken.address), false, 'Otoken expiry check mismatch')
      })

      it('should return true for expired otoken', async () => {
        // Otoken deployment
        const expiredOtoken = await MockOtoken.new()
        // init otoken
        await expiredOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(200),
          1219835219,
          true,
        )

        assert.equal(await controllerProxy.hasExpired(expiredOtoken.address), true, 'Otoken expiry check mismatch')
      })
    })

    describe('Call action', () => {
      let callTester: CallTesterInstance

      before(async () => {
        callTester = await CallTester.new()
      })

      it('should call any arbitrary destination address when restriction is not activated', async () => {
        const actionArgs = [
          {
            actionType: ActionType.Call,
            owner: ZERO_ADDR,
            secondAddress: callTester.address,
            asset: ZERO_ADDR,
            vaultId: '0',
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        expectEvent(await controllerProxy.operate(actionArgs, {from: accountOwner1}), 'CallExecuted', {
          from: accountOwner1,
          to: callTester.address,
          data: ZERO_ADDR,
        })
      })

      it('should revert activating call action restriction from non-owner', async () => {
        await expectRevert(controllerProxy.setCallRestriction(true, {from: random}), 'Ownable: caller is not the owner')
      })

      it('should revert deactivating call action restriction when it is already deactivated', async () => {
        await expectRevert(controllerProxy.setCallRestriction(false, {from: owner}), 'Controller: invalid input')
      })

      it('should activate call action restriction from owner', async () => {
        await controllerProxy.setCallRestriction(true, {from: owner})

        assert.equal(await controllerProxy.callRestricted(), true, 'Call action restriction activation failed')
      })

      it('should revert activating call action restriction when it is already activated', async () => {
        await expectRevert(controllerProxy.setCallRestriction(true, {from: owner}), 'Controller: invalid input')
      })

      it('should revert calling any arbitrary address when call restriction is activated', async () => {
        const actionArgs = [
          {
            actionType: ActionType.Call,
            owner: ZERO_ADDR,
            secondAddress: callTester.address,
            asset: ZERO_ADDR,
            vaultId: '0',
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: callee is not a whitelisted address',
        )
      })

      it('should call whitelisted callee address when restriction is activated', async () => {
        // whitelist callee
        await whitelist.whitelistCallee(callTester.address, {from: owner})

        const actionArgs = [
          {
            actionType: ActionType.Call,
            owner: ZERO_ADDR,
            secondAddress: callTester.address,
            asset: ZERO_ADDR,
            vaultId: '0',
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        expectEvent(await controllerProxy.operate(actionArgs, {from: accountOwner1}), 'CallExecuted', {
          from: accountOwner1,
          to: callTester.address,
          data: ZERO_ADDR,
        })
      })
    })

    describe('Sync vault latest update timestamp', () => {
      it('should update vault latest update timestamp', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const timestampBefore = new BigNumber(
          (await controllerProxy.getVault(accountOwner1, vaultCounter.toNumber()))[2],
        )

        await controllerProxy.sync(accountOwner1, vaultCounter.toNumber(), {from: random})

        const timestampAfter = new BigNumber(
          (await controllerProxy.getVault(accountOwner1, vaultCounter.toNumber()))[2],
        )
        assert.isAbove(
          timestampAfter.toNumber(),
          timestampBefore.toNumber(),
          'Vault latest update timestamp did not sync',
        )
      })
    })

    describe('Pause mechanism', () => {
      let shortOtoken: MockOtokenInstance

      before(async () => {
        const vaultCounterBefore = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const expiryTime = new BigNumber(60 * 60) // after 1 hour
        shortOtoken = await MockOtoken.new()
        // init otoken
        await shortOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(200),
          new BigNumber(await time.latest()).plus(expiryTime),
          true,
        )

        // whitelist otoken to be minted
        await whitelist.whitelistOtoken(shortOtoken.address, {from: owner})

        const collateralToDeposit = createTokenAmount(200, usdcDecimals)
        const amountToMint = createTokenAmount(1) // mint 1 otoken
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: vaultCounterBefore.toNumber() + 1,
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounterBefore.toNumber() + 1,
            amount: amountToMint,
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounterBefore.toNumber() + 1,
            amount: collateralToDeposit,
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
        await controllerProxy.operate(actionArgs, {from: accountOwner1})
      })

      it('should revert set partialPauser address from non-owner', async () => {
        await expectRevert(
          controllerProxy.setPartialPauser(partialPauser, {from: random}),
          'Ownable: caller is not the owner',
        )
      })

      it('should revert set partialPauser address to address zero', async () => {
        await expectRevert(
          controllerProxy.setPartialPauser(ZERO_ADDR, {from: owner}),
          'Controller: partialPauser cannot be set to address zero',
        )
      })

      it('should set partialPauser address', async () => {
        await controllerProxy.setPartialPauser(partialPauser, {from: owner})
        assert.equal(await controllerProxy.partialPauser(), partialPauser, 'partialPauser address mismatch')
      })

      it('should revert set partialPauser address to the same previous address', async () => {
        await expectRevert(
          controllerProxy.setPartialPauser(await controllerProxy.partialPauser(), {from: owner}),
          'Controller: invalid input',
        )
      })

      it('should revert when pausing the system from address other than partialPauser', async () => {
        await expectRevert(
          controllerProxy.setSystemPartiallyPaused(true, {from: random}),
          'Controller: sender is not partialPauser',
        )
      })

      it('should revert partially un-pausing an already running paused system', async () => {
        await expectRevert(
          controllerProxy.setSystemPartiallyPaused(false, {from: partialPauser}),
          'Controller: invalid input',
        )
      })

      it('should pause system', async () => {
        const stateBefore = await controllerProxy.systemPartiallyPaused()
        assert.equal(stateBefore, false, 'System already paused')

        await controllerProxy.setSystemPartiallyPaused(true, {from: partialPauser})

        const stateAfter = await controllerProxy.systemPartiallyPaused()
        assert.equal(stateAfter, true, 'System not paused')
      })

      it('should revert partially pausing an already patially paused system', async () => {
        await expectRevert(
          controllerProxy.setSystemPartiallyPaused(true, {from: partialPauser}),
          'Controller: invalid input',
        )
      })

      it('should revert opening a vault when system is partially paused', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: vaultCounter.toNumber() + 1,
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is partially paused',
        )
      })

      it('should revert depositing collateral when system is partially paused', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const collateralToDeposit = new BigNumber(await shortOtoken.strikePrice()).dividedBy(1e8)
        const actionArgs = [
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounter.toNumber() + 1,
            amount: collateralToDeposit.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is partially paused',
        )
      })

      it('should revert minting short otoken when system is partially paused', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const collateralToDeposit = new BigNumber(await shortOtoken.strikePrice()).dividedBy(1e8)
        const actionArgs = [
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: '1',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounter.toNumber(),
            amount: collateralToDeposit.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is partially paused',
        )
      })

      it('should revert withdrawing collateral when system is partially paused', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const collateralToWithdraw = new BigNumber(await shortOtoken.strikePrice()).dividedBy(100)
        const actionArgs = [
          {
            actionType: ActionType.WithdrawCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounter.toNumber(),
            amount: collateralToWithdraw.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is partially paused',
        )
      })

      it('should revert burning short otoken when system is partially paused', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const actionArgs = [
          {
            actionType: ActionType.BurnShortOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: '1',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is partially paused',
        )
      })

      it('should settle vault when system is partially paused', async () => {
        // past time after expiry
        await time.increase(60 * 61) // increase time with one hour in seconds
        // set price in Oracle Mock, 150$ at expiry, expire ITM
        const expiry = new BigNumber(await shortOtoken.expiryTimestamp())
        await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(150), true)
        await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)

        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const actionArgs = [
          {
            actionType: ActionType.SettleVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        const payout = createTokenAmount(150, usdcDecimals)
        const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
        const senderBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))

        await controllerProxy.operate(actionArgs, {from: accountOwner1})

        const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
        const senderBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))

        assert.equal(
          marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
          payout.toString(),
          'Margin pool collateral asset balance mismatch',
        )
        assert.equal(
          senderBalanceAfter.minus(senderBalanceBefore).toString(),
          payout.toString(),
          'Seller collateral asset balance mismatch',
        )
      })

      it('should redeem when system is partially paused', async () => {
        const amountToRedeem = createTokenAmount(1)
        // transfer to holder
        await shortOtoken.transfer(holder1, amountToRedeem, {from: accountOwner1})

        const actionArgs = [
          {
            actionType: ActionType.Redeem,
            owner: ZERO_ADDR,
            secondAddress: holder1,
            asset: shortOtoken.address,
            vaultId: '0',
            amount: amountToRedeem,
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        assert.equal(await controllerProxy.hasExpired(shortOtoken.address), true, 'Short otoken is not expired yet')

        const payout = createTokenAmount(50, usdcDecimals)
        const marginPoolBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
        const senderBalanceBefore = new BigNumber(await usdc.balanceOf(holder1))
        const senderShortBalanceBefore = new BigNumber(await shortOtoken.balanceOf(holder1))

        await controllerProxy.operate(actionArgs, {from: holder1})

        const marginPoolBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
        const senderBalanceAfter = new BigNumber(await usdc.balanceOf(holder1))
        const senderShortBalanceAfter = new BigNumber(await shortOtoken.balanceOf(holder1))

        assert.equal(
          marginPoolBalanceBefore.minus(marginPoolBalanceAfter).toString(),
          payout.toString(),
          'Margin pool collateral asset balance mismatch',
        )
        assert.equal(
          senderBalanceAfter.minus(senderBalanceBefore).toString(),
          payout.toString(),
          'Sender collateral asset balance mismatch',
        )
        assert.equal(
          senderShortBalanceBefore.minus(senderShortBalanceAfter).toString(),
          amountToRedeem.toString(),
          ' Burned short otoken amount mismatch',
        )
      })
    })

    describe('Full Pause', () => {
      let shortOtoken: MockOtokenInstance

      before(async () => {
        // deactivate pausing mechanism
        await controllerProxy.setSystemPartiallyPaused(false, {from: partialPauser})

        const vaultCounterBefore = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const expiryTime = new BigNumber(60 * 60) // after 1 hour
        shortOtoken = await MockOtoken.new()
        // init otoken
        await shortOtoken.init(
          addressBook.address,
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(200),
          new BigNumber(await time.latest()).plus(expiryTime),
          true,
        )

        // whitelist otoken to be minted
        await whitelist.whitelistOtoken(shortOtoken.address, {from: owner})

        const collateralToDeposit = createTokenAmount(200, usdcDecimals)
        const amountToMint = createTokenAmount(1) // mint 1 otoken
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: vaultCounterBefore.toNumber() + 1,
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounterBefore.toNumber() + 1,
            amount: amountToMint,
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounterBefore.toNumber() + 1,
            amount: collateralToDeposit,
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
        await controllerProxy.operate(actionArgs, {from: accountOwner1})
      })

      it('should revert set fullPauser address from non-owner', async () => {
        await expectRevert(
          controllerProxy.setFullPauser(fullPauser, {from: random}),
          'Ownable: caller is not the owner',
        )
      })

      it('should revert set fullPauser address to address zero', async () => {
        await expectRevert(
          controllerProxy.setFullPauser(ZERO_ADDR, {from: owner}),
          'Controller: fullPauser cannot be set to address zero',
        )
      })

      it('should set fullPauser address', async () => {
        await controllerProxy.setFullPauser(fullPauser, {from: owner})
        assert.equal(await controllerProxy.fullPauser(), fullPauser, 'fullPauser address mismatch')
      })

      it('should revert set fullPauser address to the same previous address', async () => {
        await expectRevert(
          controllerProxy.setFullPauser(await controllerProxy.fullPauser(), {from: owner}),
          'Controller: invalid input',
        )
      })

      it('should revert when triggering full pause from address other than fullPauser', async () => {
        await expectRevert(
          controllerProxy.setSystemFullyPaused(true, {from: random}),
          'Controller: sender is not fullPauser',
        )
      })

      it('should revert fully un-pausing an already running system', async () => {
        await expectRevert(controllerProxy.setSystemFullyPaused(false, {from: fullPauser}), 'Controller: invalid input')
      })

      it('should trigger full pause', async () => {
        const stateBefore = await controllerProxy.systemFullyPaused()
        assert.equal(stateBefore, false, 'System already in full pause state')

        await controllerProxy.setSystemFullyPaused(true, {from: fullPauser})

        const stateAfter = await controllerProxy.systemFullyPaused()
        assert.equal(stateAfter, true, 'System not in full pause state')
      })

      it('should revert fully pausing an already fully paused system', async () => {
        await expectRevert(controllerProxy.setSystemFullyPaused(true, {from: fullPauser}), 'Controller: invalid input')
      })

      it('should revert opening a vault when system is in full pause state', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const actionArgs = [
          {
            actionType: ActionType.OpenVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: ZERO_ADDR,
            vaultId: vaultCounter.toNumber() + 1,
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is fully paused',
        )
      })

      it('should revert depositing collateral when system is in full pause state', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const collateralToDeposit = new BigNumber(await shortOtoken.strikePrice()).dividedBy(1e8)
        const actionArgs = [
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounter.toNumber() + 1,
            amount: collateralToDeposit.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is fully paused',
        )
      })

      it('should revert minting short otoken when system is in full pause state', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const collateralToDeposit = new BigNumber(await shortOtoken.strikePrice()).dividedBy(1e8)
        const actionArgs = [
          {
            actionType: ActionType.MintShortOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: '1',
            index: '0',
            data: ZERO_ADDR,
          },
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounter.toNumber(),
            amount: collateralToDeposit.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is fully paused',
        )
      })

      it('should revert withdrawing collateral when system is in full pause state', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const collateralToWithdraw = new BigNumber(await shortOtoken.strikePrice()).dividedBy(1e8)
        const actionArgs = [
          {
            actionType: ActionType.WithdrawCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounter.toNumber(),
            amount: collateralToWithdraw.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is fully paused',
        )
      })

      it('should revert burning short otoken when system is in full pause state', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const actionArgs = [
          {
            actionType: ActionType.BurnShortOption,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: '1',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is fully paused',
        )
      })

      it('should revert settling vault when system is in full pause state', async () => {
        // past time after expiry
        await time.increase(60 * 61) // increase time with one hour in seconds
        // set price in Oracle Mock, 150$ at expiry, expire ITM
        await oracle.setExpiryPrice(
          await shortOtoken.underlyingAsset(),
          new BigNumber(await shortOtoken.expiryTimestamp()),
          createTokenAmount(150),
        )
        // set it as finalized in mock
        await oracle.setIsFinalized(
          await shortOtoken.underlyingAsset(),
          new BigNumber(await shortOtoken.expiryTimestamp()),
          true,
        )
        await oracle.setIsDisputePeriodOver(
          await shortOtoken.underlyingAsset(),
          new BigNumber(await shortOtoken.expiryTimestamp()),
          true,
        )

        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        const actionArgs = [
          {
            actionType: ActionType.SettleVault,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: shortOtoken.address,
            vaultId: vaultCounter.toNumber(),
            amount: '0',
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is fully paused',
        )
      })

      it('should revert redeem when system is in full pause state', async () => {
        const shortAmountToBurn = new BigNumber('1')
        // transfer to holder
        await shortOtoken.transfer(holder1, shortAmountToBurn, {from: accountOwner1})

        const actionArgs = [
          {
            actionType: ActionType.Redeem,
            owner: ZERO_ADDR,
            secondAddress: holder1,
            asset: shortOtoken.address,
            vaultId: '0',
            amount: shortAmountToBurn.toNumber(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await expectRevert(
          controllerProxy.operate(actionArgs, {from: accountOwner1}),
          'Controller: system is fully paused',
        )
      })
    })

    describe('Refresh configuration', () => {
      it('should revert refreshing configuration from address other than owner', async () => {
        await expectRevert(controllerProxy.refreshConfiguration({from: random}), 'Ownable: caller is not the owner')
      })

      it('should refresh configuratiom', async () => {
        // update modules
        const oracle = await MockOracle.new(addressBook.address, {from: owner})
        const calculator = await MarginCalculator.new(addressBook.address, {from: owner})
        const marginPool = await MarginPool.new(addressBook.address, {from: owner})
        const whitelist = await MockWhitelistModule.new({from: owner})

        await addressBook.setOracle(oracle.address)
        await addressBook.setMarginCalculator(calculator.address)
        await addressBook.setMarginPool(marginPool.address)
        await addressBook.setWhitelist(whitelist.address)

        // referesh controller configuration
        await controllerProxy.refreshConfiguration()
        const [_whitelist, _oracle, _calculator, _pool] = await controllerProxy.getConfiguration()
        assert.equal(_oracle, oracle.address, 'Oracle address mismatch after refresh')
        assert.equal(_calculator, calculator.address, 'Calculator address mismatch after refresh')
        assert.equal(_pool, marginPool.address, 'Oracle address mismatch after refresh')
        assert.equal(_whitelist, whitelist.address, 'Oracle address mismatch after refresh')
      })
    })

    describe('Execute an invalid action', () => {
      it('Should execute transaction with no state updates', async () => {
        const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
        assert.isAbove(vaultCounter.toNumber(), 0, 'Account owner have no vault')

        const collateralToDeposit = createTokenAmount(10, usdcDecimals)
        const actionArgs = [
          {
            actionType: ActionType.InvalidAction,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounter.toNumber(),
            amount: collateralToDeposit,
            index: '0',
            data: ZERO_ADDR,
          },
        ]

        await usdc.approve(marginPool.address, collateralToDeposit, {from: accountOwner1})
        await expectRevert.unspecified(controllerProxy.operate(actionArgs, {from: accountOwner1}))
      })
    })
  },
)
