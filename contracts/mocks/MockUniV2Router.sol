// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.21;

import "./MockUniV2Factory.sol";
import {ERC20} from "@openzeppelin-5/contracts/token/ERC20/ERC20.sol";

contract MockUniV2Router {
    MockUniV2Factory public factory;

    uint256 public minSwapReturn;

    uint256 public minTokensForAddLiquidity;

    function swapExactETHForTokens(
        uint256 minTokens,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts) {
        path;
        deadline;
        uint256[] memory result = new uint256[](2);
        result[0] = msg.value;
        result[1] = minTokens;
        require(minTokens >= minSwapReturn, "INSUFFICIENT_OUTPUT_AMOUNT");
        ERC20(path[1]).transfer(to, minTokens);
        return result;
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        token;
        amountTokenMin;
        amountETHMin;
        to;
        deadline;
        require(amountTokenMin >= minTokensForAddLiquidity, "INSUFFICIENT_A_AMOUNT");
        return (amountTokenDesired, msg.value, amountTokenDesired + msg.value);
    }

    function setFactory(address _factory) external {
        factory = MockUniV2Factory(_factory);
    }

    function setMinSwapReturn(uint256 _minSwapReturn) external {
        minSwapReturn = _minSwapReturn;
    }

    function setMinTokensForAddLiquidity(uint256 _minTokensForAddLiquidity) external {
        minTokensForAddLiquidity = _minTokensForAddLiquidity;
    }
}
