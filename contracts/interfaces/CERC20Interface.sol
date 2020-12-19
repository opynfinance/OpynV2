/**
 * SPDX-License-Identifier: UNLICENSED
 */
pragma solidity 0.6.10;

import {ERC20Interface} from "./ERC20Interface.sol";

/**
 * @dev Interface of Compound cERC20 Token
 */
interface CERC20Interface is ERC20Interface {
    function redeem(uint256 redeemTokens) external returns (uint256);

    function mint(uint256 mintAmount) external returns (uint256);

    function underlying() external returns (address);
}
