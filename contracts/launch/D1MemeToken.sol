// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.21;

import {ERC20} from "@openzeppelin-5/contracts/token/ERC20/ERC20.sol";
import {BlastNoYieldAdapter} from "../BlastNoYieldAdapter.sol";

contract D1MemeToken is BlastNoYieldAdapter, ERC20 {
    error Initialized();

    bool private _initialized;

    string private _name;
    string private _symbol;

    constructor() ERC20("", "") {}

    function initialize(uint256 _initTotalSupply, string calldata tokenName, string calldata tokenSymbol, address _gasOperator) external onlyOwner {
        if (_initialized) revert Initialized();
        _mint(_msgSender(), _initTotalSupply);
        _name = tokenName;
        _symbol = tokenSymbol;
        if (_gasOperator != address(0)) {
            enableClaimable(_gasOperator);
        }
        _initialized = true;
    }

    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }
}
