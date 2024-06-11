// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.21;

interface IAirdropper {

    // Error declarations
    error ZeroAddress();
    error InvalidAmount();
    error InvalidTime();
    error InvalidParam();
    error OnlyExecutor();
    error OnlyFairLauncher();
    error NotStarted();
    error AlreadyCreated();
    error AlreadyClaimed();
    error ExceedsMaximum();

    // Events
    event Airdropped(address indexed token, uint256 amount, uint256 releaseStartAt, uint256 releaseEndAt, address fairLauncher);
    event TrancheAdded(address indexed token, uint256 trancheId, uint256 total, uint256 startTime, bytes32 merkleRoot);
    event Claimed(address indexed token, uint256 trancheId, address user, uint256 amount);

    function createAirdrop(address _token, uint256 _amount, uint256 _releaseStartAt, uint256 _releaseEndAt) external;
    function newTranche(address _token, uint256 _total, uint256 _startTime, bytes32 _merkleRoot) external;
    function claims(address _token, uint256[] calldata _trancheIds, uint256[] calldata _amounts, bytes32[][] calldata _merkleProofs) external;
    function setFairLauncher(address _fairLauncher) external;
    function setExecutor(address _fairLauncher) external;
    function getReleasable(address _token) external view returns (uint256);

}
