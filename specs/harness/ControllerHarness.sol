pragma solidity =0.6.10;

pragma experimental ABIEncoderV2;

import '../../contracts/Controller.sol';
import {ERC20Interface} from '../../contracts/interfaces/ERC20Interface.sol';
import {MarginVault} from '../../contracts/libs/MarginVault.sol';
import {OtokenInterface} from '../../contracts/interfaces/OtokenInterface.sol';

contract ControllerHarness is Controller {
  /** 
    We work on each function independently.
    We also need to make it virtual:
    sed 's/function _runActions\(Actions.ActionArgs[] memory _actions\)/function _runActions\(Actions.ActionArgs[] memory _actions\) virtual/g'
   */
  function _runActions(Actions.ActionArgs[] memory _actions)
    internal
    override
    returns (
      bool,
      address,
      uint256
    )
  {}

  /* will be added by harness script */
  /*
  address public anOtokenA;
  address public anOtokenB;
  address public dummyERC20C;
  */
  function assetBalanceOf(address asset, address a) external view returns (uint256) {
    if (asset == anOtokenA) return ERC20Interface(anOtokenA).balanceOf(a);
    else if (asset == anOtokenB) return ERC20Interface(anOtokenB).balanceOf(a);
    else if (asset == dummyERC20C) return ERC20Interface(dummyERC20C).balanceOf(a);
    else return ERC20Interface(asset).balanceOf(a);
  }

  function assetBalanceOfPool(address asset) external view returns (uint256) {
    if (asset == anOtokenA) return ERC20Interface(anOtokenA).balanceOf(address(pool));
    else if (asset == anOtokenB) return ERC20Interface(anOtokenB).balanceOf(address(pool));
    else if (asset == dummyERC20C) return ERC20Interface(dummyERC20C).balanceOf(address(pool));
    else return ERC20Interface(asset).balanceOf(address(pool));
  }

  function assetTotalSupply(address asset) external view returns (uint256) {
    if (asset == anOtokenA) return ERC20Interface(anOtokenA).totalSupply();
    else if (asset == anOtokenB) return ERC20Interface(anOtokenB).totalSupply();
    else if (asset == dummyERC20C) return ERC20Interface(dummyERC20C).totalSupply();
    else return ERC20Interface(asset).totalSupply();
  }

  function smallVault(
    address owner,
    uint256 vaultId,
    uint256 c
  ) public view returns (bool) {
    MarginVault.Vault storage _vault = cheapGetVault(owner, vaultId);
    return
      _vault.shortOtokens.length <= c &&
      _vault.longOtokens.length <= c &&
      _vault.collateralAssets.length <= c &&
      _vault.longAmounts.length <= c &&
      _vault.shortAmounts.length <= c &&
      _vault.collateralAmounts.length <= c;
  }

  function isValidAsset(address asset) external view returns (bool) {
    return true;
  }

  /* will be added by harness script */
  /*
  function cheapGetVault(address owner, uint256 vaultId) internal view returns (MarginVault.Vault storage) {
    return vaults[owner][vaultId];
    }
  */

  function isValidVault(address owner, uint256 vaultId) external view returns (bool) {
    MarginVault.Vault storage _vault = cheapGetVault(owner, vaultId);
    (, bool isValidVault) = calculator.getExcessCollateral(
      _vault, /*
      _vault.shortAmounts[0],
      _vault.longAmounts[0],
      _vault.collateralAmounts[0],*/
      vaultType[owner][vaultId]
    );
    return isValidVault;
  }

  function getVaultCollateralAmount(
    address owner,
    uint256 vaultId,
    uint256 i
  ) external returns (uint256) {
    MarginVault.Vault storage vault = cheapGetVault(owner, vaultId);
    return vault.collateralAmounts[i];
  }

  function getVaultCollateralAsset(
    address owner,
    uint256 vaultId,
    uint256 i
  ) external returns (address) {
    MarginVault.Vault storage vault = cheapGetVault(owner, vaultId);
    return vault.collateralAssets[i];
  }

  function getVaultLongAmount(
    address owner,
    uint256 vaultId,
    uint256 i
  ) external returns (uint256) {
    MarginVault.Vault storage vault = cheapGetVault(owner, vaultId);
    return vault.longAmounts[i];
  }

  function getVaultLongOtoken(
    address owner,
    uint256 vaultId,
    uint256 i
  ) external returns (address) {
    MarginVault.Vault storage vault = cheapGetVault(owner, vaultId);
    return vault.longOtokens[i];
  }

  function getVaultShortAmount(
    address owner,
    uint256 vaultId,
    uint256 i
  ) external returns (uint256) {
    MarginVault.Vault storage vault = cheapGetVault(owner, vaultId);
    return vault.shortAmounts[i];
  }

  function getVaultShortOtoken(
    address owner,
    uint256 vaultId,
    uint256 i
  ) external returns (address) {
    MarginVault.Vault storage vault = cheapGetVault(owner, vaultId);
    return vault.shortOtokens[i];
  }

  function isVaultExpired(address owner, uint256 vaultId) external view returns (bool) {
    MarginVault.Vault storage vault = cheapGetVault(owner, vaultId);
    bool hasShorts = _isNotEmpty(vault.shortOtokens);
    bool hasLongs = _isNotEmpty(vault.longOtokens);
    address otoken = hasShorts ? vault.shortOtokens[0] : vault.longOtokens[0];
    (, , , , uint256 expiry, ) = OtokenInterface(otoken).getOtokenDetails();
    return ((hasShorts || hasLongs) && now >= expiry);
  }

  function openVault(address owner, uint256 vaultId) external {
    Actions.OpenVaultArgs memory args = Actions.OpenVaultArgs({owner: owner, vaultId: vaultId, vaultType: 0});
    _openVault(args);
  }

  function depositLongA(
    address owner,
    uint256 vaultId,
    address from,
    uint256 index,
    uint256 amount
  ) external {
    Actions.DepositArgs memory args = Actions.DepositArgs({
      owner: owner,
      vaultId: vaultId,
      from: from,
      asset: anOtokenA,
      index: index,
      amount: amount
    });
    _depositLong(args);
  }

  function depositLongB(
    address owner,
    uint256 vaultId,
    address from,
    uint256 index,
    uint256 amount
  ) external {
    Actions.DepositArgs memory args = Actions.DepositArgs({
      owner: owner,
      vaultId: vaultId,
      from: from,
      asset: anOtokenB,
      index: index,
      amount: amount
    });
    _depositLong(args);
  }

  function withdrawLongA(
    address owner,
    uint256 vaultId,
    address to,
    uint256 index,
    uint256 amount
  ) external {
    Actions.WithdrawArgs memory args = Actions.WithdrawArgs({
      owner: owner,
      vaultId: vaultId,
      to: to,
      asset: anOtokenA,
      index: index,
      amount: amount
    });
    _withdrawLong(args);
  }

  function withdrawLongB(
    address owner,
    uint256 vaultId,
    address to,
    uint256 index,
    uint256 amount
  ) external {
    Actions.WithdrawArgs memory args = Actions.WithdrawArgs({
      owner: owner,
      vaultId: vaultId,
      to: to,
      asset: anOtokenB,
      index: index,
      amount: amount
    });
    _withdrawLong(args);
  }

  function depositCollateral(
    address owner,
    uint256 vaultId,
    address from,
    uint256 index,
    uint256 amount
  ) external {
    require(smallVault(owner, vaultId, 1));
    Actions.DepositArgs memory args = Actions.DepositArgs({
      owner: owner,
      vaultId: vaultId,
      from: from,
      asset: dummyERC20C,
      index: index,
      amount: amount
    });
    _depositCollateral(args);
  }

  function withdrawCollateral(
    address owner,
    uint256 vaultId,
    address to,
    uint256 index,
    uint256 amount
  ) external {
    require(smallVault(owner, vaultId, 1));
    Actions.WithdrawArgs memory args = Actions.WithdrawArgs({
      owner: owner,
      vaultId: vaultId,
      to: to,
      asset: dummyERC20C,
      index: index,
      amount: amount
    });
    _withdrawCollateral(args);
  }

  function mintOtokenA(
    address owner,
    uint256 vaultId,
    address to,
    uint256 index,
    uint256 amount
  ) external {
    require(smallVault(owner, vaultId, 1));
    Actions.MintArgs memory args = Actions.MintArgs({
      owner: owner,
      vaultId: vaultId,
      to: to,
      otoken: anOtokenA,
      index: index,
      amount: amount
    });
    _mintOtoken(args);
  }

  function mintOtokenB(
    address owner,
    uint256 vaultId,
    address to,
    uint256 index,
    uint256 amount
  ) external {
    require(smallVault(owner, vaultId, 1));
    Actions.MintArgs memory args = Actions.MintArgs({
      owner: owner,
      vaultId: vaultId,
      to: to,
      otoken: anOtokenB,
      index: index,
      amount: amount
    });
    _mintOtoken(args);
  }

  function burnOtokenA(
    address owner,
    uint256 vaultId,
    address from,
    uint256 index,
    uint256 amount
  ) external {
    require(smallVault(owner, vaultId, 1));
    Actions.BurnArgs memory args = Actions.BurnArgs({
      owner: owner,
      vaultId: vaultId,
      from: from,
      otoken: anOtokenA,
      index: index,
      amount: amount
    });
    _burnOtoken(args);
  }

  function burnOtokenB(
    address owner,
    uint256 vaultId,
    address from,
    uint256 index,
    uint256 amount
  ) external {
    require(smallVault(owner, vaultId, 1));
    Actions.BurnArgs memory args = Actions.BurnArgs({
      owner: owner,
      vaultId: vaultId,
      from: from,
      otoken: anOtokenB,
      index: index,
      amount: amount
    });
    _burnOtoken(args);
  }

  function redeemA(address receiver, uint256 amount) external {
    Actions.RedeemArgs memory args = Actions.RedeemArgs({receiver: receiver, otoken: anOtokenA, amount: amount});
    _redeem(args);
  }

  function redeemB(address receiver, uint256 amount) external {
    Actions.RedeemArgs memory args = Actions.RedeemArgs({receiver: receiver, otoken: anOtokenB, amount: amount});
    _redeem(args);
  }

  /**
    - require a small vault: sed 's/bool hasShorts/require\(smallVault\(owner,vaultId,1\)\); bool hasShorts/g'
    - change memory to storage: sed 's/MarginVault.Vault memory vault = getVault/MarginVault.Vault storage vault = cheapGetVault/g'
    - Control long burning: sed 's/if \(hasLongs\) /if \(hasLongs\) { if \(vault.longOtokens[0] == anOtokenB\) { OtokenInterface longOtoken = OtokenInterface\(anOtokenB\);   longOtoken.burnOtoken\(address\(pool\), vault.longAmounts[0]\); } if \(vault.longOtokens[0] == anOtokenA\) { OtokenInterface longOtoken = OtokenInterface\(anOtokenA\); longOtoken.burnOtoken\(address\(pool\), vault.longAmounts[0]\); } else {/g'
    - and : sed 's/delete vaults/} delete vaults/g'
  */
  function settleVault(
    address owner,
    uint256 vaultId,
    address to
  ) external {
    Actions.SettleVaultArgs memory args = Actions.SettleVaultArgs({owner: owner, vaultId: vaultId, to: to});
    _settleVault(args);
  }

  /**
    - change memory to storage: sed 's/MarginVault.Vault memory vault = getVault/MarginVault.Vault storage vault = cheapGetVault/g'
    - call with extended calculator: sed 's/getExcessCollateral\(vault/getExcessCollateral\(vault.shortAmounts[0],vault.longAmounts[0],vault.collateralAmounts[0]/g'
  */
  /*function getProceed(address _owner, uint256 _vaultId) external view override returns (uint256) {
        MarginVault.Vault storage vault = cheapGetVault(_owner, _vaultId);

        (uint256 netValue, ) = calculator.getExcessCollateral(vault.shortAmounts[0],
        vault.longAmounts[0],
        vault.collateralAmounts[0]);
        return netValue;
  }*/

  // For invariants
  function init_state() public {}

  // In MarginPool:
  // sed 's/safeT/t/g'

  // TODO: remove --staging everywhere in scripts
}
