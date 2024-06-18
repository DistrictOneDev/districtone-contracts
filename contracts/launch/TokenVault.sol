// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.21;

import {Erc20Utils, IERC20} from "../common/Erc20Utils.sol";
import "../BlastAdapter.sol";
import "../libraries/TokenVaultSignLib.sol";

// TokenVault contract is responsible for handling token deposits and withdrawals with signature verification.
contract TokenVault is BlastAdapter {
    using Erc20Utils for IERC20;
    using TokenVaultSignLib for TokenVaultSignLib.SignedData;

    // Custom errors for specific failure cases
    error ZeroAddress();
    error InvalidSignature();
    error NonceUsed();
    error InvalidAmountIn();

    // Events to log deposit and withdrawal actions
    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);

    // The address authorized to issue signatures.
    address public issuerAddress;

    // Mappings to track used nonces, deposited amounts, and withdrawn amounts per user and token
    mapping(address user => mapping(uint256 nonce => bool used)) public usedNonces;
    mapping(address user => mapping(address token => uint256 amount)) public deposited;
    mapping(address user => mapping(address token => uint256 amount)) public withdrawn;

    // Function to handle token deposits with signature verification
    function deposit(
        address token,
        uint256 amount,
        bytes calldata signature
    ) external verifySig(token, amount, 0, TokenVaultSignLib.SIGN_FOR_DEPOSIT, signature) {
        // Transfer the tokens from the user to this contract
        uint256 received = IERC20(token).safeTransferIn(msg.sender, amount);
        if (amount != received) revert InvalidAmountIn();

        // Update the deposited amount for the user and token
        deposited[msg.sender][token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    // Function to handle token withdrawals with signature verification
    function withdraw(
        address token,
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external verifySig(token, amount, nonce, TokenVaultSignLib.SIGN_FOR_WITHDRAW, signature) {
        // Check if the nonce has already been used
        if (usedNonces[msg.sender][nonce]) revert NonceUsed();
        usedNonces[msg.sender][nonce] = true;

        // Transfer the tokens from this contract to the user
        IERC20(token).transferOut(msg.sender, amount);
        withdrawn[msg.sender][token] += amount;

        emit Withdrawn(msg.sender, token, amount);
    }

    // Function to set the issuer address (only callable by the contract owner)
    function setIssuerAddress(address _issuerAddress) external onlyOwner {
        if (_issuerAddress == address(0)) revert ZeroAddress();
        issuerAddress = _issuerAddress;
    }

    // Modifier to verify the signature before executing the function
    modifier verifySig(
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 signType,
        bytes calldata signature
    ) {
        // Create a SignedData struct with the provided parameters
        TokenVaultSignLib.SignedData memory signedData = TokenVaultSignLib.SignedData(token, msg.sender, amount, nonce, signType);
        // Verify the signature
        if (!signedData.verify(signature, issuerAddress)) revert InvalidSignature();
        _;
    }
}
