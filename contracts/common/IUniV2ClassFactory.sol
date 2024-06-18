// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.21;

interface IUniV2ClassFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}
