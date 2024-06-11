// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.21;

interface IFairLauncher {

    error ZeroAddress();
    error ZeroAmount();
    error InvalidETH();
    error InvalidTokenCfg();
    error InvalidTokenomicsCfg();
    error InvalidTimeCfg();
    error InvalidContributionCfg();
    error InvalidLaunchCfg();
    error InvalidParam();
    error InvalidAddress();
    error InvalidInviter();
    error InvalidSignature();
    error NotStarted();
    error NotLaunched();
    error NotEnded();
    error NotEnough();
    error Ended();
    error ExceedsMaximum();
    error AlreadyLaunched();
    error AlreadyClaimed();
    error AlreadyRefund();
    error AlreadyReserved();
    error UnsupportedDex();
    error OnlyExecutor();
    error Suspend();

    struct TokenCfg {
        uint256 totalSupply;
        string name;
        string symbol;
    }

    struct PresaleCfg {
        uint256 startTime; //  startTime The start time of the presale.
        uint256 endTime; // The end time of the presale.
        uint256 personalCapMin; // The minimum ETH required to participate in the presale for a user.
        uint256 personalCapMax; // The maximum ETH allowed to participate in the presale for a user.
        uint256 softCap; // The minimum ETH required to trigger the launch.
        uint256 hardCap; // The maximum ETH allowed to trigger the launch.
        uint256 overfundedDiscount; // Discount for overfunded contributions (in percentage, e.g., 8000 means 80%).
    }

    struct TokenomicsCfg {
        uint256 amtForLP; // The amount of tokens allocated for the liquidity pool.
        uint256 amtForPresale; // The amount of tokens allocated for the presale.
        uint256 amtForAirdrop; // The amount of tokens allocated for the airdrop.
        uint256 amtForFreeClaim; // The amount of tokens allocated for free claims.
        uint256 airdropDuration; // The duration for the airdrop period.
        uint256 freeClaimPerUser; // The amount of tokens each user can claim for free.
    }

    struct FeesCfg {
        address payable feeRecipient; // The address where protocol fees are sent.
        uint256 createFees; // The ETH fees for creating a new token launch.
        uint256 launchProtocolFees; // The protocol fee percentage (e.g., 500 for 5%).
        uint256 directInviteFees; // The ETH reward percentage for direct invites (e.g., 1000 for 10%).
        uint256 secondTierInviteFees; // The ETH reward percentage for second-tier invites (e.g., 1000 for 10%).
    }

    struct SignCfg {
        address issuerAddress; // The address authorized to issue signatures.
        uint256 validDuration; // The time duration in seconds for which a signature remains valid.
    }

    struct OLESwapCfg {
        address ole; // The address of the OLE token.
        address dexRouter; // The address of the DEX router for swapping.
    }

    struct SuspendCfg {
        bool all; // A flag to suspend all operations.
        bool presale; // A flag to suspend presale operations.
        bool refund; // A flag to suspend refund operations.
        bool reserve; // A flag to suspend reserve operations.
        bool claim; // A flag to suspend claim operations.
    }

    struct ClaimableAmt {
        uint256 presaleClaim; // Amount of tokens claimable from the presale.
        uint256 freeClaim; // Amount of tokens claimable as free claim.
        uint256 oleClaim; // Amount of OLE tokens claimable.
        uint256 overfundedRefund; // Amount of ETH refundable due to overfunded.
    }

    // Events for tracking contract activities
    event LaunchCreated(
        address token,
        uint256 spaceIdx,
        address creator,
        uint256 totalSupply,
        string name,
        string symbol,
        PresaleCfg presaleCfg,
        TokenomicsCfg tokenomicsCfg,
        uint256 createOLEFees
    );
    event Participated(address indexed token, address user, address inviter, uint256 amount, uint256 share, uint256 directFees, uint256 secondTierFees);
    event Refunded(address indexed token, address user, uint256 amount);
    event FreeClaimReserved(address indexed token, address user, uint256 amount);
    event Claimed(address indexed token, address user, uint256 presale, uint256 freeClaim, uint256 oleReward, uint256 overfundedRefund);
    event Launched(address indexed token, address lpTokenAddr, uint256 liquidity, uint256 tokenForLp, uint256 ethForLp, uint256 ethForProtocolFee, uint256 oleReward);

    function newFairLaunch(TokenCfg calldata _tokenCfg, PresaleCfg calldata _presaleCfg, TokenomicsCfg calldata _tokenAssignCfg, uint256 _minBoughtOle) external payable;
    function participate(uint256 _timestamp, bytes calldata _signature, address inviter, address _token) external payable;
    function refundForLaunchFail(uint256 _timestamp, bytes calldata _signature, address _token) external;
    function reserveFreeClaim(uint256 _timestamp, bytes calldata _signature, address _token) external;
    function claims(uint256 _timestamp, bytes calldata _signature, address _token) external;
    function launch(address _token, address _dexRouter, uint256 _minBoughtOle) external;

    /*** Admin Functions ***/
    function setFeesCfg(FeesCfg calldata _cfg) external;
    function setOLESwapCfg(OLESwapCfg calldata _cfg) external;
    function setSignConf(SignCfg calldata _cfg) external;
    function setSuspendCfg(SuspendCfg calldata _cfg) external;
    function setGasOperator(address _gasOperator) external;
    function setExecutor(address _executor) external;
    function setSpaceShare(address _spaceShare) external;
    function setAirdropper(address _airdropper) external;
    function setSupportedDexRouter(address _router, bool _support) external;

    /*** View Functions ***/
    function getClaimable(address _token, address _user) external view returns (ClaimableAmt memory);
    function launched(address _token) external view returns (bool);
    function executor() external view returns (address);

}
