// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract MockUniV2Factory {

    // Mapping from token pairs to their pair addresses
    mapping(address => mapping(address => address)) private _pairs;

    /**
     * @dev Sets the pair address for a given token pair.
     * @param tokenA Address of the first token.
     * @param tokenB Address of the second token.
     * @param pair Address of the pair contract.
     */
    function setPair(address tokenA, address tokenB, address pair) external {
        _pairs[tokenA][tokenB] = pair;
        _pairs[tokenB][tokenA] = pair; // Support reverse lookup
    }

    /**
     * @dev Returns the pair address for a given token pair.
     * @param tokenA Address of the first token.
     * @param tokenB Address of the second token.
     * @return pair Address of the pair contract.
     */
    function getPair(address tokenA, address tokenB) external view returns (address pair) {
        return _pairs[tokenA][tokenB];
    }
}