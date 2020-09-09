/**
 * SPDX-License-Identifier: UNLICENSED
 */
pragma solidity 0.6.10;

/**
 * @dev Contract interface that can be called from Controller as a call action.
 */
interface CalleeInterface {
    /**
     * Allows users to send this contract arbitrary data.
     * @param sender The msg.sender to Controller
     * @param owner The vault owner
     * @param data Arbitrary data given by the sender
     */
    function callFunction(
        address _sender,
        address _vaultOwner,
        uint256 _vaultId,
        bytes memory _data
    ) external;
}
