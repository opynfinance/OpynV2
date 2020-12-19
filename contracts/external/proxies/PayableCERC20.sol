/**
 * SPDX-License-Identifier: UNLICENSED
 */
pragma solidity =0.6.10;
pragma experimental ABIEncoderV2;

import {ReentrancyGuard} from "../../packages/oz/ReentrancyGuard.sol";
import {SafeERC20} from "../../packages/oz/SafeERC20.sol";
import {Address} from "../../packages/oz/Address.sol";
import {ERC20Interface} from "../../interfaces/ERC20Interface.sol";
import {CERC20Interface} from "../../interfaces/CERC20Interface.sol";
import {Actions} from "../../libs/Actions.sol";
import {Controller} from "../../Controller.sol";
import {WETH9} from "../canonical-weth/WETH9.sol";

/**
 * @title CERC20Proxy
 * @author Opyn Team
 * @dev Contract for wrapping cToken before minting options
 */
contract PayableCERC20 is ReentrancyGuard {
    using SafeERC20 for ERC20Interface;
    using SafeERC20 for CERC20Interface;
    using Address for address payable;

    address public marginPool;

    CERC20Interface public cToken;
    ERC20Interface public underlying;
    Controller public controller;
    WETH9 public weth;

    constructor(
        address _controller,
        address _marginPool,
        address _cToken,
        address payable _weth
    ) public {
        require(_controller != address(0), "PayableCERC20: invalid controller address");

        controller = Controller(_controller);
        marginPool = _marginPool;
        cToken = CERC20Interface(_cToken);
        underlying = ERC20Interface(cToken.underlying());
        weth = WETH9(_weth);

        ERC20Interface(address(weth)).safeApprove(_marginPool, uint256(-1));
    }

    /**
     * @notice fallback function which disallows ETH to be sent to this contract without data except when unwrapping WETH
     */
    fallback() external payable {
        require(msg.sender == address(weth), "PayableCERC20: Cannot receive ETH");
    }

    /**
     * @notice execute a number of actions after minting some cTokens
     * @dev a wrapper for the Controller operate function, to wrap uderlying to cToken before the excution.
     * @param _actions array of actions arguments
     * @param _amountUnderlying the amount of underlying to supply to Compound
     */
    function operate(
        Actions.ActionArgs[] memory _actions,
        address payable sendEthTo,
        uint256 _amountUnderlying
    ) external payable nonReentrant {
        uint256 cTokenBalance;

        // create WETH from ETH
        if (msg.value != 0) {
            weth.deposit{value: msg.value}();
        }
        if (_amountUnderlying > 0) {
            underlying.safeTransferFrom(msg.sender, address(this), _amountUnderlying);
            // mint cToken
            underlying.safeIncreaseAllowance(address(cToken), _amountUnderlying);

            require(cToken.mint(_amountUnderlying) == 0, "PayableCERC20: cToken mint failed");

            cTokenBalance = cToken.balanceOf(address(this));
            cToken.safeIncreaseAllowance(marginPool, cTokenBalance);
        }

        // verify sender
        for (uint256 i = 0; i < _actions.length; i++) {
            Actions.ActionArgs memory action = _actions[i];

            // check that msg.sender is an owner or operator
            if (action.owner != address(0)) {
                require(
                    (msg.sender == action.owner) || (controller.isOperator(action.owner, msg.sender)),
                    "PayableCERC20: msg.sender is not owner or operator "
                );
            }

            // overwrite the deposit amount by the exact amount minted
            if (
                action.actionType == Actions.ActionType.DepositCollateral &&
                action.amount == 0 &&
                action.asset == address(cToken)
            ) {
                _actions[i].amount = cTokenBalance;
            }
            // pull tokens to proxy if user is trying to redeem
            if (action.actionType == Actions.ActionType.Redeem) {
                ERC20Interface(action.asset).safeTransferFrom(msg.sender, address(this), action.amount);
            }
            // check if Call action exist, approve WETH to Callee
            if (action.actionType == Actions.ActionType.Call) {
                ERC20Interface(address(weth)).safeIncreaseAllowance(
                    action.secondAddress,
                    msg.value
                );
            }
        }

        controller.operate(_actions);

        // unwrap and withdraw cTokens that have been added to contract via operate function
        uint256 cTokenBalanceAfter = cToken.balanceOf(address(this));
        if (cTokenBalanceAfter > 0) {
            require(cToken.redeem(cTokenBalanceAfter) == 0, "PayableCERC20: Redeem Failed");

            uint256 underlyingBalance = underlying.balanceOf(address(this));
            underlying.safeTransfer(msg.sender, underlyingBalance);
        }
        // return all remaining WETH to the sendEthTo address as ETH
        uint256 remainingWeth = weth.balanceOf(address(this));
        if (remainingWeth != 0) {
            require(sendEthTo != address(0), "PayableCERC20: cannot send ETH to address zero");

            weth.withdraw(remainingWeth);
            sendEthTo.sendValue(remainingWeth);
        }
    }
}
