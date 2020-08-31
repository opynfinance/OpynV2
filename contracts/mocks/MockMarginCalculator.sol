/**
 * SPDX-License-Identifier: UNLICENSED
 */
pragma solidity =0.6.10;

pragma experimental ABIEncoderV2;

import {OtokenInterface} from "../interfaces/OtokenInterface.sol";
import {MarginAccount} from "../libs/MarginAccount.sol";

contract MockMarginCalculator {
    // solhint-disable-ignore-no-unused-vars
    function isValidState(MarginAccount.Vault memory finalVault, address[] calldata shortOtokens)
        external
        view
        returns (bool isValid)
    {
        // ensure the number of collateral, long and short array is valid.
        _checkIsValidSpread(finalVault);

        if (finalVault.shortOtokens.length == 0 || finalVault.shortAmounts.length == 0) return true;

        // ensure the long asset is valid for the short asset.
        _checkIsMarginableLong(finalVault);

        bool isExcess = getExcessMargin(finalVault, OtokenInterface(finalVault.shortOtokens[0]).collateralAsset());

        return isExcess;
    }

    function getExcessMargin(MarginAccount.Vault memory _vault, address _denominated)
        public
        view
        returns (bool isExcess)
    {
        return true;
    }

    function _checkIsValidSpread(MarginAccount.Vault memory _vault) internal pure {
        require(_vault.shortOtokens.length <= 1, "MarginCalculator: Too many short otokens in the vault.");
        require(_vault.longOtokens.length <= 1, "MarginCalculator: Too many long otokens in the vault.");
        require(_vault.collateralAssets.length <= 1, "MarginCalculator: Too many collateral assets in the vault.");

        require(
            _vault.shortOtokens.length == _vault.shortAmounts.length,
            "MarginCalculator: Short asset and amount mismatch."
        );
        require(
            _vault.longOtokens.length == _vault.longAmounts.length,
            "MarginCalculator: Long asset and amount mismatch."
        );
        require(
            _vault.collateralAssets.length == _vault.collateralAmounts.length,
            "MarginCalculator: Collateral asset and amount mismatch."
        );
    }

    function _checkIsMarginableLong(MarginAccount.Vault memory _vault) internal view {
        if (_vault.longOtokens.length == 0 || _vault.shortOtokens.length == 0) return;

        OtokenInterface long = OtokenInterface(_vault.longOtokens[0]);
        OtokenInterface short = OtokenInterface(_vault.shortOtokens[0]);

        require(
            long.underlyingAsset() == short.underlyingAsset(),
            "MarginCalculator: Long and short underlying asset mismatch"
        );
        require(long.strikeAsset() == short.strikeAsset(), "MarginCalculator: Long and short strike asset mismatch");
        require(
            long.collateralAsset() == short.collateralAsset(),
            "MarginCalculator: Long and short collateral asset mismatch"
        );
        require(
            long.expiryTimestamp() == short.expiryTimestamp(),
            "MarginCalculator: Long and short expiry timestamp mismatch"
        );
    }
}
