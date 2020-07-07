// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.10;

contract MockWhitelistModule {
    mapping(address => bool) private _validOtoken;
    mapping(bytes32 => bool) private _isWhitelistedProduct;

    function whitelistProduct(
        address _underlying,
        address _strike,
        address _collateral
    ) external returns (bytes32 id) {
        id = keccak256(abi.encodePacked(_underlying, _strike, _collateral));

        _isWhitelistedProduct[id] = true;
    }

    function isSupportedProduct(
        address _underlying,
        address _strike,
        address _collateral
    ) external view returns (bool isValid) {
        bytes32 id = keccak256(abi.encodePacked(_underlying, _strike, _collateral));
        return _isWhitelistedProduct[id];
    }

    function registerOtoken(address oToken) external returns (bool success) {
        _validOtoken[oToken] = true;
    }

    function isValidOtoken(address _oToken) external returns (bool) {
        return _validOtoken[_oToken];
    }
}
