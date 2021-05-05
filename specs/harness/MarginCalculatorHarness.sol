pragma solidity =0.6.10;
pragma experimental ABIEncoderV2;

import '../../contracts/MarginCalculator.sol';
import {MarginVault} from '../../contracts/libs/MarginVault.sol';

contract MarginCalculatorHarness is MarginCalculator(address(1)) {
  constructor(address _oracle) public {
    require(_oracle != address(0), 'MarginCalculator: invalid oracle address');
    oracle = OracleInterface(_oracle);
  }

  function getProductTimeToExpiry(
    address _underlying,
    address _strike,
    address _collateral,
    bool _isPut,
    uint256 index
  ) external view returns (uint256) {
    bytes32 productHash = _getProductHash(_underlying, _strike, _collateral, _isPut);
    return productTimeToExpiry[productHash][index];
  }

  function getProductTimeToExpirySize(
    address _underlying,
    address _strike,
    address _collateral,
    bool _isPut
  ) external view returns (uint256) {
    bytes32 productHash = _getProductHash(_underlying, _strike, _collateral, _isPut);
    return productTimeToExpiry[productHash].length;
  }

  // function getExcessCollateral(
  //   address short,
  //   address long,
  //   address collateral,
  //   uint256 shortAmount,
  //   uint256 longAmount,
  //   uint256 collateralAmount,
  //   uint256 _vaultType
  // ) public view returns (bool) {
  //   address[] memory shorts;
  //   shorts[0] = short;
  //   address[] memory longs;
  //   longs[0] = long;
  //   address[] memory collaterals;
  //   collaterals[0] = collateral;
  //   uint256[] memory longAmounts;
  //   longAmounts[0] = longAmount;
  //   uint256[] memory collateralAmounts;
  //   collateralAmounts[0] = collateralAmount;
  //   uint256[] memory shortAmounts;
  //   shortAmounts[0] = shortAmount;

  //   MarginVault.Vault memory v = MarginVault.Vault(
  //     shorts,
  //     longs,
  //     collaterals,
  //     shortAmounts,
  //     longAmounts,
  //     collateralAmounts
  //   );
  //   (uint256 collateral, ) = getExcessCollateral(v, _vaultType);
  //   return collateral;
  // }

  function isValidVault(
    address short,
    address long,
    address collateral,
    uint256 shortAmount,
    uint256 longAmount,
    uint256 collateralAmount,
    uint256 vaultType
  ) public view returns (bool) {
    address[] memory shorts = new address[](1);
    shorts[0] = short;
    address[] memory longs = new address[](1);
    longs[0] = long;
    address[] memory collaterals = new address[](1);
    collaterals[0] = collateral;
    uint256[] memory longAmounts = new uint256[](1);
    longAmounts[0] = longAmount;
    uint256[] memory collateralAmounts = new uint256[](1);
    collateralAmounts[0] = collateralAmount;
    uint256[] memory shortAmounts = new uint256[](1);
    shortAmounts[0] = shortAmount;

    MarginVault.Vault memory vault = MarginVault.Vault(
      shorts,
      longs,
      collaterals,
      shortAmounts,
      longAmounts,
      collateralAmounts
    );

    VaultDetails memory vaultDetails = _getVaultDetails(vault, vaultType);
    // include all the checks for to ensure the vault is valid
    _checkIsValidVault(vault, vaultDetails);
    return true;
  }

  /**
   * @notice return the collateral required for naked margin vault, in collateral asset decimals
   * @dev _shortAmount, _strikePrice and _underlyingPrice should be scaled by 1e8
   * @param _underlying underlying asset address
   * @param _strike strike asset address
   * @param _collateral collateral asset address
   * @param _shortAmount amount of short otoken
   * @param  _strikePrice otoken strike price
   * @param _underlyingPrice otoken underlying price
   * @param _shortExpiryTimestamp otoken expiry timestamp
   * @param _collateralDecimals otoken collateral asset decimals
   * @param _isPut otoken type
   */
  function getNakedMarginRequired(
    address _underlying,
    address _strike,
    address _collateral,
    uint256 _shortAmount,
    uint256 _strikePrice,
    uint256 _underlyingPrice,
    uint256 _shortExpiryTimestamp,
    uint256 _collateralDecimals,
    bool _isPut
  ) external override view returns (uint256) {
    // get product hash
    bytes32 productHash = _getProductHash(_underlying, _strike, _collateral, _isPut);

    // scale short amount from 1e8 to 1e27
    FPI.FixedPointInt memory shortAmount = FPI.fromScaledUint(_shortAmount, 27);
    // scale short strike from 1e8 to 1e27
    FPI.FixedPointInt memory shortStrike = FPI.fromScaledUint(_shortAmount, 27);
    // scale short underlying price from 1e8 to 1e27
    FPI.FixedPointInt memory shortUnderlyingPrice = FPI.fromScaledUint(_shortAmount, 27);

    // return required margin, scaled by option collateral asset decimals, explicitly rounded up
    return
      FPI.toScaledUint(
        _getNakedMarginRequired(
          productHash,
          shortAmount,
          shortStrike,
          shortUnderlyingPrice,
          _shortExpiryTimestamp,
          _isPut
        ),
        _collateralDecimals,
        false
      );
  }
}
// // we are assuming one short otoken, one long otoken and one collateral
// //	mapping :	collateral amount => short amount => long amount => collateralAsset
// mapping(uint256 => mapping(uint256 => mapping(uint256 => uint256))) internal excessCollateral;

// function getExcessCollateral(MarginVault.Vault memory _vault, uint256 vaultType) public view returns (uint256, bool) {
//   uint256 excess = excessCollateral[_vault.collateralAmounts[0]][_vault.shortAmounts[0]][_vault.longAmounts[0]];
//   if (excess >= 0) return (uint256(excess), true);
//   else return (uint256(-excess), false);
// }

// function getExcessCollateral(
//   uint256 shortAmounts,
//   uint256 longAmounts,
//   uint256 collateralAmounts
// ) public view returns (uint256, bool) {
//   uint256 excess = excessCollateral[collateralAmounts][shortAmounts][longAmounts];
//   if (excess >= 0) return (uint256(excess), true);
//   else return (uint256(-excess), false);
// }

// mapping(address => uint256) internal expiredPayoutRate;

// function getExpiredPayoutRate(address _otoken) external view returns (uint256) {
//   return expiredPayoutRate[_otoken];
// }
// }
