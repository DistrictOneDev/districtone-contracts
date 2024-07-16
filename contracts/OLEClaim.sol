// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.21;

import {IERC20} from "@openzeppelin-5/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin-5/contracts/utils/cryptography/ECDSA.sol";
import {BlastAdapter} from "./BlastAdapter.sol";

contract OLEClaim is BlastAdapter {
    // Event for logging claim actions, now includes the signature and epoch
    event Claimed(address indexed claimer, uint256 epoch, uint256 amount, bytes signature);

    // Custom errors
    error InvalidAddress();
    error SignatureAlreadyUsed();
    error InvalidSignature();
    error InsufficientTokens();
    error MismatchedInputLengths();

    IERC20 public oleToken;
    address public signer; // Address allowed to sign the claim messages

    // Mapping to track used signatures
    mapping(bytes32 => bool) public usedSignatures;

    constructor(address _oleTokenAddress, address _initialSigner) {
        if (_oleTokenAddress == address(0)) revert InvalidAddress();
        if (_initialSigner == address(0)) revert InvalidAddress();
        oleToken = IERC20(_oleTokenAddress);
        signer = _initialSigner;
    }

    // Function to claim OLE tokens
    function claimOLE(uint256 epoch, uint256 amount, uint256 timestamp, bytes memory signature) public {
        bytes32 message = prefixed(keccak256(abi.encodePacked(address(this), msg.sender, amount, epoch, timestamp)));
        bytes32 sigHash = keccak256(signature);

        if (usedSignatures[sigHash]) revert SignatureAlreadyUsed();
        if (recoverSigner(message, signature) != signer) revert InvalidSignature();

        usedSignatures[sigHash] = true; // Mark signature as used
        oleToken.transfer(msg.sender, amount);
        emit Claimed(msg.sender, epoch, amount, signature); // Emitting signature and epoch in the event
    }

    // Batch claim function
    function claimOLEBatch(uint256[] memory epochs, uint256[] memory amounts, uint256[] memory timestamps, bytes[] memory signatures) public {
        if (epochs.length != amounts.length || amounts.length != signatures.length || amounts.length != timestamps.length) {
            revert MismatchedInputLengths();
        }

        for (uint i = 0; i < epochs.length; i++) {
            claimOLE(epochs[i], amounts[i], timestamps[i], signatures[i]);
        }
    }

    // Function to set the signer address
    function setSigner(address newSigner) public onlyOwner {
        if (newSigner == address(0)) revert InvalidAddress();
        signer = newSigner;
    }

    // Function to change the OLE token contract address
    function setOLETokenAddress(address newTokenAddress) public onlyOwner {
        if (newTokenAddress == address(0)) revert InvalidAddress();
        oleToken = IERC20(newTokenAddress);
    }

    // Function to recycle OLE tokens from the contract to a specified address
    function recycleOLE(address recipient, uint256 amount) public onlyOwner {
        if (oleToken.balanceOf(address(this)) < amount) revert InsufficientTokens();
        oleToken.transfer(recipient, amount);
    }

    // Internal function to prefix a hash to mimic the behavior of eth_sign
    function prefixed(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    // Function to recover the signer of the message
    function recoverSigner(bytes32 message, bytes memory sig) internal pure returns (address) {
        return ECDSA.recover(message, sig);
    }
}
