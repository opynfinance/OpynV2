methods {
    getCollateralDust(address) returns uint256 envfree
    getProductTimeToExpiry(address, address, address, bool, uint256) returns uint256 envfree
    getProductTimeToExpirySize(address, address, address, bool) returns uint256 envfree
    getTimeToExpiryValue(address, address, address, bool, uint256) returns uint256 envfree
    isValidVault(address, address, address, uint256, uint256, uint256, uint256) returns bool envfree
    getNakedMarginRequired(address, address, address, uint256, uint256, uint256, uint256, uint256, bool) returns uint256 envfree
}

/***
@title Checks that the dust set for a collateral > 0 
@notice 
*/
rule validDust(address collateral, uint256 dust) {
    env e;
    setCollateralDust(e, collateral, dust);
    uint256 dustSet = getCollateralDust(collateral);
    assert dustSet > 0; 
}

/***
@title Checks that time to expiry values are in ascending order  
@notice setProductTimeToExpiry is the only function that updates the product time to expiry array
*/
rule expiryTimesInAscendingOrder (address underlying, address strike, address collateral, bool isPut, uint256 timeToExpiry) {
    env e;

    uint256 size = getProductTimeToExpirySize(underlying, strike, collateral, isPut);
    uint256 index0 = size - 1;
    uint256 index1 = size;

    sinvoke setProductTimeToExpiry(e, underlying, strike, collateral, isPut, timeToExpiry);

    uint256 expiryTimestamp0 = getProductTimeToExpiry(underlying, strike, collateral, isPut, index0);
    uint256 expiryTimestamp1 = getProductTimeToExpiry(underlying, strike, collateral, isPut, index1);

    assert expiryTimestamp0 <= expiryTimestamp1;

}

/***
@title Checks that productTimeToExpiry array and the timeToExpiryValue array are of same size
@notice setTimeToExpiryValue needs to be called before calling setProductTimeToExpiry. 
*/
rule productTimeToExpiryHasValue (address underlying, address strike, address collateral, bool isPut, uint256 timeToExpiry) {
    env e;
    sinvoke setProductTimeToExpiry(e, underlying, strike, collateral, isPut, timeToExpiry);

    uint256 timeToExpiryValue = getTimeToExpiryValue(underlying, strike, collateral, isPut, timeToExpiry);
    assert timeToExpiryValue != 0;
}

/***
@title Checks that an existing naked margin vault cannot have long otokens
*/
rule nakedMarginVaultIsValid (address short, address long, address collateral, uint256 shortAmount, uint256 longAmount, uint256 collateralAmount, uint256 vaultType) {
    require vaultType == 1; 
    if (long == 0x0000000000000000000000000000000000000000) {
        require longAmount == 0;
    }
    bool b = isValidVault@withrevert(short, long, collateral, shortAmount, longAmount, collateralAmount, vaultType);
    assert (!lastReverted && b == true) => (longAmount == 0 && long == 0);
}

/***
@title Checks that a put option with higher strike has higher margin required
*/
rule putMarginComparison (
        address underlying,
        address strike,
        address collateral,
        uint256 shortAmount,
        uint256 strikePrice1,
        uint256 strikePrice2,
        uint256 underlyingPrice,
        uint256 shortExpiryTimestamp,
        uint256 collateralDecimals,
        bool isPut) 
        {
    require isPut == true;
    require collateralDecimals == 27;
    uint256 margin1 = getNakedMarginRequired(underlying, strike, collateral, shortAmount, strikePrice1, underlyingPrice, shortExpiryTimestamp, collateralDecimals, isPut);
    uint256 margin2 = getNakedMarginRequired(underlying, strike, collateral, shortAmount, strikePrice2, underlyingPrice, shortExpiryTimestamp, collateralDecimals, isPut);
    assert (strikePrice1 < strikePrice2) => (margin1 <= margin2);
}

/***
@title Checks that a call option with higher strike has lower margin required 
*/
rule callMarginComparison (
        address underlying,
        address strike,
        address collateral,
        uint256 shortAmount,
        uint256 strikePrice1,
        uint256 strikePrice2,
        uint256 underlyingPrice,
        uint256 shortExpiryTimestamp,
        uint256 collateralDecimals,
        bool isPut) 
        {
    require isPut == false;
    require collateralDecimals == 27;
    require underlyingPrice > 0; 
    require shortAmount > 0; 
    uint256 margin1 = getNakedMarginRequired(underlying, strike, collateral, shortAmount, strikePrice1, underlyingPrice, shortExpiryTimestamp, collateralDecimals, isPut);
    uint256 margin2 = getNakedMarginRequired(underlying, strike, collateral, shortAmount, strikePrice2, underlyingPrice, shortExpiryTimestamp, collateralDecimals, isPut);
    assert (strikePrice1 < strikePrice2) => (margin1 >= margin2);
}

