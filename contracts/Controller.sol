/**
 * SPDX-License-Identifier: UNLICENSED
 */
pragma solidity =0.6.10;

pragma experimental ABIEncoderV2;

import {Ownable} from "./packages/oz/Ownable.sol";
import {SafeMath} from "./packages/oz/SafeMath.sol";
import {MarginAccount} from "./libs/MarginAccount.sol";
import {Actions} from "./libs/Actions.sol";

/**
 * @author Opyn Team
 * @title Controller
 * @notice contract that
 */
contract Controller is Ownable {
    using SafeMath for uint256;

    /// @dev AddressBook module
    address internal addressBook;

    /// @dev the protocol state, if true, then all protocol functionality are paused.
    bool internal systemPaused;

    /// @dev mapping between owner address and account structure
    mapping(address => MarginAccount.Account) internal accounts;
    /// @dev mapping between owner address and specific vault using vaultId
    mapping(address => mapping(uint256 => MarginAccount.Vault)) internal vaults;
    /// @dev mapping between account owner and account operator
    mapping(address => mapping(address => bool)) internal operators;

    /**
     * @notice contructor
     * @param _addressBook adressbook module
     */
    constructor(address _addressBook) public {
        addressBook = _addressBook;
    }

    /// @notice emits an event when a account operator updated for a specific account owner
    event AccountOperatorUpdated(address indexed accountOwner, address indexed operator, bool isSet);

    /**
     * @notice modifier check if protocol is not paused
     */
    modifier isNotPaused {
        _;
    }

    /**
     * @notice modifier to check if otoken is expired
     * @param _otoken otoken address
     */
    modifier isExpired(address _otoken) {
        _;
    }

    /**
     * @notice modifier to check if sender is an authorized vault operator
     * @param _sender sender address
     */
    modifier isAuthorized(address _sender) {
        _;
    }

    /**
     * @notice allows admin to toggle pause / emergency shutdown
     * @param _paused The new boolean value to set systemPaused to.
     */
    function setSystemPaused(bool _paused) external onlyOwner {
        systemPaused = _paused;
    }

    /**
     * @notice allows a user to set and unset an operate which can act on their behalf on their vaults. Only the vault owner can update the operator privileges.
     * @param _operator The operator that sender wants to give privileges to or revoke them from.
     * @param _isOperator The new boolean value that expresses if sender is giving or revoking privileges from _operator.
     */
    function setOperator(address _operator, bool _isOperator) external {
        operators[msg.sender][_operator] = _isOperator;

        emit AccountOperatorUpdated(msg.sender, _operator, _isOperator);
    }

    /**
     * @notice execute a different number of actions on a specific vaults
     * @dev can only be called when system is not paused
     * @param _actions array of actions arguments
     */
    function operate(Actions.ActionArgs[] memory _actions) external isNotPaused {}

    /**
     * @notice Iterate through a collateral array of the vault and payout collateral assets
     * @dev can only be called when system is not paused and from an authorized address
     * @param _owner The owner of the vault we will clear
     * @param _vaultId The vaultId for the vault we will clear, within the user's MarginAccount.Account struct
     */
    //function redeemForEmergency(address _owner, uint256 _vaultId) external isNotPaused isAuthorized(args.owner) {
    //}

    /**
     * @notice set batch underlying asset price
     * @param _otoken otoken address
     * @param _roundsBack chainlink round number relative to specific timestamp
     */
    function setBatchUnderlyingPrice(address _otoken, uint256 _roundsBack) external {}

    /**
     * @notice Return a vault balances, depend of the short option expiry
     * @dev if vault have no short option or issued option is not expired yet, return vault, else get excess margin and return it as collateral amount inside Vault struct.
     * @param _owner vault owner.
     * @param _vaultId vault.
     * @return Vault struct
     */
    function getVaultBalances(address _owner, uint256 _vaultId) external view returns (MarginAccount.Vault memory) {}

    /**
     * @dev return if an expired oToken contract’s price has been finalized. Returns true if the contract has expired AND the oraclePrice at the expiry timestamp has been finalized.
     * @param _otoken The address of the relevant oToken.
     * @return A boolean which is true if and only if the price is finalized.
     */
    function isPriceFinalized(address _otoken) external view returns (bool) {
        //Returns true if the contract has expired AND the oraclePrice at the expiry timestamp has been finalized.
        //Calls the Oracle to know if the price has been finalized
    }

    /**
     * @notice Return a specific vault.
     * @param _owner vault owner.
     * @param _vaultId vault.
     * @return Vault struct
     */
    function getVault(address _owner, uint256 _vaultId) public view returns (MarginAccount.Vault memory) {}

    /**
     * @notice Checks if the sender is the operator of the owner’s account
     * @param _owner The owner of the account
     * @param _operator account operator
     * @return true if it is an account operator, otherwise false
     */
    function isOperator(address _owner, address _operator) public view returns (bool) {}

    /**
     * @notice Execute actions on a certain vault
     * @dev For each action in the action Array, run the corresponding action
     * @param _actions An array of type Actions.ActionArgs[] which expresses which actions the user want to execute.
     * @return Vault strcut. The new vault data that has been modified (or null vault if no action affected any vault)
     */
    function _runActions(Actions.ActionArgs[] memory _actions) internal returns (MarginAccount.Vault memory) {}

    /**
     * @notice open new vault inside an account
     * @dev Only account owner or operator can open a vault
     * @param _args OpenVaultArgs structure
     */
    function _openVault(Actions.OpenVaultArgs memory _args) internal isAuthorized(_args.owner) {}

    /**
     * @notice deposit long option into vault
     * @param _args DepositArgs structure
     */
    function _depositLong(Actions.DepositArgs memory _args) internal {}

    /**
     * @notice withdraw long option from vault
     * @dev Only account owner or operator can withdraw long option from vault
     * @param _args WithdrawArgs structure
     */
    function _withdrawLong(Actions.WithdrawArgs memory _args) internal isAuthorized(_args.owner) {}

    /**
     * @notice deposit collateral asset into vault
     * @param _args DepositArgs structure
     */
    function _depositCollateral(Actions.DepositArgs memory _args) internal {}

    /**
     * @notice withdraw collateral asset from vault
     * @dev only account owner or operator can withdraw long option from vault
     * @param _args WithdrawArgs structure
     */
    function _withdrawCollateral(Actions.WithdrawArgs memory _args) internal isAuthorized(_args.owner) {}

    /**
     * @notice mint option into vault
     * @dev only account owner or operator can withdraw long option from vault
     * @param _args MintArgs structure
     */
    function _mintOtoken(Actions.MintArgs memory _args) internal isAuthorized(_args.owner) {}

    /**
     * @notice burn option
     * @dev only account owner or operator can withdraw long option from vault
     * @param _args MintArgs structure
     */
    function _burnOtoken(Actions.BurnArgs memory _args) internal {}

    /**
     * @notice exercise option
     * @param _args ExerciseArgs structure
     */
    function _exercise(Actions.ExerciseArgs memory _args) internal {}

    /**
     * @notice settle vault option
     * @param _args SettleVaultArgs structure
     */
    function _settleVault(Actions.SettleVaultArgs memory _args) internal {}

    //High Level: call arbitrary smart contract
    //function _call(Actions.CallArgs args) internal {
    //    //Check whitelistModule.isWhitelistCallDestination(args.address)
    //    //Call args.address with args.data
    //}
}
