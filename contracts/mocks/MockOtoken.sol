pragma solidity =0.6.10;

import {ERC20Initializable} from "../packages/oz/upgradeability/ERC20Initializable.sol";

/**
 * SPDX-License-Identifier: UNLICENSED
 * @dev The Otoken inherits ERC20Initializable because we need to use the init instead of constructor.
 */
contract MockOtoken is ERC20Initializable {
    address public underlyingAsset;
    address public strikeAsset;
    address public collateralAsset;

    uint256 public strikePrice;
    uint256 public expiryTimestamp;

    bool public isPut;

    function init(
        address _underlyingAsset,
        address _strikeAsset,
        address _collateralAsset,
        uint256 _strikePrice,
        uint256 _expiryTimestamp,
        bool _isPut
    ) external initializer {
        underlyingAsset = _underlyingAsset;
        strikeAsset = _strikeAsset;
        collateralAsset = _collateralAsset;
        strikePrice = _strikePrice;
        expiryTimestamp = _expiryTimestamp;
        isPut = _isPut;
        string memory tokenName = "ETHUSDC/1597511955/200P/USDC";
        string memory tokenSymbol = "oETHUSDCP";
        __ERC20_init_unchained(tokenName, tokenSymbol);
    }

    function mint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }
}
