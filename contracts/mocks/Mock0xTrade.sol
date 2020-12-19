/**
 * SPDX-License-Identifier: UNLICENSED
 */
pragma solidity 0.6.10;

pragma experimental ABIEncoderV2;

import {IZeroXExchange} from "../interfaces/ZeroXExchangeInterface.sol";
import {ERC20Interface} from "../interfaces/ERC20Interface.sol";
import {SafeERC20} from "../packages/oz/SafeERC20.sol";
import {Mock0xERC20Proxy} from "./Mock0xERC20Proxy.sol";

/**
 * @notice Mock 0x Exchange
 */
contract Mock0xTrade {
    using SafeERC20 for ERC20Interface;

    Mock0xERC20Proxy public proxy;

    /**
     * @dev Mock function that take an amount of asset from _sender address
     */
    function callFunction(address payable _sender, bytes memory _data) external {
        (address asset, uint256 amount) = abi.decode(_data, (address, uint256));

        ERC20Interface(asset).safeTransferFrom(_sender, address(this), amount);
    }
}
