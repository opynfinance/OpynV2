# SafeTransfer simplification
perl -0777 -i -pe 's/safeT/t/g' contracts/MarginPool.sol
# Get proceed - memory to storage
perl -0777 -i -pe 's/function getProceed\(address _owner, uint256 _vaultId\) external view returns \(uint256\) \{\n\s*MarginVault.Vault memory vault = getVault/function getProceed\(address _owner, uint256 _vaultId\) external view returns \(uint256\) \{ MarginVault.Vault storage vault = cheapGetVault/igs' contracts/Controller.sol
# Get proceed & settleVault - call to getExcessCollateral
perl -0777 -i -pe 's/getExcessCollateral\(vault,/getExcessCollateral\(vault.shortAmounts[0],vault.longAmounts[0],vault.collateralAmounts[0],/igs' contracts/Controller.sol
# Settle vault - memory to storage
perl -0777 -i -pe 's/MarginVault.Vault memory vault = getVault\(_args.owner, _args.vaultId\);\n\s*bool hasShort/MarginVault.Vault storage vault = cheapGetVault\(_args.owner, _args.vaultId\); bool hasShort/igs' contracts/Controller.sol
# Settle vault - control long burning
perl -0777 -i -pe 's/if \(hasLong\) \{([\s\w=\[\]\(\).;,]*)\}/if \(hasLong\) \{ if \(vault.longOtokens[0] == anOtokenB\) \{ OtokenInterface longOtoken = OtokenInterface\(anOtokenB\);   longOtoken.burnOtoken\(address\(pool\), vault.longAmounts[0]\); \} if \(vault.longOtokens[0] == anOtokenA\) \{ OtokenInterface longOtoken = OtokenInterface\(anOtokenA\); longOtoken.burnOtoken\(address\(pool\), vault.longAmounts[0]\); \} else \{ \1 \} \}/igs' contracts/Controller.sol
# Add cheapGetVault and fields for otokens and collateral
perl -0777 -i -pe 's/for uint256;/for uint256 ; 
function cheapGetVault(address owner, uint256 vaultId) internal view returns (MarginVault.Vault storage) { return vaults[owner][vaultId]; } address public anOtokenA;  address public anOtokenB;  address public dummyERC20C;
/g' contracts/Controller.sol
# Virtualize runActions
# perl -0777 -i -pe 's/function _runActions\(Actions.ActionArgs\[\] memory _actions\)\s*internal/function _runActions\(Actions.ActionArgs\[\] memory _actions\) virtual internal/g' contracts/Controller.sol
# Virtualize getNakedMargin 
perl -0777 -i -pe 's/function getNakedMarginRequired\(\s*address _underlying,\s*address _strike,\s*address _collateral,\s*uint256 _shortAmount,\s*uint256 _strikePrice,\s*uint256 _underlyingPrice,\s*uint256 _shortExpiryTimestamp,\s*uint256 _collateralDecimals,\s*bool _isPut\s*\) external/function getNakedMarginRequired\(address _underlying, address _strike, address _collateral, uint256 _shortAmount, uint256 _strikePrice, uint256 _underlyingPrice, uint256 _shortExpiryTimestamp, uint256 _collateralDecimals, bool _isPut\) virtual external/g' contracts/MarginCalculator.sol
# Have constants instead of calling getUpperBound and spotShock
perl -0777 -i -pe 's/_findUpperBoundValue\(_productHash, _shortExpiryTimestamp\)/FPI.fromScaledUint\(5, SCALING_FACTOR\)/g' contracts/MarginCalculator.sol
perl -0777 -i -pe 's/FPI.fromScaledUint\(spotShock\[_productHash\], SCALING_FACTOR\)/FPI.fromScaledUint\(10, SCALING_FACTOR\)/g' contracts/MarginCalculator.sol
# _totalSupply should be internal
perl -0777 -i -pe 's/uint256 private _totalSupply;/uint256 internal _totalSupply;/g' contracts/packages/oz/upgradeability/ERC20Upgradeable.sol
# otoken.collateralAsset in settleVault should be dummyERC20C
perl -0777 -i -pe 's/pool.transferToUser\(collateral, _args.to, payout\)/pool.transferToUser\(dummyERC20C, _args.to, payout\)/g' contracts/Controller.sol
# MarginCalculatorInterface
perl -0777 -i -pe 's/interface MarginCalculatorInterface \{/interface  MarginCalculatorInterface \{ function getExcessCollateral\(uint256 shortAmounts,uint256 longAmounts,uint256 collateralAmounts, uint256 vaultType\) external view returns \(uint256, bool\);/igs' contracts/interfaces/MarginCalculatorInterface.sol
