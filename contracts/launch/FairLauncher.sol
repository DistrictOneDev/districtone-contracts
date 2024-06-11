// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IFairLauncher} from "./interface/IFairLauncher.sol";
import {IAirdropper} from "./interface/IAirdropper.sol";
import {D1MemeToken} from "./D1MemeToken.sol";
import {ISpaceShare} from "../share/ISpaceShare.sol";
import {IUniV2ClassRouter} from "../common/IUniV2ClassRouter.sol";
import {IUniV2ClassFactory} from "../common/IUniV2ClassFactory.sol";
import {Erc20Utils, IERC20} from "../common/Erc20Utils.sol";
import {LaunchSignLib} from "../libraries/LaunchSignLib.sol";
import {BlastNoYieldAdapter} from "../BlastNoYieldAdapter.sol";

/**
 * @title FairLauncher Contract
 * @dev Manages the presale and launch process for multiple tokens. It handles ETH contributions, refunds, token claims, and liquidity provisioning for new token launches.
 */
contract FairLauncher is IFairLauncher, BlastNoYieldAdapter {
    using Erc20Utils for IERC20;
    using LaunchSignLib for LaunchSignLib.SignedData;

    address private constant ZERO_ADDRESS = address(0);
    uint256 private constant PERCENT_DIVISOR = 10000; // Divisor for calculations.
    uint256 private constant MIN_PER_PARTICIPATION_ETH = 0.0001 ether; // Minimum ETH contribution for per participation

    address public immutable WETH; // Address of the WETH token.

    address public gasOperator; // The address of the gas operator.
    address public executor; // Address authorized to execute launch functions.
    ISpaceShare public spaceShare; // Address of the SpaceShare contract.
    IAirdropper public airdropper; // Address of the Airdropper contract.

    FeesCfg public feesCfg; // Configuration for fees.
    SignCfg public signCfg; // Configuration for signatures.
    OLESwapCfg public oleSwapCfg; // Configuration for OLE token swaps.
    SuspendCfg public suspendCfg; // Configuration for suspending various operations.

    struct TokenLaunch {
        uint256 totalRaised; // Total ETH raised during the presale.
        uint256 totalForInvite; // Total ETH rewards for invites during the presale.
        uint256 totalShareAmt; // Total share amount used for token distribution in the fundraising.
        uint256 totalRefunded; // Total ETH refunded in case of unsuccessful presale.
        uint256 totalReserved; // Total amount of tokens reserved for free claim.
        uint256 oleRewardForInvite; // Total OLE amount for invite reward.
        address oleAddrForReward; // Record the OLE address obtained from the swap to avoid issues if the OLE address changes in the future.
        bool isLaunched; // Flag indicating whether the token launch has been completed.
    }

    struct UserParticipation {
        uint256 ethPaid; // Amount of ETH paid by the user.
        uint256 shareAmt; // Amount of shares the user has.
        bool refunded; // Whether the user has been refunded.
        bool reserved; // Whether the user has reserved a free claim.
        bool claimed; // Whether the user has claimed their tokens.
    }

    struct ShareCalculation {
        uint256 addShareAmt; // The additional shares allocated to the user based on their contribution.
        uint256 overfundedETH; // The amount of ETH considered as overfunded.
    }

    mapping(address dexRouter => bool support) public supportedDexRouters; // Mapping to check if a DEX router is supported.
    mapping(address token => PresaleCfg) public presaleCfgs; // Mapping of token addresses to presale configurations.
    mapping(address token => TokenomicsCfg) public tokenomicsCfgs; // Mapping of token addresses to token tokenomics configurations.
    mapping(address token => TokenLaunch) public tokenLaunches; // Mapping of token addresses to token launch details.
    mapping(address token => mapping(address user => UserParticipation)) public participation; // Mapping of token and user addresses to their participation details.
    mapping(address token => mapping(address user => address inviter)) public inviterOf; // Mapping of token and user addresses to their inviter's address.
    mapping(address token => mapping(address user => uint256 reward)) public inviteRewards; // Mapping of token and user addresses to their invite rewards.

    /**
     * @notice Constructor to create FairLauncher contract instance.
     * @param _weth Address of the WETH token.
     * @param _executor Address authorized to execute specific functions.
     * @param _spaceShare Address of the SpaceShare contract.
     */
    constructor(
        address _weth,
        address _executor,
        address _spaceShare
    ) {
        WETH = _weth;
        executor = _executor;
        spaceShare = ISpaceShare(_spaceShare);
    }

    /**
     * @notice Creates a new token launch campaign.
     * @param _tokenCfg Configuration of the token.
     * @param _presaleCfg Configuration for the presale.
     * @param _tokenomicsCfg Configuration for token tokenomics.
     * @param _tokenomicsCfg Configuration for token tokenomics.
     * @param _minBoughtOle Minimum amount of OLE tokens to receive when swapping ETH for OLE as part of the create fees process.
     */
    function newFairLaunch(
        TokenCfg calldata _tokenCfg,
        PresaleCfg calldata _presaleCfg,
        TokenomicsCfg calldata _tokenomicsCfg,
        uint256 _minBoughtOle
    ) external payable override {
        if (msg.value != feesCfg.createFees) revert InvalidETH();
        _validateConf(_tokenCfg, _presaleCfg, _tokenomicsCfg);

        // Create token contract
        address token = address(new D1MemeToken());
        D1MemeToken(token).initialize(_tokenCfg.totalSupply, _tokenCfg.name, _tokenCfg.symbol, gasOperator);

        // Send token to airdropper contract
        if (_tokenomicsCfg.amtForAirdrop > 0) {
            IERC20(token).safeApprove(address(airdropper), _tokenomicsCfg.amtForAirdrop);
            airdropper.createAirdrop(
                token,
                _tokenomicsCfg.amtForAirdrop,
                _presaleCfg.endTime,
                _presaleCfg.endTime + _tokenomicsCfg.airdropDuration
            );
        }

        // Create space
        spaceShare.createSpace();
        uint256 spaceIdx = spaceShare.spaceIdx();

        // Buy back ole with create fees
        uint256 createOLEFees;
        if (feesCfg.createFees > 0) {
            createOLEFees = _swapETHForOLE(feesCfg.createFees, _minBoughtOle, feesCfg.feeRecipient);
        }

        presaleCfgs[token] = _presaleCfg;
        tokenomicsCfgs[token] = _tokenomicsCfg;

        emit LaunchCreated(
            token,
            spaceIdx,
            _msgSender(),
            _tokenCfg.totalSupply,
            _tokenCfg.name,
            _tokenCfg.symbol,
            _presaleCfg,
            _tokenomicsCfg,
            createOLEFees
        );
    }

    /**
     * @notice Allows users to participate in the token presale by sending ETH during the presale period.
     * @dev This function validates the presale period and the user's contribution limits. It also handles
     * inviter relationships and calculates invite rewards.
     * @param _timestamp The timestamp of the presale participation.
     * @param _signature The signature for verifying participation.
     * @param _inviter The address of the inviter.
     * @param _token The address of the token.
     */
    function participate(
        uint256 _timestamp,
        bytes calldata _signature,
        address _inviter,
        address _token
    ) external payable override verifySig(_token, _inviter, _timestamp, LaunchSignLib.SIGN_FOR_PRESALE, _signature) {
        if (suspendCfg.all || suspendCfg.presale) revert Suspend();
        PresaleCfg memory presaleCfg = presaleCfgs[_token];
        if (block.timestamp < presaleCfg.startTime) revert NotStarted();
        if (block.timestamp > presaleCfg.endTime) revert Ended();

        uint256 amount = msg.value;

        ShareCalculation memory shareCalc = _checkAndCalShare(_token, presaleCfg, amount);
        participation[_token][_msgSender()].ethPaid += amount;
        participation[_token][_msgSender()].shareAmt += shareCalc.addShareAmt;

        TokenLaunch storage tokenLaunch = tokenLaunches[_token];

        address directInviter = _setInviter(_token, _inviter);
        (uint256 directFees, uint256 secondTierFees) = _calInviteFees(_token, amount - shareCalc.overfundedETH, directInviter);

        tokenLaunch.totalRaised += amount;
        tokenLaunch.totalShareAmt += shareCalc.addShareAmt;
        tokenLaunch.totalForInvite += directFees + secondTierFees;

        emit Participated(_token, _msgSender(), directInviter, amount, shareCalc.addShareAmt, directFees, secondTierFees);
    }

    /**
     * @notice Refunds presales if the launch threshold is not met after the presale period ends.
     * @param _token The address of the token.
     * @param _timestamp The timestamp of the refund request.
     * @param _signature The signature for verifying the refund request.
     */
    function refundForLaunchFail(
        uint256 _timestamp,
        bytes calldata _signature,
        address _token
    ) external override verifySig(_token, ZERO_ADDRESS, _timestamp, LaunchSignLib.SIGN_FOR_REFUND, _signature) {
        if (suspendCfg.all || suspendCfg.refund) revert Suspend();
        if (block.timestamp <= presaleCfgs[_token].endTime) revert NotEnded();
        if (tokenLaunches[_token].totalRaised >= presaleCfgs[_token].softCap) revert AlreadyLaunched();

        UserParticipation storage userPart = participation[_token][_msgSender()];
        if(userPart.ethPaid == 0) revert ZeroAmount();
        if(userPart.refunded) revert AlreadyRefund();

        userPart.refunded = true;
        tokenLaunches[_token].totalRefunded += userPart.ethPaid;
        (bool success, ) = payable(_msgSender()).call{value: userPart.ethPaid}("");
        if (!success) revert InvalidAddress();

        emit Refunded(_token, _msgSender(), userPart.ethPaid);
    }

    /**
     * @notice Reserves a free claim for the caller.
     * @param _token The address of the token.
     * @param _timestamp The timestamp of the reservation.
     * @param _signature The signature for verifying the reservation.
     */
    function reserveFreeClaim(
        uint256 _timestamp,
        bytes calldata _signature,
        address _token
    ) external override verifySig(_token, ZERO_ADDRESS, _timestamp, LaunchSignLib.SIGN_FOR_RESERVE, _signature) {
        if (suspendCfg.all || suspendCfg.reserve) revert Suspend();
        if (block.timestamp < presaleCfgs[_token].startTime) revert NotStarted();

        UserParticipation storage userPart = participation[_token][_msgSender()];
        if (userPart.reserved) revert AlreadyReserved();
        TokenomicsCfg memory tokenomicsCfg = tokenomicsCfgs[_token];
        if(tokenomicsCfg.amtForFreeClaim == 0) revert ZeroAmount();

        if (
            block.timestamp > presaleCfgs[_token].endTime ||
            tokenLaunches[_token].totalReserved + tokenomicsCfg.freeClaimPerUser > tokenomicsCfg.amtForFreeClaim
        ) revert Ended();

        tokenLaunches[_token].totalReserved += tokenomicsCfg.freeClaimPerUser;
        userPart.reserved = true;

        emit FreeClaimReserved(_token, _msgSender(), tokenomicsCfg.freeClaimPerUser);
    }

    /**
     * @notice Enables participants to claim their MEME from presale, free claim meme tokens, and any invite OLE rewards earned during the fair launch.
     * @param _token The address of the token.
     * @param _timestamp The timestamp of the claim request.
     * @param _signature The signature for verifying the claim request.
     */
    function claims(
        uint256 _timestamp,
        bytes calldata _signature,
        address _token
    ) external override verifySig(_token, ZERO_ADDRESS, _timestamp, LaunchSignLib.SIGN_FOR_CLAIM, _signature) {
        if (suspendCfg.all || suspendCfg.claim) revert Suspend();
        TokenLaunch memory tokenLaunch = tokenLaunches[_token];
        if (!tokenLaunch.isLaunched) revert NotLaunched();

        UserParticipation storage userPart = participation[_token][_msgSender()];
        if (userPart.claimed) revert AlreadyClaimed();
        userPart.claimed = true;

        ClaimableAmt memory claimable = _calculateClaims(userPart, _token);
        _transferClaims(_token, tokenLaunch.oleAddrForReward, claimable);

        emit Claimed(_token, _msgSender(), claimable.presaleClaim, claimable.freeClaim, claimable.oleClaim, claimable.overfundedRefund);
    }

    /**
     * @notice Finalizes the token launch, enabling token claims and providing liquidity.
     * @param _token The address of the token.
     * @param _dexRouter Address of the DEX router.
     * @param _minBoughtOle Minimum amount of OLE tokens to receive when swapping ETH for OLE as part of the invite reward process.
     */
    function launch(
        address _token,
        address _dexRouter,
        uint256 _minBoughtOle
    ) external override {
        if (_msgSender() != executor) revert OnlyExecutor();
        PresaleCfg memory presaleCfg = presaleCfgs[_token];
        if (block.timestamp <= presaleCfg.endTime) revert NotEnded();

        TokenLaunch storage tokenLaunch = tokenLaunches[_token];
        if (tokenLaunch.totalRaised < presaleCfg.softCap) revert NotEnough();
        if (tokenLaunch.isLaunched) revert AlreadyLaunched();
        if (!supportedDexRouters[_dexRouter]) revert UnsupportedDex();

        uint256 ethForLaunch = tokenLaunch.totalRaised > presaleCfg.hardCap ? presaleCfg.hardCap : tokenLaunch.totalRaised;
        uint256 ethForProtocolFee = ethForLaunch * feesCfg.launchProtocolFees / PERCENT_DIVISOR;
        uint256 ethForLp = ethForLaunch - ethForProtocolFee - tokenLaunch.totalForInvite;
        tokenLaunch.isLaunched = true;

        // Add and burn liquidity
        uint256 liquidity = _initLiquidity(_token, _dexRouter, tokenomicsCfgs[_token].amtForLP, ethForLp);
        address lpTokenAddr = IUniV2ClassFactory(IUniV2ClassRouter(_dexRouter).factory()).getPair(_token, WETH);

        // Collect protocol fees
        if (ethForProtocolFee > 0) {
            (bool success, ) = feesCfg.feeRecipient.call{value: ethForProtocolFee}("");
            if (!success) revert InvalidAddress();
        }

        // Swap invite ETH reward to OLE
        if (tokenLaunch.totalForInvite > 0) {
            tokenLaunch.oleRewardForInvite = _swapETHForOLE(tokenLaunch.totalForInvite, _minBoughtOle, address(this));
            tokenLaunch.oleAddrForReward = oleSwapCfg.ole;
        }

        emit Launched(_token, lpTokenAddr, liquidity, tokenomicsCfgs[_token].amtForLP, ethForLp, ethForProtocolFee, tokenLaunch.oleRewardForInvite);
    }

    /**
     * @notice Sets the configuration for fees.
     * @param _cfg The configuration for fees.
     */
    function setFeesCfg(FeesCfg calldata _cfg) external onlyOwner {
        if (_cfg.feeRecipient == ZERO_ADDRESS) revert ZeroAddress();
        if (_cfg.directInviteFees + _cfg.secondTierInviteFees + _cfg.launchProtocolFees >= PERCENT_DIVISOR) revert InvalidParam();
        feesCfg = _cfg;
    }

    /**
     * @notice Sets the buyback OLE configuration.
     * @param _cfg The configuration for OLE token swaps.
     */
    function setOLESwapCfg(OLESwapCfg calldata _cfg) external onlyOwner {
        if (_cfg.ole == ZERO_ADDRESS || _cfg.dexRouter == ZERO_ADDRESS) revert ZeroAddress();
        oleSwapCfg = _cfg;
    }

    /**
     * @notice Sets the signature configuration.
     * @param _cfg The configuration for signatures.
     */
    function setSignConf(SignCfg calldata _cfg) external override onlyOwner {
        if (_cfg.issuerAddress == ZERO_ADDRESS || _cfg.validDuration == 0) revert InvalidParam();
        signCfg = _cfg;
    }

    /**
     * @notice Sets the configuration for suspending various operations.
     * @param _cfg The configuration for suspensions.
     */
    function setSuspendCfg(SuspendCfg calldata _cfg) external override onlyOwner {
        suspendCfg = _cfg;
    }

    /**
     * @notice Sets the gas operator address.
     * @param _gasOperator Address for gas compensation.
     */
    function setGasOperator(address _gasOperator) external override onlyOwner {
        if (_gasOperator == ZERO_ADDRESS) revert ZeroAddress();
        gasOperator = _gasOperator;
    }

    /**
     * @notice Sets the executor address.
     * @param _executor Address authorized to execute launch and airdrop operations.
     */
    function setExecutor(address _executor) external override onlyOwner {
        if (_executor == ZERO_ADDRESS) revert ZeroAddress();
        executor = _executor;
    }

    /**
     * @notice Sets the address of the SpaceShare contract to create space.
     * @param _spaceShare The address of the new SpaceShare contract.
     */
    function setSpaceShare(address _spaceShare) external override onlyOwner {
        if (_spaceShare == ZERO_ADDRESS) revert ZeroAddress();
        spaceShare = ISpaceShare(_spaceShare);
    }

    /**
     * @notice Sets the address of the Airdropper contract.
     * @param _airdropper The address of the Airdropper contract.
     */
    function setAirdropper(address _airdropper) external onlyOwner {
        if (_airdropper == ZERO_ADDRESS) revert ZeroAddress();
        airdropper = IAirdropper(_airdropper);
    }

    /**
     * @notice Sets whether a DEX router is supported.
     * @param _router Address of the DEX router.
     * @param _support Boolean indicating whether the router is supported.
     */
    function setSupportedDexRouter(address _router, bool _support) external override onlyOwner {
        supportedDexRouters[_router] = _support;
    }

    /**
     * @notice View function to get claimable amounts for a user.
     * @param _token The address of the token.
     * @param _user The address of the user.
     * @return claimable The claimable amounts struct.
     */
    function getClaimable(address _token, address _user) external view override returns (ClaimableAmt memory claimable) {
        UserParticipation storage userPart = participation[_token][_user];
        return _calculateClaims(userPart, _token);
    }

    /**
     * @notice Checks if the token launch is complete.
     * @return True if the token launch is complete, false otherwise.
     */
    function launched(address _token) external override view returns(bool) {
        return tokenLaunches[_token].isLaunched;
    }

    /**
     * @dev Validates the configuration of presale and token tokenomics.
     * @param _tokenCfg Configuration for the token.
     * @param _presaleCfg Configuration for the presale.
     * @param _tokenomicsCfg Configuration for token tokenomics.
     */
    function _validateConf(
        TokenCfg calldata _tokenCfg,
        PresaleCfg calldata _presaleCfg,
        TokenomicsCfg calldata _tokenomicsCfg
    ) internal view {
        if (_tokenCfg.totalSupply == 0 || bytes(_tokenCfg.name).length == 0 || bytes(_tokenCfg.symbol).length == 0) revert InvalidTokenCfg();

        // Validate presale time config
        if (_presaleCfg.startTime < block.timestamp || _presaleCfg.startTime >= _presaleCfg.endTime) revert InvalidTimeCfg();

        // Validate presale contribution config
        if (
            _presaleCfg.personalCapMin < MIN_PER_PARTICIPATION_ETH ||
            _presaleCfg.personalCapMin > _presaleCfg.personalCapMax ||
            _presaleCfg.personalCapMax > _presaleCfg.hardCap ||
            _presaleCfg.overfundedDiscount == 0 ||
            _presaleCfg.overfundedDiscount >= PERCENT_DIVISOR
        ) {
            revert InvalidContributionCfg();
        }

        // Validate presale launch config
        if (_presaleCfg.softCap < MIN_PER_PARTICIPATION_ETH || _presaleCfg.softCap > _presaleCfg.hardCap) revert InvalidLaunchCfg();

        // Check token tokenomics
        uint256 totalTokenomicsAmt = _tokenomicsCfg.amtForPresale + _tokenomicsCfg.amtForLP + _tokenomicsCfg.amtForAirdrop + _tokenomicsCfg.amtForFreeClaim;
        if (
            totalTokenomicsAmt != _tokenCfg.totalSupply ||
            _tokenomicsCfg.amtForPresale == 0 ||
            _tokenomicsCfg.amtForLP == 0 ||
            (_tokenomicsCfg.amtForAirdrop > 0 && _tokenomicsCfg.airdropDuration == 0) ||
            (_tokenomicsCfg.amtForFreeClaim > 0 && (_tokenomicsCfg.freeClaimPerUser == 0 || _tokenomicsCfg.freeClaimPerUser > _tokenomicsCfg.amtForFreeClaim))
        ) {
            revert InvalidTokenomicsCfg();
        }

    }

    /**
     * @dev Calculates the additional shares a user can obtain based on their ETH contribution.
     * If the total raised ETH exceeds the maximum launch limit, the function applies an overfunded discount to the excess contribution.
     */
    function _checkAndCalShare(
        address _token,
        PresaleCfg memory presaleCfg,
        uint256 ethPaid
    ) internal view returns (ShareCalculation memory) {
        uint256 newETHPaid = ethPaid + participation[_token][_msgSender()].ethPaid;
        if (newETHPaid < presaleCfg.personalCapMin) revert NotEnough();
        if (newETHPaid > presaleCfg.personalCapMax) revert ExceedsMaximum();

        uint256 newTotalRaised = tokenLaunches[_token].totalRaised + ethPaid;
        if (newTotalRaised > presaleCfg.hardCap) {
            // Calculate additional shares considering overfunded
            uint256 totalOverfunded = newTotalRaised - presaleCfg.hardCap;
            uint256 overfundedETH = ethPaid > totalOverfunded ? totalOverfunded : ethPaid;
            uint256 addShareAmt = (ethPaid - overfundedETH) + (overfundedETH * presaleCfg.overfundedDiscount / PERCENT_DIVISOR);
            return ShareCalculation(addShareAmt, overfundedETH);
        } else {
            return ShareCalculation(ethPaid, 0);
        }
    }

    /**
     * @dev Sets the inviter for the caller if not already set.
     * @return directInviter The address of the direct inviter.
     */
    function _setInviter(address _token, address _inviter) internal returns (address) {
        address existedInviter = inviterOf[_token][_msgSender()];
        if (existedInviter == ZERO_ADDRESS && _inviter != ZERO_ADDRESS) {
            if (_inviter == _msgSender()) revert InvalidInviter();
            inviterOf[_token][_msgSender()] = _inviter;
            existedInviter = _inviter;
        }
        return existedInviter;
    }

    function _calInviteFees(address _token, uint256 amount, address directInviter) internal returns (uint256 directFees, uint256 secondTierFees) {
        if (directInviter != ZERO_ADDRESS) {
            directFees = amount * feesCfg.directInviteFees / PERCENT_DIVISOR;
            inviteRewards[_token][directInviter] += directFees;

            address secondTierInviter = inviterOf[_token][directInviter];
            if (secondTierInviter != ZERO_ADDRESS) {
                secondTierFees = amount * feesCfg.secondTierInviteFees / PERCENT_DIVISOR;
                inviteRewards[_token][secondTierInviter] += secondTierFees;
            }
        }
        return (directFees, secondTierFees);
    }

    function _calculateClaims(UserParticipation memory userPart, address _token) internal view returns (ClaimableAmt memory) {
        TokenLaunch memory tokenLaunch = tokenLaunches[_token];
        return ClaimableAmt({
            presaleClaim: _calPresaleClaim(userPart.shareAmt, tokenomicsCfgs[_token].amtForPresale, tokenLaunch.totalShareAmt),
            freeClaim: _calFreeClaim(userPart.reserved, tokenomicsCfgs[_token].freeClaimPerUser),
            oleClaim: _calOLEClaim(inviteRewards[_token][_msgSender()], tokenLaunch.oleRewardForInvite, tokenLaunch.totalForInvite),
            overfundedRefund: _calOverfundedRefund(userPart.ethPaid, tokenLaunch.totalRaised, presaleCfgs[_token].hardCap)
        });
    }

    function _calPresaleClaim(uint256 shareAmt, uint256 amtForPresale, uint256 totalShareAmt) internal pure returns (uint256) {
        if (shareAmt > 0 && totalShareAmt > 0) {
            return shareAmt * amtForPresale / totalShareAmt;
        }
        return 0;
    }

    function _calFreeClaim(bool reserved, uint256 freeClaimPerUser) internal pure returns (uint256) {
        if (reserved) {
            return freeClaimPerUser;
        }
        return 0;
    }

    function _calOLEClaim(uint256 inviteReward, uint256 totalOLESwapped, uint256 totalInviteReward) internal pure returns (uint256) {
        if (inviteReward > 0 && totalInviteReward > 0) {
            return inviteReward * totalOLESwapped / totalInviteReward;
        }
        return 0;
    }

    /**
     * @dev Calculates the refund for overfunded ETH based on the user's contribution proportion.
     * @return The calculated refund amount for the user.
     */
    function _calOverfundedRefund(uint256 ethPaid, uint256 totalRaised, uint256 hardCap) internal pure returns (uint256) {
        if (totalRaised > hardCap) {
            return ethPaid * (totalRaised - hardCap) / totalRaised;
        }
        return 0;
    }

    function _transferClaims(address _token, address oleAddr, ClaimableAmt memory claimable) internal {
        if (claimable.presaleClaim + claimable.freeClaim + claimable.oleClaim + claimable.overfundedRefund == 0) revert ZeroAmount();

        if (claimable.oleClaim > 0) {
            IERC20(oleAddr).transferOut(_msgSender(), claimable.oleClaim);
        }
        if (claimable.presaleClaim + claimable.freeClaim > 0) {
            IERC20(_token).transferOut(_msgSender(), claimable.presaleClaim + claimable.freeClaim);
        }
        if (claimable.overfundedRefund > 0) {
            (bool success, ) = payable(_msgSender()).call{value: claimable.overfundedRefund}("");
            if (!success) revert InvalidAddress();
        }
    }

    /**
     * @dev Initializes liquidity on a DEX.
     * @param _token Address of the token.
     * @param _dexRouter Address of the DEX router.
     * @param _tokenAmount Amount of tokens to add to the liquidity pool.
     * @param _ethAmount Amount of ETH to add to the liquidity pool.
     * @return liquidity The amount of liquidity tokens received.
     */
    function _initLiquidity(address _token, address _dexRouter, uint256 _tokenAmount, uint256 _ethAmount) internal returns (uint256 liquidity) {
        IERC20(_token).safeApprove(_dexRouter, _tokenAmount);
        (, , liquidity) = IUniV2ClassRouter(_dexRouter).addLiquidityETH{value: _ethAmount}(
            _token,
            _tokenAmount,
            _tokenAmount, // amountTokenMin: minimum amount of tokens to add (slippage tolerance)
            _ethAmount, // amountETHMin: minimum amount of ETH to add (slippage tolerance)
            ZERO_ADDRESS, // to: the address that receives the liquidity tokens
            block.timestamp // deadline: timestamp after which the transaction will revert
        );
    }

    /**
     * @dev Swaps ETH for OLE tokens.
     * @param ethAmount Amount of ETH to swap.
     * @param to Address to receive the OLE tokens.
     * @return boughtOleAmount Amount of OLE tokens bought.
     */
    function _swapETHForOLE(uint256 ethAmount, uint256 minBoughtOle, address to) internal returns (uint256 boughtOleAmount) {
        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = oleSwapCfg.ole;
        uint256[] memory amounts = IUniV2ClassRouter(oleSwapCfg.dexRouter).swapExactETHForTokens{value: ethAmount}(
            minBoughtOle,
            path,
            to,
            block.timestamp
        );
        boughtOleAmount = amounts[1];
    }

    /**
     * @dev Modifier to verify a signature.
     * @param token The address of the token.
     * @param inviter The address of the inviter.
     * @param timestamp The timestamp of the signature.
     * @param signType The type of the signature.
     * @param signature The signature to verify.
     */
    modifier verifySig(address token, address inviter, uint256 timestamp, uint256 signType, bytes calldata signature) {
        LaunchSignLib.SignedData memory signedData = LaunchSignLib.SignedData(token, _msgSender(), inviter, timestamp, signType);
        if (!signedData.verify(signature, signCfg.issuerAddress, signCfg.validDuration)) revert InvalidSignature();
        _;
    }

}
