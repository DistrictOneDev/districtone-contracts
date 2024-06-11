// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

library LaunchSignLib {

    uint256 public constant SIGN_FOR_PRESALE = 0;
    uint256 public constant SIGN_FOR_REFUND = 1;
    uint256 public constant SIGN_FOR_RESERVE = 2;
    uint256 public constant SIGN_FOR_CLAIM = 3;

    struct SignedData {
        address token;
        address user;
        address inviter;
        uint256 timestamp;
        uint256 signType;
     }

    function verify(SignedData memory signedData, bytes memory signature, address issuerAddress, uint256 validDuration) internal view returns (bool) {
        require(block.timestamp <= signedData.timestamp + validDuration, "Signature is expired");

        bytes32 dataHash = keccak256(abi.encodePacked(signedData.token, signedData.user, signedData.inviter, signedData.timestamp, signedData.signType));
        bytes32 message = prefixed(dataHash);

        address signer = recoverSigner(message, signature);
        return signer == issuerAddress;
    }

    function recoverSigner(bytes32 message, bytes memory sig) internal pure returns (address) {
        (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);
        return ecrecover(message, v, r, s);
    }

    function splitSignature(bytes memory sig) internal pure returns (uint8, bytes32, bytes32) {
        require(sig.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }

        return (v, r, s);
    }

    function prefixed(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }
}
