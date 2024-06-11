// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IFairLauncher} from "./interface/IFairLauncher.sol";
import {IAirdropper} from "./interface/IAirdropper.sol";
import {Erc20Utils, IERC20} from "../common/Erc20Utils.sol";
import {BlastAdapter} from "../BlastAdapter.sol";
import "@openzeppelin-5/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title Airdropper Contract
 * @dev Manages the claiming of airdropped tokens for multiple token launch campaigns.
 * Utilizes OpenZeppelin's Ownable for ownership management.
 */
contract Airdropper is BlastAdapter, IAirdropper {
    using Erc20Utils for IERC20;

    // Structure to store tranche details
    struct Tranche {
        uint256 total; // Total tokens allocated for the tranche
        uint256 claimed; // Total tokens claimed from the tranche
        uint256 startTime; // Start time for claiming tokens from the tranche
        bytes32 merkleRoot; // Merkle root for the tranche
    }

    // Structure to store airdrop details
    struct Airdrop {
        address fairLauncher; // Address of the FairLauncher contract
        uint256 totalAmount; // Total amount of tokens available for the airdrop
        uint256 totalReleased; // Total amount of tokens assigned to tranches
        uint256 releaseStartAt; // Start time for the release of the airdrop
        uint256 releaseEndAt; // End time for the release of the airdrop
        uint256 trancheIdx; // Index to track the current tranche, auto-incremented
    }

    address public fairLauncher; // Address of the FairLauncher contract
    address public executor; // Address authorized to execute newTranche functions.

    // Mappings to manage multiple token distributions
    mapping(address token => Airdrop) public airdrops; // Mapping of token address to Airdrop struct
    mapping(address token => mapping(uint256 trancheId => Tranche)) public tranches; // Mapping of token address to tranche ID to Tranche struct
    mapping(address token => mapping(uint256 trancheId => mapping(address user => uint256 amount))) public claimed; // Mapping of token address to tranche ID to user address to claimed amount

    /**
     * @notice Constructor to create Airdropper contract instance.
     * @param _fairLauncher Address of the FairLauncher contract.
     */
    constructor(address _fairLauncher, address _executor) {
        fairLauncher = _fairLauncher;
        executor = _executor;
    }

    /**
     * @notice Allows FairLauncher to donate tokens for airdrop.
     * @param _token Address of the token being donated.
     * @param _amount Amount of tokens to donate.
     * @param _releaseStartAt Release start time for the airdrop.
     * @param _releaseEndAt Release end time for the airdrop.
     */
    function createAirdrop(
        address _token,
        uint256 _amount,
        uint256 _releaseStartAt,
        uint256 _releaseEndAt
    ) external override {
        if (_msgSender() != fairLauncher) revert OnlyFairLauncher();
        if (_releaseStartAt < block.timestamp || _releaseStartAt >= _releaseEndAt) revert InvalidTime();
        Airdrop storage airdrop = airdrops[_token];
        if (airdrop.totalAmount > 0) revert AlreadyCreated();

        uint256 received = IERC20(_token).safeTransferIn(_msgSender(), _amount);
        if (_amount != received) revert InvalidAmount();

        airdrop.totalAmount = _amount;
        airdrop.releaseStartAt = _releaseStartAt;
        airdrop.releaseEndAt = _releaseEndAt;
        airdrop.fairLauncher = fairLauncher;

        emit Airdropped(_token, _amount, airdrop.releaseStartAt, airdrop.releaseEndAt, fairLauncher);
    }

    /**
     * @notice Adds a new tranche for token distribution.
     * @param _token Address of the token.
     * @param _merkleRoot The merkle root for verifying claims.
     * @param _total The total amount of tokens in the tranche.
     * @param _startTime The start time for claiming tokens in the tranche.
     */
    function newTranche(
        address _token,
        uint256 _total,
        uint256 _startTime,
        bytes32 _merkleRoot
    ) external override {
        if (_msgSender() != executor) revert OnlyExecutor();
        if (_startTime < block.timestamp) revert InvalidTime();

        Airdrop storage airdrop = airdrops[_token];
        if (!IFairLauncher(airdrop.fairLauncher).launched(_token)) revert NotStarted();

        uint256 releasable = _releasable(airdrop.totalAmount, airdrop.releaseStartAt, airdrop.releaseEndAt);
        if (_total == 0 || _total > releasable - airdrop.totalReleased) revert InvalidAmount();

        airdrop.totalReleased += _total;
        uint256 trancheId = ++airdrop.trancheIdx;
        tranches[_token][trancheId] = Tranche(_total, 0, _startTime, _merkleRoot);

        emit TrancheAdded(_token, trancheId, _total, _startTime, _merkleRoot);
    }

    /**
     * @notice Claims tokens from multiple tranches.
     * @param _token Address of the token.
     * @param _trancheIds Array of tranche IDs to claim from.
     * @param _amounts Array of amounts to claim from each tranche.
     * @param _merkleProofs Array of merkle proofs for each claim.
     */
    function claims(
        address _token,
        uint256[] calldata _trancheIds,
        uint256[] calldata _amounts,
        bytes32[][] calldata _merkleProofs
    ) external override {
        uint256 len = _trancheIds.length;
        if (len == 0 || len != _amounts.length || len != _merkleProofs.length) revert InvalidParam();

        uint256 totalClaim;
        for (uint256 i = 0; i < len; i++) {
            totalClaim += _claim(_token, _trancheIds[i], _amounts[i], _merkleProofs[i]);
        }

        IERC20(_token).transferOut(_msgSender(), totalClaim);
    }

    function setFairLauncher(address _fairLauncher) external override onlyOwner {
        if (_fairLauncher == address(0)) revert ZeroAddress();
        fairLauncher = _fairLauncher;
    }

    function setExecutor(address _executor) external override onlyOwner {
        if (_executor == address(0)) revert ZeroAddress();
         executor = _executor;
    }

    /**
     * @notice Returns the amount of tokens that can be released for a given token.
     * @param _token Address of the token.
     * @return The releasable amount of tokens.
     */
    function getReleasable(address _token) external view override returns (uint256) {
        Airdrop memory airdrop = airdrops[_token];
        return _releasable(airdrop.totalAmount, airdrop.releaseStartAt, airdrop.releaseEndAt);
    }

    /**
     * @dev Claims tokens from a specific tranche.
     * @param _token Address of the token.
     * @param _trancheId ID of the tranche to claim from.
     * @param _amount Amount of tokens to claim.
     * @param _merkleProof Merkle proof for verifying the claim.
     * @return amount The amount of tokens claimed.
     */
    function _claim(address _token, uint256 _trancheId, uint256 _amount, bytes32[] calldata _merkleProof) internal returns (uint256 amount) {
        Tranche storage tranche = tranches[_token][_trancheId];
        if (block.timestamp < tranche.startTime) revert NotStarted();
        if (claimed[_token][_trancheId][_msgSender()] > 0) revert AlreadyClaimed();
        if (_amount > tranche.total - tranche.claimed) revert ExceedsMaximum();
        if (_amount == 0 || !_verifyMerkle(_msgSender(), tranche.merkleRoot, _amount, _merkleProof)) revert InvalidParam();

        claimed[_token][_trancheId][_msgSender()] = _amount;
        tranche.claimed += _amount;

        emit Claimed(_token, _trancheId, _msgSender(), _amount);
        return _amount;
    }

    /**
     * @dev Verifies the merkle proof for a claim.
     * @param account The address of the account claiming tokens.
     * @param root The merkle root for the tranche.
     * @param _balance The amount of tokens being claimed.
     * @param _merkleProof The merkle proof for the claim.
     * @return valid Boolean indicating whether the proof is valid.
     */
    function _verifyMerkle(address account, bytes32 root, uint256 _balance, bytes32[] calldata _merkleProof) internal pure returns (bool valid) {
        bytes32 leaf = keccak256(abi.encodePacked(account, _balance));
        return MerkleProof.verify(_merkleProof, root, leaf);
    }

    /**
     * @dev Calculates the releasable amount of tokens based on the current timestamp.
     * @param total Total amount of tokens to be released.
     * @param startTime Start time of the release period.
     * @param endTime End time of the release period.
     * @return releasable The amount of tokens that can be released.
     */
    function _releasable(uint256 total, uint256 startTime, uint256 endTime) internal view returns (uint256 releasable) {
        if (block.timestamp > endTime) {
            return total;
        } else {
            return (block.timestamp - startTime) * total / (endTime - startTime);
        }
    }
}
