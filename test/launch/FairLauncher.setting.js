const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FairLauncher Set Functions", function () {
    let owner, addr1, addr2, add1Str, add2Str;
    let FairLauncher, fairLauncher;
    let FeesCfg, OLESwapCfg, SignCfg, SuspendCfg;
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    beforeEach(async function () {
        [owner, addr1, addr2] = await ethers.getSigners();
        add1Str = await addr1.getAddress();
        add2Str = await addr2.getAddress();

        FairLauncher = await ethers.getContractFactory("FairLauncher");
        fairLauncher = await FairLauncher.deploy(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS);

        // Initialize configuration objects
        FeesCfg = {
            feeRecipient: add1Str,
            createFees: ethers.parseEther("0.1"),
            directInviteFees: 200,
            secondTierInviteFees: 100,
            launchProtocolFees: 500
        };

        OLESwapCfg = {
            ole: add1Str,
            dexRouter: add1Str
        };

        SignCfg = {
            issuerAddress: add1Str,
            validDuration: 3600
        };

        SuspendCfg = {
            all: false,
            presale: false,
            claim: false,
            refund: false,
            reserve: false
        };
    });

    it("should set FeesCfg", async function () {
        await fairLauncher.setFeesCfg(FeesCfg);
        const config = await fairLauncher.feesCfg();
        expect(config.feeRecipient).to.equal(FeesCfg.feeRecipient);
        expect(config.createFees).to.equal(FeesCfg.createFees);
        expect(config.directInviteFees).to.equal(FeesCfg.directInviteFees);
        expect(config.secondTierInviteFees).to.equal(FeesCfg.secondTierInviteFees);
        expect(config.launchProtocolFees).to.equal(FeesCfg.launchProtocolFees);
    });

    it("should revert if set FeesCfg with zero address", async function () {
        const invalidFeesCfg = { ...FeesCfg, feeRecipient: ZERO_ADDRESS };
        await expect(fairLauncher.setFeesCfg(invalidFeesCfg)).to.be.revertedWithCustomError(fairLauncher, "ZeroAddress");
    });

    it("should set OLESwapCfg", async function () {
        await fairLauncher.setOLESwapCfg(OLESwapCfg);
        const config = await fairLauncher.oleSwapCfg();
        expect(config.ole).to.equal(OLESwapCfg.ole);
        expect(config.dexRouter).to.equal(OLESwapCfg.dexRouter);
    });

    it("should revert if set OLESwapCfg with zero address", async function () {
        const invalidOLESwapCfg = { ...OLESwapCfg, ole: ZERO_ADDRESS };
        await expect(fairLauncher.setOLESwapCfg(invalidOLESwapCfg)).to.be.revertedWithCustomError(fairLauncher, "ZeroAddress");
    });

    it("should set SignCfg", async function () {
        await fairLauncher.setSignConf(SignCfg);
        const config = await fairLauncher.signCfg();
        expect(config.issuerAddress).to.equal(SignCfg.issuerAddress);
        expect(config.validDuration).to.equal(SignCfg.validDuration);
    });

    it("should revert if set SignCfg with zero address", async function () {
        const invalidSignCfg = { ...SignCfg, issuerAddress: ZERO_ADDRESS };
        await expect(fairLauncher.setSignConf(invalidSignCfg)).to.be.revertedWithCustomError(fairLauncher, "InvalidParam");
    });

    it("should set SuspendCfg", async function () {
        await fairLauncher.setSuspendCfg(SuspendCfg);
        const config = await fairLauncher.suspendCfg();
        expect(config.all).to.equal(SuspendCfg.all);
        expect(config.presale).to.equal(SuspendCfg.presale);
        expect(config.claim).to.equal(SuspendCfg.claim);
        expect(config.refund).to.equal(SuspendCfg.refund);
        expect(config.reserve).to.equal(SuspendCfg.reserve);
    });

    it("should set gas operator", async function () {
        await fairLauncher.setGasOperator(add1Str);
        const gasOperator = await fairLauncher.gasOperator();
        expect(gasOperator).to.equal(add1Str);
    });

    it("should revert if set gas operator with zero address", async function () {
        await expect(fairLauncher.setGasOperator(ZERO_ADDRESS)).to.be.revertedWithCustomError(fairLauncher, "ZeroAddress");
    });

    it("should set executor", async function () {
        await fairLauncher.setExecutor(add1Str);
        const executor = await fairLauncher.executor();
        expect(executor).to.equal(add1Str);
    });

    it("should revert if set executor with zero address", async function () {
        await expect(fairLauncher.setExecutor(ZERO_ADDRESS)).to.be.revertedWithCustomError(fairLauncher, "ZeroAddress");
    });

    it("should set SpaceShare address", async function () {
        await fairLauncher.setSpaceShare(add1Str);
        const spaceShare = await fairLauncher.spaceShare();
        expect(spaceShare).to.equal(add1Str);
    });

    it("should revert if set SpaceShare with zero address", async function () {
        await expect(fairLauncher.setSpaceShare(ZERO_ADDRESS)).to.be.revertedWithCustomError(fairLauncher, "ZeroAddress");
    });

    it("should set Airdropper address", async function () {
        await fairLauncher.setAirdropper(add1Str);
        const airdropper = await fairLauncher.airdropper();
        expect(airdropper).to.equal(add1Str);
    });

    it("should revert if set Airdropper with zero address", async function () {
        await expect(fairLauncher.setAirdropper(ZERO_ADDRESS)).to.be.revertedWithCustomError(fairLauncher, "ZeroAddress");
    });

    it("should set supported DEX router", async function () {
        await fairLauncher.setSupportedDexRouter(add1Str, true);
        const supported = await fairLauncher.supportedDexRouters(add1Str);
        expect(supported).to.equal(true);
    });

    it("should set unsupported DEX router", async function () {
        await fairLauncher.setSupportedDexRouter(add1Str, false);
        const supported = await fairLauncher.supportedDexRouters(add1Str);
        expect(supported).to.equal(false);
    });

    it("should revert setFeesCfg if not owner", async function () {
        await expect(fairLauncher.connect(addr1).setFeesCfg(FeesCfg)).to.be.revertedWithCustomError(fairLauncher, "OwnableUnauthorizedAccount");
    });

    it("should revert setOLESwapCfg if not owner", async function () {
        await expect(fairLauncher.connect(addr1).setOLESwapCfg(OLESwapCfg)).to.be.revertedWithCustomError(fairLauncher, "OwnableUnauthorizedAccount");
    });

    it("should revert setSignConf if not owner", async function () {
        await expect(fairLauncher.connect(addr1).setSignConf(SignCfg)).to.be.revertedWithCustomError(fairLauncher, "OwnableUnauthorizedAccount");
    });

    it("should revert setSuspendCfg if not owner", async function () {
        await expect(fairLauncher.connect(addr1).setSuspendCfg(SuspendCfg)).to.be.revertedWithCustomError(fairLauncher, "OwnableUnauthorizedAccount");
    });

    it("should revert setGasOperator if not owner", async function () {
        await expect(fairLauncher.connect(addr1).setGasOperator(add1Str)).to.be.revertedWithCustomError(fairLauncher, "OwnableUnauthorizedAccount");
    });

    it("should revert setExecutor if not owner", async function () {
        await expect(fairLauncher.connect(addr1).setExecutor(add1Str)).to.be.revertedWithCustomError(fairLauncher, "OwnableUnauthorizedAccount");
    });

    it("should revert setSpaceShare if not owner", async function () {
        await expect(fairLauncher.connect(addr1).setSpaceShare(add1Str)).to.be.revertedWithCustomError(fairLauncher, "OwnableUnauthorizedAccount");
    });

    it("should revert setAirdropper if not owner", async function () {
        await expect(fairLauncher.connect(addr1).setAirdropper(add1Str)).to.be.revertedWithCustomError(fairLauncher, "OwnableUnauthorizedAccount");
    });

    it("should revert setSupportedDexRouter if not owner", async function () {
        await expect(fairLauncher.connect(addr1).setSupportedDexRouter(add1Str, true)).to.be.revertedWithCustomError(fairLauncher, "OwnableUnauthorizedAccount");
    });
});
