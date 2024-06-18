// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.21;

import {IERC20} from "@openzeppelin-5/contracts/token/ERC20/IERC20.sol";
import {IAirdropper} from "../launch/interface/IAirdropper.sol";

contract MockFairLaunch {
    mapping(address => bool) public tokenLaunched;

    function createAirdrop(address airdropper, address token, uint256 amount, uint256 startTime, uint256 endTime) public {
        IERC20(token).approve(airdropper, amount);
        IAirdropper(airdropper).createAirdrop(token, amount, startTime, endTime);
    }

    function launched(address token) public view returns (bool) {
        return tokenLaunched[token];
    }

    function setTokenLaunch(address token) public {
        tokenLaunched[token] = true;
    }

    function removeTokenLaunch(address token) public {
        tokenLaunched[token] = false;
    }
}
