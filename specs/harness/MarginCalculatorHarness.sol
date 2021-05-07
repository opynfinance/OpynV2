import '../../contracts/MarginCalculator.sol';
import {MarginVault} from '../../contracts/libs/MarginVault.sol';

pragma solidity =0.6.10;

contract MarginCalculatorHarness is MarginCalculator {
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

  function getExcessCollateral(
    address short,
    address long,
    address collateral,
    uint256 shortAmount,
    uint256 longAmount,
    uint256 collateralAmount,
    uint256 _vaultType
  ) public view returns (bool) {
    address[] memory shorts;
    shorts[0] = short;
    address[] memory longs;
    longs[0] = long;
    address[] memory collaterals;
    collaterals[0] = collateral;
    uint256[] memory longAmounts;
    longAmounts[0] = longAmount;
    uint256[] memory collateralAmounts;
    collateralAmounts[0] = collateralAmount;
    uint256[] memory shortAmounts;
    shortAmounts[0] = shortAmount;

    MarginVault.Vault memory v = MarginVault.Vault(
      shorts,
      longs,
      collaterals,
      shortAmounts,
      longAmounts,
      collateralAmounts
    );
    (uint256 collateral, ) = getExcessCollateral(v, _vaultType);
    return collateral;
  }

  function isValidVault(
    address short,
    address long,
    address collateral,
    uint256 shortAmount,
    uint256 longAmount,
    uint256 collateralAmount,
    uint256 _vaultType
  ) public view returns (bool) {
    address[] memory shorts;
    shorts[0] = short;
    address[] memory longs;
    longs[0] = long;
    address[] memory collaterals;
    collaterals[0] = collateral;
    uint256[] memory longAmounts;
    longAmounts[0] = longAmount;
    uint256[] memory collateralAmounts;
    collateralAmounts[0] = collateralAmount;
    uint256[] memory shortAmounts;
    shortAmounts[0] = shortAmount;

    MarginVault.Vault memory v = MarginVault.Vault(
      shorts,
      longs,
      collaterals,
      shortAmounts,
      longAmounts,
      collateralAmounts
    );
    (, bool isValid) = getExcessCollateral(v, _vaultType);
    return isValid;
  }
}
// // we are assuming one short otoken, one long otoken and one collateral
// //	mapping :	collateral amount => short amount => long amount => collateralAsset
// mapping(uint256 => mapping(uint256 => mapping(uint256 => uint256))) internal excessCollateral;

// function getExcessCollateral(MarginVault.Vault memory _vault) public view returns (uint256, bool) {
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
