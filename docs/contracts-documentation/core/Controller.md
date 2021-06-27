# `Controller`

Contract that controls the Gamma Protocol and the interaction of all sub contracts

## Modifiers:

- `notPartiallyPaused()`

- `notFullyPaused()`

- `onlyFullPauser()`

- `onlyPartialPauser()`

- `onlyAuthorized(address _sender, address _accountOwner)`

- `onlyWhitelistedCallee(address _callee)`

## Functions:

- `_isNotPartiallyPaused() (internal)`

- `_isNotFullyPaused() (internal)`

- `_isAuthorized(address _sender, address _accountOwner) (internal)`

- `initialize(address _addressBook, address _owner) (external)`

- `donate(address _asset, uint256 _amount) (external)`

- `setSystemPartiallyPaused(bool _partiallyPaused) (external)`

- `setSystemFullyPaused(bool _fullyPaused) (external)`

- `setFullPauser(address _fullPauser) (external)`

- `setPartialPauser(address _partialPauser) (external)`

- `setCallRestriction(bool _isRestricted) (external)`

- `setOperator(address _operator, bool _isOperator) (external)`

- `refreshConfiguration() (external)`

- `setNakedCap(address _collateral, uint256 _cap) (external)`

- `operate(struct Actions.ActionArgs[] _actions) (external)`

- `sync(address _owner, uint256 _vaultId) (external)`

- `isOperator(address _owner, address _operator) (external)`

- `getConfiguration() (external)`

- `getProceed(address _owner, uint256 _vaultId) (external)`

- `isLiquidatable(address _owner, uint256 _vaultId, uint256 _roundId) (external)`

- `getPayout(address _otoken, uint256 _amount) (public)`

- `isSettlementAllowed(address _otoken) (external)`

- `canSettleAssets(address _underlying, address _strike, address _collateral, uint256 _expiry) (external)`

- `getAccountVaultCounter(address _accountOwner) (external)`

- `hasExpired(address _otoken) (external)`

- `getVault(address _owner, uint256 _vaultId) (external)`

- `getVaultWithDetails(address _owner, uint256 _vaultId) (public)`

- `getNakedCap(address _asset) (external)`

- `getNakedPoolBalance(address _asset) (external)`

- `_runActions(struct Actions.ActionArgs[] _actions) (internal)`

- `_verifyFinalState(address _owner, uint256 _vaultId) (internal)`

- `_openVault(struct Actions.OpenVaultArgs _args) (internal)`

- `_depositLong(struct Actions.DepositArgs _args) (internal)`

- `_withdrawLong(struct Actions.WithdrawArgs _args) (internal)`

- `_depositCollateral(struct Actions.DepositArgs _args) (internal)`

- `_withdrawCollateral(struct Actions.WithdrawArgs _args) (internal)`

- `_mintOtoken(struct Actions.MintArgs _args) (internal)`

- `_burnOtoken(struct Actions.BurnArgs _args) (internal)`

- `_redeem(struct Actions.RedeemArgs _args) (internal)`

- `_settleVault(struct Actions.SettleVaultArgs _args) (internal)`

- `_liquidate(struct Actions.LiquidateArgs _args) (internal)`

- `_call(struct Actions.CallArgs _args) (internal)`

- `_checkVaultId(address _accountOwner, uint256 _vaultId) (internal)`

- `_isNotEmpty(address[] _array) (internal)`

- `_isCalleeWhitelisted(address _callee) (internal)`

- `_isLiquidatable(address _owner, uint256 _vaultId, uint256 _roundId) (internal)`

- `_getOtokenDetails(address _otoken) (internal)`

- `_canSettleAssets(address _underlying, address _strike, address _collateral, uint256 _expiry) (internal)`

- `_refreshConfigInternal() (internal)`

## Events:

- `AccountOperatorUpdated(address accountOwner, address operator, bool isSet)`

- `VaultOpened(address accountOwner, uint256 vaultId, uint256 vaultType)`

- `LongOtokenDeposited(address otoken, address accountOwner, address from, uint256 vaultId, uint256 amount)`

- `LongOtokenWithdrawed(address otoken, address AccountOwner, address to, uint256 vaultId, uint256 amount)`

- `CollateralAssetDeposited(address asset, address accountOwner, address from, uint256 vaultId, uint256 amount)`

- `CollateralAssetWithdrawed(address asset, address AccountOwner, address to, uint256 vaultId, uint256 amount)`

- `ShortOtokenMinted(address otoken, address AccountOwner, address to, uint256 vaultId, uint256 amount)`

- `ShortOtokenBurned(address otoken, address AccountOwner, address from, uint256 vaultId, uint256 amount)`

- `Redeem(address otoken, address redeemer, address receiver, address collateralAsset, uint256 otokenBurned, uint256 payout)`

- `VaultSettled(address accountOwner, address oTokenAddress, address to, uint256 payout, uint256 vaultId, uint256 vaultType)`

- `VaultLiquidated(address liquidator, address receiver, address vaultOwner, uint256 auctionPrice, uint256 auctionStartingRound, uint256 collateralPayout, uint256 debtAmount, uint256 vaultId)`

- `CallExecuted(address from, address to, bytes data)`

- `FullPauserUpdated(address oldFullPauser, address newFullPauser)`

- `PartialPauserUpdated(address oldPartialPauser, address newPartialPauser)`

- `SystemPartiallyPaused(bool isPaused)`

- `SystemFullyPaused(bool isPaused)`

- `CallRestricted(bool isRestricted)`

- `Donated(address donator, address asset, uint256 amount)`

- `NakedCapUpdated(address collateral, uint256 cap)`

### Modifier `notPartiallyPaused()`

modifier to check if the system is not partially paused, where only redeem and settleVault is allowed

### Modifier `notFullyPaused()`

modifier to check if the system is not fully paused, where no functionality is allowed

### Modifier `onlyFullPauser()`

modifier to check if sender is the fullPauser address

### Modifier `onlyPartialPauser()`

modifier to check if the sender is the partialPauser address

### Modifier `onlyAuthorized(address _sender, address _accountOwner)`

modifier to check if the sender is the account owner or an approved account operator

#### Parameters:

- `_sender`: sender address

- `_accountOwner`: account owner address

### Modifier `onlyWhitelistedCallee(address _callee)`

modifier to check if the called address is a whitelisted callee address

#### Parameters:

- `_callee`: called address

### Function `_isNotPartiallyPaused() internal`

check if the system is not in a partiallyPaused state

### Function `_isNotFullyPaused() internal`

check if the system is not in an fullyPaused state

### Function `_isAuthorized(address _sender, address _accountOwner) internal`

check if the sender is an authorized operator

#### Parameters:

- `_sender`: msg.sender

- `_accountOwner`: owner of a vault

### Function `initialize(address _addressBook, address _owner) external`

initalize the deployed contract

#### Parameters:

- `_addressBook`: addressbook module

- `_owner`: account owner address

### Function `donate(address _asset, uint256 _amount) external`

send asset amount to margin pool

use donate() instead of direct transfer() to store the balance in assetBalance

#### Parameters:

- `_asset`: asset address

- `_amount`: amount to donate to pool

### Function `setSystemPartiallyPaused(bool _partiallyPaused) external`

allows the partialPauser to toggle the systemPartiallyPaused variable and partially pause or partially unpause the system

can only be called by the partialPauser

#### Parameters:

- `_partiallyPaused`: new boolean value to set systemPartiallyPaused to

### Function `setSystemFullyPaused(bool _fullyPaused) external`

allows the fullPauser to toggle the systemFullyPaused variable and fully pause or fully unpause the system

can only be called by the fullyPauser

#### Parameters:

- `_fullyPaused`: new boolean value to set systemFullyPaused to

### Function `setFullPauser(address _fullPauser) external`

allows the owner to set the fullPauser address

can only be called by the owner

#### Parameters:

- `_fullPauser`: new fullPauser address

### Function `setPartialPauser(address _partialPauser) external`

allows the owner to set the partialPauser address

can only be called by the owner

#### Parameters:

- `_partialPauser`: new partialPauser address

### Function `setCallRestriction(bool _isRestricted) external`

allows the owner to toggle the restriction on whitelisted call actions and only allow whitelisted

call addresses or allow any arbitrary call addresses

can only be called by the owner

#### Parameters:

- `_isRestricted`: new call restriction state

### Function `setOperator(address _operator, bool _isOperator) external`

allows a user to give or revoke privileges to an operator which can act on their behalf on their vaults

can only be updated by the vault owner

#### Parameters:

- `_operator`: operator that the sender wants to give privileges to or revoke them from

- `_isOperator`: new boolean value that expresses if the sender is giving or revoking privileges for _operator

### Function `refreshConfiguration() external`

updates the configuration of the controller. can only be called by the owner

### Function `setNakedCap(address _collateral, uint256 _cap) external`

set cap amount for collateral asset used in naked margin

can only be called by owner

#### Parameters:

- `_collateral`: collateral asset address

- `_cap`: cap amount, should be scaled by collateral asset decimals

### Function `operate(struct Actions.ActionArgs[] _actions) external`

execute a number of actions on specific vaults

can only be called when the system is not fully paused

#### Parameters:

- `_actions`: array of actions arguments

### Function `sync(address _owner, uint256 _vaultId) external`

sync vault latest update timestamp

anyone can update the latest time the vault was touched by calling this function

vaultLatestUpdate will sync if the vault is well collateralized

#### Parameters:

- `_owner`: vault owner address

- `_vaultId`: vault id

### Function `isOperator(address _owner, address _operator) → bool external`

check if a specific address is an operator for an owner account

#### Parameters:

- `_owner`: account owner address

- `_operator`: account operator address

#### Return Values:

- True if the _operator is an approved operator for the _owner account

### Function `getConfiguration() → address, address, address, address external`

returns the current controller configuration

#### Return Values:

- the address of the whitelist module

- the address of the oracle module

- the address of the calculator module

- the address of the pool module

### Function `getProceed(address _owner, uint256 _vaultId) → uint256 external`

return a vault's proceeds pre or post expiry, the amount of collateral that can be removed from a vault

#### Parameters:

- `_owner`: account owner of the vault

- `_vaultId`: vaultId to return balances for

#### Return Values:

- amount of collateral that can be taken out

### Function `isLiquidatable(address _owner, uint256 _vaultId, uint256 _roundId) → bool, uint256, uint256 external`

check if a vault is liquidatable in a specific round id

#### Parameters:

- `_owner`: vault owner address

- `_vaultId`: vault id to check

- `_roundId`: chainlink round id to check vault status at

#### Return Values:

- true if vault is undercollateralized, the price of 1 repaid otoken and the otoken collateral dust amount

### Function `getPayout(address _otoken, uint256 _amount) → uint256 public`

get an oToken's payout/cash value after expiry, in the collateral asset

#### Parameters:

- `_otoken`: oToken address

- `_amount`: amount of the oToken to calculate the payout for, always represented in 1e8

#### Return Values:

- amount of collateral to pay out

### Function `isSettlementAllowed(address _otoken) → bool external`

return if an expired oToken is ready to be settled, only true when price for underlying,

strike and collateral assets at this specific expiry is available in our Oracle module

#### Parameters:

- `_otoken`: oToken

### Function `canSettleAssets(address _underlying, address _strike, address _collateral, uint256 _expiry) → bool external`

return if underlying, strike, collateral are all allowed to be settled

#### Parameters:

- `_underlying`: oToken underlying asset

- `_strike`: oToken strike asset

- `_collateral`: oToken collateral asset

- `_expiry`: otoken expiry timestamp

#### Return Values:

- True if the oToken has expired AND all oracle prices at the expiry timestamp have been finalized, False if not

### Function `getAccountVaultCounter(address _accountOwner) → uint256 external`

get the number of vaults for a specified account owner

#### Parameters:

- `_accountOwner`: account owner address

#### Return Values:

- number of vaults

### Function `hasExpired(address _otoken) → bool external`

check if an oToken has expired

#### Parameters:

- `_otoken`: oToken address

#### Return Values:

- True if the otoken has expired, False if not

### Function `getVault(address _owner, uint256 _vaultId) → struct MarginVault.Vault external`

return a specific vault

#### Parameters:

- `_owner`: account owner

- `_vaultId`: vault id of vault to return

#### Return Values:

- Vault struct that corresponds to the _vaultId of _owner

### Function `getVaultWithDetails(address _owner, uint256 _vaultId) → struct MarginVault.Vault, uint256, uint256 public`

return a specific vault

#### Parameters:

- `_owner`: account owner

- `_vaultId`: vault id of vault to return

#### Return Values:

- Vault struct that corresponds to the _vaultId of _owner, vault type and the latest timestamp when the vault was updated

### Function `getNakedCap(address _asset) → uint256 external`

get cap amount for collateral asset

#### Parameters:

- `_asset`: collateral asset address

#### Return Values:

- cap amount

### Function `getNakedPoolBalance(address _asset) → uint256 external`

get amount of collateral deposited in all naked margin vaults

#### Parameters:

- `_asset`: collateral asset address

#### Return Values:

- naked pool balance

### Function `_runActions(struct Actions.ActionArgs[] _actions) → bool, address, uint256 internal`

execute a variety of actions

for each action in the action array, execute the corresponding action, only one vault can be modified

for all actions except SettleVault, Redeem, and Call

#### Parameters:

- `_actions`: array of type Actions.ActionArgs[], which expresses which actions the user wants to execute

#### Return Values:

- indicates if a vault has changed

- the vault owner if a vault has changed

- the vault Id if a vault has changed

### Function `_verifyFinalState(address _owner, uint256 _vaultId) internal`

verify the vault final state after executing all actions

#### Parameters:

- `_owner`: account owner address

- `_vaultId`: vault id of the final vault

### Function `_openVault(struct Actions.OpenVaultArgs _args) internal`

open a new vault inside an account

only the account owner or operator can open a vault, cannot be called when system is partiallyPaused or fullyPaused

#### Parameters:

- `_args`: OpenVaultArgs structure

### Function `_depositLong(struct Actions.DepositArgs _args) internal`

deposit a long oToken into a vault

only the account owner or operator can deposit a long oToken, cannot be called when system is partiallyPaused or fullyPaused

#### Parameters:

- `_args`: DepositArgs structure

### Function `_withdrawLong(struct Actions.WithdrawArgs _args) internal`

withdraw a long oToken from a vault

only the account owner or operator can withdraw a long oToken, cannot be called when system is partiallyPaused or fullyPaused

#### Parameters:

- `_args`: WithdrawArgs structure

### Function `_depositCollateral(struct Actions.DepositArgs _args) internal`

deposit a collateral asset into a vault

only the account owner or operator can deposit collateral, cannot be called when system is partiallyPaused or fullyPaused

#### Parameters:

- `_args`: DepositArgs structure

### Function `_withdrawCollateral(struct Actions.WithdrawArgs _args) internal`

withdraw a collateral asset from a vault

only the account owner or operator can withdraw collateral, cannot be called when system is partiallyPaused or fullyPaused

#### Parameters:

- `_args`: WithdrawArgs structure

### Function `_mintOtoken(struct Actions.MintArgs _args) internal`

mint short oTokens from a vault which creates an obligation that is recorded in the vault

only the account owner or operator can mint an oToken, cannot be called when system is partiallyPaused or fullyPaused

#### Parameters:

- `_args`: MintArgs structure

### Function `_burnOtoken(struct Actions.BurnArgs _args) internal`

burn oTokens to reduce or remove the minted oToken obligation recorded in a vault

only the account owner or operator can burn an oToken, cannot be called when system is partiallyPaused or fullyPaused

#### Parameters:

- `_args`: MintArgs structure

### Function `_redeem(struct Actions.RedeemArgs _args) internal`

redeem an oToken after expiry, receiving the payout of the oToken in the collateral asset

cannot be called when system is fullyPaused

#### Parameters:

- `_args`: RedeemArgs structure

### Function `_settleVault(struct Actions.SettleVaultArgs _args) internal`

settle a vault after expiry, removing the net proceeds/collateral after both long and short oToken payouts have settled

deletes a vault of vaultId after net proceeds/collateral is removed, cannot be called when system is fullyPaused

#### Parameters:

- `_args`: SettleVaultArgs structure

### Function `_liquidate(struct Actions.LiquidateArgs _args) internal`

liquidate naked margin vault

can liquidate different vaults id in the same operate() call

#### Parameters:

- `_args`: liquidation action arguments struct

### Function `_call(struct Actions.CallArgs _args) internal`

execute arbitrary calls

cannot be called when system is partiallyPaused or fullyPaused

#### Parameters:

- `_args`: Call action

### Function `_checkVaultId(address _accountOwner, uint256 _vaultId) → bool internal`

check if a vault id is valid for a given account owner address

#### Parameters:

- `_accountOwner`: account owner address

- `_vaultId`: vault id to check

#### Return Values:

- True if the _vaultId is valid, False if not

### Function `_isNotEmpty(address[] _array) → bool internal`

### Function `_isCalleeWhitelisted(address _callee) → bool internal`

return if a callee address is whitelisted or not

#### Parameters:

- `_callee`: callee address

#### Return Values:

- True if callee address is whitelisted, False if not

### Function `_isLiquidatable(address _owner, uint256 _vaultId, uint256 _roundId) → struct MarginVault.Vault, bool, uint256, uint256 internal`

check if a vault is liquidatable in a specific round id

#### Parameters:

- `_owner`: vault owner address

- `_vaultId`: vault id to check

- `_roundId`: chainlink round id to check vault status at

#### Return Values:

- vault struct, isLiquidatable, true if vault is undercollateralized, the price of 1 repaid otoken and the otoken collateral dust amount

### Function `_getOtokenDetails(address _otoken) → address, address, address, uint256 internal`

get otoken detail, from both otoken versions

### Function `_canSettleAssets(address _underlying, address _strike, address _collateral, uint256 _expiry) → bool internal`

return if an expired oToken is ready to be settled, only true when price for underlying,

strike and collateral assets at this specific expiry is available in our Oracle module

#### Return Values:

- True if the oToken has expired AND all oracle prices at the expiry timestamp have been finalized, False if not

### Function `_refreshConfigInternal() internal`

updates the internal configuration of the controller

### Event `AccountOperatorUpdated(address accountOwner, address operator, bool isSet)`

emits an event when an account operator is updated for a specific account owner

### Event `VaultOpened(address accountOwner, uint256 vaultId, uint256 vaultType)`

emits an event when a new vault is opened

### Event `LongOtokenDeposited(address otoken, address accountOwner, address from, uint256 vaultId, uint256 amount)`

emits an event when a long oToken is deposited into a vault

### Event `LongOtokenWithdrawed(address otoken, address AccountOwner, address to, uint256 vaultId, uint256 amount)`

emits an event when a long oToken is withdrawn from a vault

### Event `CollateralAssetDeposited(address asset, address accountOwner, address from, uint256 vaultId, uint256 amount)`

emits an event when a collateral asset is deposited into a vault

### Event `CollateralAssetWithdrawed(address asset, address AccountOwner, address to, uint256 vaultId, uint256 amount)`

emits an event when a collateral asset is withdrawn from a vault

### Event `ShortOtokenMinted(address otoken, address AccountOwner, address to, uint256 vaultId, uint256 amount)`

emits an event when a short oToken is minted from a vault

### Event `ShortOtokenBurned(address otoken, address AccountOwner, address from, uint256 vaultId, uint256 amount)`

emits an event when a short oToken is burned

### Event `Redeem(address otoken, address redeemer, address receiver, address collateralAsset, uint256 otokenBurned, uint256 payout)`

emits an event when an oToken is redeemed

### Event `VaultSettled(address accountOwner, address oTokenAddress, address to, uint256 payout, uint256 vaultId, uint256 vaultType)`

emits an event when a vault is settled

### Event `VaultLiquidated(address liquidator, address receiver, address vaultOwner, uint256 auctionPrice, uint256 auctionStartingRound, uint256 collateralPayout, uint256 debtAmount, uint256 vaultId)`

emits an event when a vault is liquidated

### Event `CallExecuted(address from, address to, bytes data)`

emits an event when a call action is executed

### Event `FullPauserUpdated(address oldFullPauser, address newFullPauser)`

emits an event when the fullPauser address changes

### Event `PartialPauserUpdated(address oldPartialPauser, address newPartialPauser)`

emits an event when the partialPauser address changes

### Event `SystemPartiallyPaused(bool isPaused)`

emits an event when the system partial paused status changes

### Event `SystemFullyPaused(bool isPaused)`

emits an event when the system fully paused status changes

### Event `CallRestricted(bool isRestricted)`

emits an event when the call action restriction changes

### Event `Donated(address donator, address asset, uint256 amount)`

emits an event when a donation transfer executed

### Event `NakedCapUpdated(address collateral, uint256 cap)`

emits an event when naked cap is updated
