/**
 * SPDX-License-Identifier: UNLICENSED
 */
pragma solidity 0.6.10;

/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface CalleeInterface {
    /**
     * Allows users to send this contract arbitrary data.
     * @param sender The msg.sender to Controller
     * @param owner The vault owner
     * @param data Arbitrary data given by the sender
     */
    function callFunction(
        address sender,
        address owner,
        bytes memory data
    ) external;
}
