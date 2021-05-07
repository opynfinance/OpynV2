using DummyERC20C as collateralToken
using MarginPoolHarness as pool
using Whitelist as whitelist
using OtokenHarnessA as shortOtoken
using OtokenHarnessB as longOtoken

methods {
    //The tracked asset balance of the system
    pool.getStoredBalance(address) returns uint256 envfree
    
    // ERC20 functions
    collateralToken.totalSupply() returns uint256 envfree
    shortOtoken.totalSupply() returns uint256 envfree
    shortOtoken.strikePrice() returns uint256 envfree
    collateralToken.balanceOf(address) returns uint256 envfree
    longOtoken.balanceOf(address) returns uint256 envfree
    shortOtoken.balanceOf(address) returns uint256 envfree

    // get the cash value for an otoken afte rexpiry
    getPayout(address, uint256) returns uint256 envfree
    // get the amount of collateral that can be taken out of a vault
    getProceed(address, uint256) returns uint256 envfree

    //the amount of collateral in an index in a vault of an owner. i.e.,  vaults[owner][index].collateralAmounts[i]
    getVaultCollateralAmount(address, uint256, uint256)  returns uint256 envfree
    //the collateral asset of an index in a vault of an owner. i.e., vaults[owner][index].collateralAssets(i)
    getVaultCollateralAsset(address, uint256, uint256)  returns address envfree
    //the amount of long in an index in a vault of an owner. i.e.,  vaults[owner][index].longAmounts[i]
    getVaultLongAmount(address, uint256, uint256)  returns uint256 envfree
    //the long oToken in an index in a vault of an owner. i.e.,  vaults[owner][index].longOtoken[i]
    getVaultLongOtoken(address, uint256, uint256)  returns address envfree
    //the amount of long in an index in a vault of an owner. i.e.,  vaults[owner][index].shortAmounts[i]
    getVaultShortAmount(address, uint256, uint256)  returns uint256 envfree
    //the long oToken in an index in a vault of an owner. i.e.,  vaults[owner][index].shortOtoken[i]
    getVaultShortOtoken(address, uint256, uint256)  returns address envfree
	// checks if the vault is expired (true when there is an otoken which we can check expiry for)
    isVaultExpired(address, uint256) returns bool
    // checks if vault is "small" all lengths shorter than a constant
    smallVault(address, uint256, uint256) returns bool envfree
    // checks that a vault is valid
    isValidVault(address, uint256) returns bool envfree

    // The total supply of an asset. i.e., asset.totalSupply()
    assetTotalSupply(address) returns uint256 envfree
    whitelist.isWhitelistedOtoken(address) returns bool envfree
    whitelist.isWhitelistedCollateral(address) returns bool envfree

    // summarized functions
    expiryTimestamp() => CONSTANT
    burnOtoken(address, uint256) => CONSTANT
}

rule settleVault (address owner, uint256 vaultId, uint256 index, address oToken, address to, address collateral) {
    env e;
    require oToken == shortOtoken;
    require collateral == collateralToken;
    require getVaultShortOtoken(owner, vaultId, 0) == oToken;
    require getVaultCollateralAsset(owner, vaultId, 0) == collateral;
    require to != pool; 

    uint256 supplyBefore = shortOtoken.totalSupply();
    uint256 amountRemoved = getProceed(owner, vaultId);
    uint256 poolBalanceBefore = collateralToken.balanceOf(pool);

    sinvoke settleVault(e, owner, vaultId, to);

    uint256 supplyAfter = shortOtoken.totalSupply();
    uint256 poolBalanceAfter = collateralToken.balanceOf(pool);

    assert supplyAfter == supplyBefore;
    assert poolBalanceAfter != poolBalanceBefore => (poolBalanceBefore - poolBalanceAfter == amountRemoved);

}

rule redeem (address oToken, address to, address collateral, uint256 amount) {
    env e;
    require oToken == shortOtoken;
    require collateral == collateralToken;

    require to != pool; 

    uint256 supplyBefore = shortOtoken.totalSupply();
    uint256 amountRemoved = getPayout(oToken, amount);
    uint256 amount1 = getPayout(oToken, 1);
    uint256 poolBalanceBefore = collateralToken.balanceOf(pool);
    uint256 toBalanceBefore =  collateralToken.balanceOf(to);

    sinvoke redeemA(e, to, amount);

    uint256 supplyAfter = shortOtoken.totalSupply();
    uint256 poolBalanceAfter = collateralToken.balanceOf(pool);
    uint256 toBalanceAfter =  collateralToken.balanceOf(to);

    //assert supplyAfter != supplyBefore => ((supplyBefore - supplyAfter) * amount1 == amountRemoved);
    //assert poolBalanceAfter != poolBalanceBefore => (poolBalanceBefore - poolBalanceAfter == amountRemoved);
    assert supplyBefore - supplyAfter == amount;
    assert poolBalanceBefore - poolBalanceAfter == amountRemoved;
    assert toBalanceAfter - toBalanceBefore == amountRemoved;

}

rule onlyOneVaultModified (address owner1, address owner2, uint256 vaultId1, uint256 vaultId2, address to,  method f) {
    require owner1 != owner2 || vaultId1 != vaultId2;
    uint256 collateralAmt1Before = getVaultCollateralAmount(owner1, vaultId1, 0);
    uint256 collateralAmt2Before = getVaultCollateralAmount(owner2, vaultId2, 0); 
    env e;
    calldataarg arg;
    sinvoke f(e, arg);
    uint256 collateralAmt1After = getVaultCollateralAmount@withrevert(owner1, vaultId1, 0);
    bool r1 = lastReverted;
    if (r1) {
       collateralAmt1After = 0;
    }
    uint256 collateralAmt2After = getVaultCollateralAmount@withrevert(owner2, vaultId2, 0);
    bool r2 = lastReverted;
    if (r2) {
       collateralAmt2After = 0;
    }
    assert !r1 || !r2, "at most one vault could have been deleted";
    assert (collateralAmt1Before != collateralAmt1After => collateralAmt2Before==collateralAmt2After), "two vaults were updated";
 }
 
rule collateralWithdrawsRestricted(address owner, uint256 vaultId, uint256 index, method f) {
    env e;
    uint256 collateralBalanceBefore = collateralToken.balanceOf(pool);
    calldataarg arg;
    sinvoke f(e, arg);
    uint256 collateralBalanceAfter = collateralToken.balanceOf(pool);

    assert collateralBalanceAfter < collateralBalanceBefore => (f.selector == settleVault(address,uint256,address).selector) 
                                                            || (f.selector == redeemB(address,uint256).selector)
                                                            || (f.selector == redeemA(address,uint256).selector)
                                                            || (f.selector == withdrawCollateral(address,uint256,address,uint256,uint256).selector);
}

rule optionWithdrawsRestricted(address owner, uint256 vaultId, uint256 index, address from, address amount, method f) {
    env e;
    // The pool cannot really call any of these functions
    require (e.msg.sender != pool);
    require (!whitelist.isWhitelistedCollateral(longOtoken));
    uint256 otokenBalanceBefore = longOtoken.balanceOf(pool);
    if (f.selector == burnOtokenB(address,uint256,address,uint256,uint256).selector) {
        require(owner != pool);
        sinvoke burnOtokenB(e, owner, vaultId, from, index, amount);
    } else {
        calldataarg arg;
        sinvoke f(e, arg);
    }
    uint256 otokenBalanceAfter = longOtoken.balanceOf(pool);
    // or settle vault 
    assert otokenBalanceAfter < otokenBalanceBefore => (f.selector == withdrawLongB(address, uint256, address, uint256, uint256).selector) 
                                                    || (f.selector == settleVault(address,uint256,address).selector);
}

rule withdrawCollateralAndSettleVaultMatch (address owner, uint256 vaultId, uint256 index, address oToken, address to, address collateral, uint256 amount) {
    // if I withdraw collateral, it should <= the amount of collateral I can get by calling settle valut 
    env e;
    require oToken == shortOtoken;
    require collateral == collateralToken;
    require getVaultShortOtoken(owner, vaultId, 0) == oToken;
    require getVaultCollateralAsset(owner, vaultId, 0) == collateral;
    require to != pool; 

    uint256 poolBalanceBefore = collateralToken.balanceOf(pool);

    storage initialStorage = lastStorage;
    sinvoke settleVault(e, owner, vaultId, to);
    uint256 poolBalanceAfterSettle = collateralToken.balanceOf(pool);

    sinvoke withdrawCollateral(e, owner, vaultId, to, index, amount) at initialStorage;
    require(isValidVault(owner, vaultId));
    uint256 poolBalanceAfterWithdraw = collateralToken.balanceOf(pool);

    assert poolBalanceAfterWithdraw != poolBalanceBefore => (poolBalanceAfterWithdraw >= poolBalanceAfterSettle);

}

definition MAX_SUPPLY() returns uint256 = 100000000000000000;
/***
@title Checks that a weak user cannot lock the system by minting  max supply of the otoken. 
@notice Checks this holds true if a user has limited supply of collateral and is not close to max supply on an otoken
*/
rule cannotLockSystem (address oToken, address to, address collateral, uint256 amount, address owner, uint256 vaultId, uint256 index) {
    env e;
    require oToken == shortOtoken;
    uint256 strikePrice = shortOtoken.strikePrice();
    // TODO: figure out how to fix this. 
    require strikePrice >= 100000000;
    require collateral == collateralToken;

    require to != pool; 

    uint256 supplyBefore = shortOtoken.totalSupply();
    // get excess collateral in vault 
    uint256 collateralBefore = getVaultCollateralAmount(owner, vaultId, index);

    require supplyBefore < MAX_SUPPLY();
    require collateralBefore < MAX_SUPPLY();

    mintOtokenA(e, owner, vaultId, to, index, amount);
    require(isValidVault(owner, vaultId));


    uint256 supplyAfter = shortOtoken.totalSupply();
    assert supplyAfter < 2 * MAX_SUPPLY(); 

}

// rule inverse (address owner, uint256 vaultId, address from, uint256 index, uint256 amount) { 
//     require(isValidVault(owner, vaultId));

//     storage initialStorage = lastStorage;
//     env e1; 
//     calldataarg arg1;
//     sinvoke f1(e1, arg1);
//     env e2;
//     calldataarg arg2;
//     sinvoke f2(e2, arg2);

//     function depositLongA(
//     address owner,
//     uint256 vaultId,
//     address from,
//     uint256 index,
//     uint256 amount
//   ) 
    
//     uint256 vaultCollateralAmount1 = getVaultCollateralAmount(owner, vaultId,0);

//     sinvoke f2(e2, arg2) at initialStorage;
//     sinvoke f2(e1, arg1);

//     uint256 vaultCollateralAmount2 = getVaultCollateralAmount(owner, vaultId,0);

//     assert vaultCollateralAmount1 == vaultCollateralAmount1;
//     // run first method and then second method and store the result 
//     // run the second method then first method and compare result 
// }



