// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.10;

import {ERC20Initializable} from "../packages/oz/upgradeability/ERC20Initializable.sol";
//import {ERC20Interface} from "../interfaces/ERC20Interface.sol";
import {SafeMath} from "../packages/oz/SafeMath.sol";

contract MockCETH is ERC20Initializable {
    using SafeMath for uint256;
    uint256 public exchangeRateStored;
    address public underlying;

    constructor(string memory _name, string memory _symbol) public {
        __ERC20_init_unchained(_name, _symbol);
        _setupDecimals(8);
    }

    function mint() public payable {
        uint256 cTokenAmount = msg.value.div(exchangeRateStored);
        _mint(msg.sender, cTokenAmount);
    }

    function redeem(uint256 amount) public {
        _burn(msg.sender, amount);
        uint256 underlyingAmount = amount.mul(exchangeRateStored);
        msg.sender.transfer(underlyingAmount);
    }

    function setExchangeRate(uint256 _exchangeRateStored) external {
        exchangeRateStored = _exchangeRateStored;
    }

    receive() external payable {
        mint();
    }
}
