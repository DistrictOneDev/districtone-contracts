const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const {getSign, now, latestBlockTime} = require("./LaunchUtil");

describe("FairLauncher Logic Functions", function () {
    let fairLauncher, spaceShare, airdropper, weth, uniV2Factory, uniV2Router, feesCfg, oleSwapCfg, ole, signConf;
    let owner, executor, user1, user2, inviter, signer, lpRecipient;
    let ownerStr, executorStr, user1Str, user2Str, inviterStr, signerStr, lpRecipientStr;

    const initialSupply = ethers.parseUnits("10000000000", 18);
    const createFees = ethers.parseUnits("1", "ether");
    const oneEth = ethers.parseUnits("1", "ether");
    const hundredEth = ethers.parseUnits("100", "ether");
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    let tokenomicsCfg;

    beforeEach(async function () {
        [owner, executor, user1, user2, inviter, signer, lpRecipient] = await ethers.getSigners();
        ownerStr = String(await owner.getAddress());
        executorStr = String(await executor.getAddress());
        user1Str = String(await user1.getAddress());
        user2Str = String(await user2.getAddress());
        inviterStr = String(await inviter.getAddress());
        signerStr = String(await signer.getAddress());
        lpRecipientStr = String(await lpRecipient.getAddress());

        tokenomicsCfg = {
            amtForPresale: ethers.parseUnits("3000000000", 18),
            amtForLP: ethers.parseUnits("4000000000", 18),
            amtForAirdrop: ethers.parseUnits("2500000000", 18),
            amtForFreeClaim: ethers.parseUnits("500000000", 18),
            freeClaimPerUser: ethers.parseUnits("10000000", 18),
            airdropDuration: 1000,
            lpRecipient: lpRecipientStr
        };
        
        const WETH = await ethers.getContractFactory("MockWETH");
        weth = await WETH.deploy();

        const MockSpaceShare = await ethers.getContractFactory("MockSpaceShare");
        spaceShare = await MockSpaceShare.deploy(weth.getAddress(), 1, 0);

        const FairLauncher = await ethers.getContractFactory("FairLauncher");
        fairLauncher = await FairLauncher.deploy(
            weth.getAddress(),
            executorStr,
            spaceShare.getAddress()
        );

        const Airdropper = await ethers.getContractFactory("Airdropper");
        airdropper = await Airdropper.deploy(fairLauncher.getAddress(), executorStr);
        await fairLauncher.setAirdropper(airdropper.getAddress());

        feesCfg = {
            feeRecipient: ownerStr,
            createFees: createFees,
            directInviteFees: 200,
            secondTierInviteFees: 100,
            launchProtocolFees: 500
        };

        const OLE = await ethers.getContractFactory("MockToken");
        ole = await OLE.deploy("OLE", "OLE", initialSupply);

        const MockUniV2Factory = await ethers.getContractFactory("MockUniV2Factory");
        uniV2Factory = await MockUniV2Factory.deploy();

        const MockUniV2Router = await ethers.getContractFactory("MockUniV2Router");
        uniV2Router = await MockUniV2Router.deploy();

        await uniV2Router.setFactory(uniV2Factory.getAddress());
        await ole.mint(uniV2Router.getAddress(), initialSupply);


        oleSwapCfg = {
            ole: ole.getAddress(),
            dexRouter: uniV2Router.getAddress()
        }

        signConf = {
            issuerAddress : signerStr,
            validDuration : 10000
        }
    });

    const presaleCfg = {
        startTime: now() + 1000,
        endTime: now() + 2000,
        personalCapMin: ethers.parseUnits("0.1", "ether"),
        personalCapMax: hundredEth,
        softCap: oneEth,
        hardCap: hundredEth,
        overfundedDiscount: 5000 // 50%
    };

    const tokenCfg = {
        totalSupply: initialSupply,
        name: "D1 Meme Token",
        symbol: "D1MT"
    };

    const launchCreatedEventId = ethers.id("LaunchCreated(address,uint256,address,uint256,string,string,(uint256,uint256,uint256,uint256,uint256,uint256,uint256),(uint256,uint256,uint256,uint256,uint256,uint256,address),uint256)");

    describe("newFairLaunch", function () {
        it("should create a new token launch campaign without createFees", async function () {
            let blockTime = await latestBlockTime();

            const tx = await fairLauncher.newFairLaunch(tokenCfg, {...presaleCfg, startTime: blockTime + 1000, endTime: blockTime + 2000}, tokenomicsCfg, 0, { value: 0 });
            const launchCreatedEvent = (await tx.wait()).logs.find(event => event.topics[0] === launchCreatedEventId);

            const token = launchCreatedEvent.args[0];
            const erc20 = await ethers.getContractAt("D1MemeToken", token);
            expect(await erc20.name()).to.equal(tokenCfg.name);
            expect(await erc20.symbol()).to.equal(tokenCfg.symbol);
            expect(await erc20.balanceOf(fairLauncher.getAddress())).to.equal(ethers.parseUnits("7500000000", 18));
            expect(await erc20.balanceOf(airdropper.getAddress())).to.equal(ethers.parseUnits("2500000000", 18));

            expect(launchCreatedEvent.args[1]).to.equal(1);
            expect(launchCreatedEvent.args[2]).to.equal(owner);
            expect(launchCreatedEvent.args[8]).to.equal(0);
            expect(launchCreatedEvent.args[7].lpRecipient).to.equal(lpRecipientStr);
            expect((await fairLauncher.tokenomicsCfgs(token)).lpRecipient).to.equal(lpRecipientStr);
        });

        it("should create a new token launch campaign with createFees", async function () {
            await fairLauncher.setFeesCfg(feesCfg);
            await fairLauncher.setOLESwapCfg(oleSwapCfg);

            let blockTime = await latestBlockTime();

            await expect(fairLauncher.newFairLaunch(tokenCfg, {...presaleCfg, startTime: blockTime + 1000, endTime: blockTime + 2000}, tokenomicsCfg, 10000, { value: createFees }))
                .to.emit(fairLauncher, "LaunchCreated")
                .withArgs(anyValue, 1, ownerStr, tokenCfg.totalSupply, tokenCfg.name, tokenCfg.symbol, anyValue, anyValue, 10000);
        });

        it("should revert with InvalidETH if incorrect ETH sent", async function () {
            await expect(fairLauncher.newFairLaunch(tokenCfg, presaleCfg, tokenomicsCfg, 0, { value: ethers.parseUnits("0.5", "ether") }))
                .to.be.revertedWithCustomError(fairLauncher, 'InvalidETH');
        });

        it("should revert with InvalidTokenCfg for incorrect token config", async function () {
            let invalidTokenCfg = { ...tokenCfg, totalSupply: 0};
            await expect(fairLauncher.newFairLaunch(invalidTokenCfg, presaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidTokenCfg");

            invalidTokenCfg = { ...tokenCfg, name: ""};
            await expect(fairLauncher.newFairLaunch(invalidTokenCfg, presaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidTokenCfg");

            invalidTokenCfg = { ...tokenCfg, symbol: ""};
            await expect(fairLauncher.newFairLaunch(invalidTokenCfg, presaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidTokenCfg");
        });

        it("should revert with InvalidTimeCfg for incorrect presale time config", async function () {
            let invalidPresaleCfg = { ...presaleCfg, startTime: now() - 1000 };
            await expect(fairLauncher.newFairLaunch(tokenCfg, invalidPresaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidTimeCfg");

            invalidPresaleCfg = { ...presaleCfg, startTime: now() + 2000 };
            await expect(fairLauncher.newFairLaunch(tokenCfg, invalidPresaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidTimeCfg");
        });

        it("should revert with InvalidContributionCfg for incorrect presale contribution config", async function () {
            let blockTime = await latestBlockTime();
            let basePresaleCfg = {...presaleCfg, startTime: blockTime + 1000, endTime: blockTime + 2000}

            let invalidPresaleCfg = { ...basePresaleCfg, personalCapMin: ethers.parseUnits("10", "ether"), personalCapMax: oneEth};
            await expect(fairLauncher.newFairLaunch(tokenCfg, invalidPresaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidContributionCfg");

            invalidPresaleCfg = { ...basePresaleCfg, personalCapMin: ethers.parseUnits("0.00001", "ether")};
            await expect(fairLauncher.newFairLaunch(tokenCfg, invalidPresaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidContributionCfg");

            invalidPresaleCfg = { ...basePresaleCfg, personalCapMax: ethers.parseUnits("0.2", "ether"), hardCap: ethers.parseUnits("0.1", "ether")};
            await expect(fairLauncher.newFairLaunch(tokenCfg, invalidPresaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidContributionCfg");

            invalidPresaleCfg = { ...basePresaleCfg, overfundedDiscount: 0 };
            await expect(fairLauncher.newFairLaunch(tokenCfg, invalidPresaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidContributionCfg");

            invalidPresaleCfg = { ...basePresaleCfg, overfundedDiscount: 10000 };
            await expect(fairLauncher.newFairLaunch(tokenCfg, invalidPresaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidContributionCfg");
        });

        it("should revert with InvalidLaunchCfg for incorrect launch config", async function () {
            let blockTime = await latestBlockTime();
            let basePresaleCfg = {...presaleCfg, startTime: blockTime + 1000, endTime: blockTime + 2000}

            let invalidPresaleCfg = { ...basePresaleCfg, softCap: ethers.parseUnits("0.00001", "ether")};
            await expect(fairLauncher.newFairLaunch(tokenCfg, invalidPresaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidLaunchCfg");

            invalidPresaleCfg = { ...basePresaleCfg, softCap: ethers.parseUnits("101", "ether") };
            await expect(fairLauncher.newFairLaunch(tokenCfg, invalidPresaleCfg, tokenomicsCfg, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidLaunchCfg");
        });

        it("should revert with InvalidTokenomicsCfg for incorrect tokenomics config", async function () {
            let blockTime = await latestBlockTime();
            let basePresaleCfg = {...presaleCfg, startTime: blockTime + 1000, endTime: blockTime + 2000}

            let invalidTokenomicsCfgs = { ...tokenomicsCfg, amtForPresale: ethers.parseUnits("3000000001", 18) };
            await expect(fairLauncher.newFairLaunch(tokenCfg, basePresaleCfg, invalidTokenomicsCfgs, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidTokenomicsCfg");

            invalidTokenomicsCfgs = { ...tokenomicsCfg, amtForLP: 0 };
            await expect(fairLauncher.newFairLaunch(tokenCfg, basePresaleCfg, invalidTokenomicsCfgs, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidTokenomicsCfg");

            let validTokenomicsCfgs = { ...tokenomicsCfg, amtForAirdrop: 0, amtForFreeClaim:  ethers.parseUnits("3000000000", 18)};
            await fairLauncher.newFairLaunch(tokenCfg, basePresaleCfg, validTokenomicsCfgs, 0, { value: 0 });

            invalidTokenomicsCfgs = { ...tokenomicsCfg, airdropDuration: 0};
            await expect(fairLauncher.newFairLaunch(tokenCfg, basePresaleCfg, invalidTokenomicsCfgs, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidTokenomicsCfg");

            validTokenomicsCfgs = { ...tokenomicsCfg, amtForFreeClaim: 0, amtForAirdrop:  ethers.parseUnits("3000000000", 18)};
            await fairLauncher.newFairLaunch(tokenCfg, basePresaleCfg, validTokenomicsCfgs, 0, { value: 0 });

            invalidTokenomicsCfgs = { ...tokenomicsCfg, freeClaimPerUser: ethers.parseUnits("500000001", 18) };
            await expect(fairLauncher.newFairLaunch(tokenCfg, basePresaleCfg, invalidTokenomicsCfgs, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidTokenomicsCfg");

            invalidTokenomicsCfgs = { ...tokenomicsCfg, freeClaimPerUser: 0 };
            await expect(fairLauncher.newFairLaunch(tokenCfg, basePresaleCfg, invalidTokenomicsCfgs, 0, { value: 0 }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidTokenomicsCfg");
        });

    });

    describe("participate", function () {
        let token;
        let signature;
        let timestamp;

        beforeEach(async function () {
            let blockTime = await latestBlockTime();
            const tx = await fairLauncher.newFairLaunch(tokenCfg, {...presaleCfg, startTime: blockTime + 1000, endTime: blockTime + 2000}, tokenomicsCfg, 0, { value: 0 });
            const launchCreatedEvent = (await tx.wait()).logs.find(event => event.topics[0] === launchCreatedEventId);
            token = launchCreatedEvent.args[0];

            await fairLauncher.setSignConf(signConf);
            await fairLauncher.setFeesCfg(feesCfg);

            const sign = await getSign(signer, token, user1Str, inviterStr, 0);
            signature = sign[0];
            timestamp = sign[1];
        });

        it("should succeed in the presale without overfunding", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            await expect(fairLauncher.connect(user1).participate(timestamp, signature, inviterStr, token, { value: oneEth }))
                .to.emit(fairLauncher, "Participated")
                .withArgs(token, user1Str, inviterStr, oneEth, oneEth, ethers.parseUnits("0.02", "ether"), 0);

            const participation = await fairLauncher.participation(token, user1Str);
            expect(participation.ethPaid).to.equal(oneEth);
            expect(participation.shareAmt).to.equal(oneEth);
            expect(participation.ethPaid).to.equal(oneEth);

            const tokenLaunch = await fairLauncher.tokenLaunches(token);
            expect(tokenLaunch.totalRaised).to.equal(oneEth);
            expect(tokenLaunch.totalShareAmt).to.equal(oneEth);
            expect(tokenLaunch.totalForInvite).to.equal(ethers.parseUnits("0.02", "ether"));

            const inviterOf = await fairLauncher.inviterOf(token, user1Str);
            expect(inviterOf).to.equal(inviterStr);

            const inviteReward = await fairLauncher.inviteRewards(token, inviterStr);
            expect(inviteReward).to.equal(ethers.parseUnits("0.02", "ether"));
        });

        it("should succeed in the presale with two participations", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            // First participation
            await expect(fairLauncher.connect(user1).participate(timestamp, signature, inviterStr, token, { value: oneEth }))
                .to.emit(fairLauncher, "Participated")
                .withArgs(token, user1Str, inviterStr, oneEth, oneEth, ethers.parseUnits("0.02", "ether"), 0);

            // Second participation
            await expect(fairLauncher.connect(user1).participate(timestamp, signature, inviterStr, token, { value: oneEth }))
                .to.emit(fairLauncher, "Participated")
                .withArgs(token, user1Str, inviterStr, oneEth, oneEth, ethers.parseUnits("0.02", "ether"), 0);

            const totalEthAmt = ethers.parseUnits("2", "ether");

            const participation = await fairLauncher.participation(token, user1Str);
            expect(participation.ethPaid).to.equal(totalEthAmt);
            expect(participation.shareAmt).to.equal(totalEthAmt);

            const tokenLaunch = await fairLauncher.tokenLaunches(token);
            expect(tokenLaunch.totalRaised).to.equal(totalEthAmt);
            expect(tokenLaunch.totalShareAmt).to.equal(totalEthAmt);
            expect(tokenLaunch.totalForInvite).to.equal(ethers.parseUnits("0.04", "ether"));

            const inviterOf = await fairLauncher.inviterOf(token, user1Str);
            expect(inviterOf).to.equal(inviterStr);

            const inviteReward = await fairLauncher.inviteRewards(token, inviterStr);
            expect(inviteReward).to.equal(ethers.parseUnits("0.04", "ether"));
        });

        it("should revert if presale has suspended", async function () {
            await fairLauncher.setSuspendCfg({ all: false, presale: true, claim: false, refund: false, reserve: false });
            await expect(fairLauncher.connect(user1).participate(timestamp, signature, inviterStr, token, { value: oneEth }))
                .to.be.revertedWithCustomError(fairLauncher, "Suspend");
        });

        it("should revert if presale has not started", async function () {
            await expect(fairLauncher.connect(user1).participate(timestamp, signature, inviterStr, token, { value: oneEth }))
                .to.be.revertedWithCustomError(fairLauncher, "NotStarted");
        });

        it("should revert if presale has ended", async function () {
            await ethers.provider.send("evm_increaseTime", [2001]);

            await expect(fairLauncher.connect(user1).participate(timestamp, signature, inviterStr, token, { value: oneEth }))
                .to.be.revertedWithCustomError(fairLauncher, "Ended");
        });

        it("should revert with InvalidETH if contribution is below minimum", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            await expect(fairLauncher.connect(user1).participate(timestamp, signature, inviterStr, token, { value: ethers.parseUnits("0.01", "ether") }))
                .to.be.revertedWithCustomError(fairLauncher, "NotEnough");
        });

        it("should revert with InvalidETH if contribution is exceed maximum", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            await expect(fairLauncher.connect(user1).participate(timestamp, signature, inviterStr, token, { value: ethers.parseUnits("101", "ether") }))
                .to.be.revertedWithCustomError(fairLauncher, "ExceedsMaximum");
        });

        it("should correctly handle overfunded ETH contributions", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            const sign = await getSign(signer, token, user2Str, inviterStr, 0);
            await fairLauncher.connect(user2).participate(sign[1], sign[0], inviterStr, token, { value: ethers.parseUnits("50", "ether") });

            await expect(fairLauncher.connect(user1).participate(timestamp, signature, inviterStr, token, { value: hundredEth }))
                .to.emit(fairLauncher, "Participated")
                .withArgs(token, user1Str, inviterStr, hundredEth, ethers.parseUnits("75", "ether"), oneEth, 0);

            const participation = await fairLauncher.participation(token, user1Str);
            expect(participation.ethPaid).to.equal(hundredEth);
            expect(participation.shareAmt).to.equal(ethers.parseUnits("75", "ether"));

            const tokenLaunch = await fairLauncher.tokenLaunches(token);
            expect(tokenLaunch.totalRaised).to.equal(ethers.parseUnits("150", "ether"));
            expect(tokenLaunch.totalShareAmt).to.equal(ethers.parseUnits("125", "ether"));
            expect(tokenLaunch.totalForInvite).to.equal(ethers.parseUnits("2", "ether"));

            const inviteReward = await fairLauncher.inviteRewards(token, inviterStr);
            expect(inviteReward).to.equal(ethers.parseUnits("2", "ether"));
        });

        it("should succeed in the presale when participate without an invitation", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            const sign = await getSign(signer, token, ownerStr, ZERO_ADDRESS, 0);
            await expect(fairLauncher.connect(owner).participate(sign[1], sign[0], ZERO_ADDRESS, token, { value: oneEth }))
                .to.emit(fairLauncher, "Participated")
                .withArgs(token, ownerStr, ZERO_ADDRESS, oneEth, oneEth, 0, 0);

            const inviterOf = await fairLauncher.inviterOf(token, ownerStr);
            expect(inviterOf).to.equal(ZERO_ADDRESS);

            const inviteReward = await fairLauncher.inviteRewards(token, ZERO_ADDRESS);
            expect(inviteReward).to.equal(0);
        });

        it("should succeed in the presale with a second-tier inviter", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            const sign = await getSign(signer, token, user1Str, inviterStr, 0);
            await expect(fairLauncher.connect(user1).participate(sign[1], sign[0], inviterStr, token, { value: oneEth }))
                .to.emit(fairLauncher, "Participated")
                .withArgs(token, user1Str, inviterStr, oneEth, oneEth, ethers.parseUnits("0.02", "ether"), 0);
            const inviterOf = await fairLauncher.inviterOf(token, user1Str);
            expect(inviterOf).to.equal(inviterStr);
            let inviteReward = await fairLauncher.inviteRewards(token, inviterStr);
            expect(inviteReward).to.equal(ethers.parseUnits("0.02", "ether"));

            const sign2 = await getSign(signer, token, user2Str, user1Str, 0);
            await expect(fairLauncher.connect(user2).participate(sign2[1], sign2[0], user1Str, token, { value: oneEth }))
                .to.emit(fairLauncher, "Participated")
                .withArgs(token, user2Str, user1Str, oneEth, oneEth, ethers.parseUnits("0.02", "ether"), ethers.parseUnits("0.01", "ether"));
            const inviterOf2 = await fairLauncher.inviterOf(token, user2Str);
            expect(inviterOf2).to.equal(user1Str);
            let user1Reward = await fairLauncher.inviteRewards(token, user1Str);
            expect(user1Reward).to.equal(ethers.parseUnits("0.02", "ether"));

            inviteReward = await fairLauncher.inviteRewards(token, inviterStr);
            expect(inviteReward).to.equal(ethers.parseUnits("0.03", "ether"));

            const tokenLaunch = await fairLauncher.tokenLaunches(token);
            expect(tokenLaunch.totalForInvite).to.equal(ethers.parseUnits("0.05", "ether"));
        });

        it("should revert if participant tries to invite themselves", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            const sign = await getSign(signer, token, user1Str, user1Str, 0);
            await expect(fairLauncher.connect(user1).participate(sign[1], sign[0], user1Str, token, { value: oneEth }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidInviter");
        });

        it("should revert if the signature issuer is not the configured address", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            const sign = await getSign(user1, token, user1Str, inviterStr, 0);
            await expect(fairLauncher.connect(user1).participate(sign[1], sign[0], inviterStr, token, { value: oneEth }))
                .to.be.revertedWithCustomError(fairLauncher, "InvalidSignature");
        });
    });

    describe("refundForLaunchFail", function () {
        let token;
        let signature;
        let timestamp;

        beforeEach(async function () {
            // Make it impossible to meet the min launch amount
            let blockTime = await latestBlockTime();
            const tx = await fairLauncher.newFairLaunch(tokenCfg, {...presaleCfg, startTime: blockTime + 1000, endTime: blockTime + 2000,
                softCap: ethers.parseUnits("2", "ether")}, tokenomicsCfg, 0, { value: 0 });
            const launchCreatedEvent = (await tx.wait()).logs.find(event => event.topics[0] === launchCreatedEventId);
            token = launchCreatedEvent.args[0];

            await fairLauncher.setSignConf(signConf);
            await fairLauncher.setFeesCfg(feesCfg);

            await ethers.provider.send("evm_increaseTime", [1001]);
            const presaleSign = await getSign(signer, token, user1Str, inviterStr, 0);
            await fairLauncher.connect(user1).participate(presaleSign[1], presaleSign[0], inviterStr, token, { value: oneEth });

            const refundSign = await getSign(signer, token, user1Str, ZERO_ADDRESS, 1);
            signature = refundSign[0];
            timestamp = refundSign[1];
        });

        it("should allow user to get a refund if launch fails", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            const balanceBefore = await ethers.provider.getBalance(user1Str);
            await expect(fairLauncher.connect(user1).refundForLaunchFail(timestamp, signature, token))
                .to.emit(fairLauncher, "Refunded")
                .withArgs(token, user1Str, oneEth);
            const balanceAfter = await ethers.provider.getBalance(user1Str);
            expect(balanceAfter).to.be.gt(balanceBefore);

            const participation = await fairLauncher.participation(token, user1Str);
            expect(participation.refunded).to.be.true;
        });

        it("should revert if refund has suspended", async function () {
            await fairLauncher.setSuspendCfg({ all: false, presale: false, claim: false, refund: true, reserve: false });
            
            await expect(fairLauncher.connect(user1).refundForLaunchFail(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "Suspend");
        });

        it("should revert if presale has not ended", async function () {
            await expect(fairLauncher.connect(user1).refundForLaunchFail(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "NotEnded");
        });

        it("should revert if total raised ETH meets the minimum launch requirement", async function () {
            const presaleSign = await getSign(signer, token, user1Str, inviterStr, 0);
            await fairLauncher.connect(user1).participate(presaleSign[1], presaleSign[0], inviterStr, token, { value: oneEth });

            await ethers.provider.send("evm_increaseTime", [1001]);

            await expect(fairLauncher.connect(user1).refundForLaunchFail(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "AlreadyLaunched");
        });

        it("should revert if user has no participation", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            const refundSign = await getSign(signer, token, user2Str, ZERO_ADDRESS, 1);
            await expect(fairLauncher.connect(user2).refundForLaunchFail(refundSign[1], refundSign[0], token))
                .to.be.revertedWithCustomError(fairLauncher, "ZeroAmount");
        });

        it("should revert if user has refunded", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            await fairLauncher.connect(user1).refundForLaunchFail(timestamp, signature, token);
            await expect(fairLauncher.connect(user1).refundForLaunchFail(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "AlreadyRefund");
        });
    });

    describe("reserveFreeClaim", function () {
        let token;
        let signature;
        let timestamp;
        let curFreeClaimPerUser =  ethers.parseUnits("300000000", 18);

        beforeEach(async function () {
            let blockTime = await latestBlockTime();
            const tx = await fairLauncher.newFairLaunch(tokenCfg, {...presaleCfg, startTime: blockTime + 1000, endTime: blockTime + 2000},
                {...tokenomicsCfg, freeClaimPerUser: curFreeClaimPerUser}, 0, { value: 0 });
            const launchCreatedEvent = (await tx.wait()).logs.find(event => event.topics[0] === launchCreatedEventId);
            token = launchCreatedEvent.args[0];

            await fairLauncher.setSignConf(signConf);
            await fairLauncher.setFeesCfg(feesCfg);

            const sign = await getSign(signer, token, user1Str, ZERO_ADDRESS, 2);
            signature = sign[0];
            timestamp = sign[1];
        });

        it("should allow user to reserve a free claim", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            await expect(fairLauncher.connect(user1).reserveFreeClaim(timestamp, signature, token))
                .to.emit(fairLauncher, "FreeClaimReserved")
                .withArgs(token, user1Str, curFreeClaimPerUser);

            const participation = await fairLauncher.participation(token, user1Str);
            expect(participation.reserved).to.be.true;
        });

        it("should revert if reserve has suspended", async function () {
            await fairLauncher.setSuspendCfg({ all: false, presale: false, claim: false, refund: false, reserve: true });

            await expect(fairLauncher.connect(user1).reserveFreeClaim(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "Suspend");
        });

        it("should revert if presale has not started", async function () {
            await expect(fairLauncher.connect(user1).reserveFreeClaim(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "NotStarted");
        });

        it("should revert if presale has ended", async function () {
            await ethers.provider.send("evm_increaseTime", [2001]);

            await expect(fairLauncher.connect(user1).reserveFreeClaim(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "Ended");
        });

        it("should revert if total reserved amount exceed Maximum", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            const sign = await getSign(signer, token, user2Str, ZERO_ADDRESS, 2);
            await fairLauncher.connect(user2).reserveFreeClaim(sign[1], sign[0], token);

            await expect(fairLauncher.connect(user1).reserveFreeClaim(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "Ended");
        });

        it("should revert if user already reserved a free claim", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            await fairLauncher.connect(user1).reserveFreeClaim(timestamp, signature, token);
            await expect(fairLauncher.connect(user1).reserveFreeClaim(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "AlreadyReserved");
        });
     });

    describe("launch", function () {
        let token;
        let signature;
        let timestamp;

        beforeEach(async function () {
            let blockTime = await latestBlockTime();
            const tx = await fairLauncher.newFairLaunch(tokenCfg, {...presaleCfg, startTime: blockTime + 1000, endTime: blockTime + 2000}, tokenomicsCfg, 0, { value: 0 });
            const launchCreatedEvent = (await tx.wait()).logs.find(event => event.topics[0] === launchCreatedEventId);
            token = launchCreatedEvent.args[0];

            await fairLauncher.setSignConf(signConf);
            await fairLauncher.setFeesCfg(feesCfg);
            await fairLauncher.setExecutor(executorStr);
            await fairLauncher.setOLESwapCfg(oleSwapCfg);
            await fairLauncher.setSupportedDexRouter(uniV2Router.getAddress(), true);

            const launchSign = await getSign(signer, token, user1Str, ZERO_ADDRESS, 3);
            signature = launchSign[0];
            timestamp = launchSign[1];
        });

        it("should launch the token successfully", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);
            const presaleSign = await getSign(signer, token, user1Str, inviterStr, 0);
            await fairLauncher.connect(user1).participate(presaleSign[1], presaleSign[0], inviterStr, token, { value: ethers.parseUnits("2", "ether") });

            await ethers.provider.send("evm_increaseTime", [1001]);

            const expectEthSupply = ethers.parseUnits("1.86", "ether");
            const expectTokenSupply = ethers.parseUnits("4000000000", 18);
            const expectLiquidity = expectEthSupply + expectTokenSupply;

            await expect(fairLauncher.connect(executor).launch(token, uniV2Router.getAddress(), 1))
                .to.emit(fairLauncher, "Launched")
                .withArgs(token, anyValue, expectLiquidity, expectTokenSupply, expectEthSupply, ethers.parseUnits("0.1", "ether"), 1);

            const tokenLaunch = await fairLauncher.tokenLaunches(token);
            expect(tokenLaunch.isLaunched).to.be.true;

            expect(await uniV2Router.lpBalance(lpRecipientStr)).to.equal(expectLiquidity);

            const balance = await ethers.provider.getBalance(fairLauncher.getAddress());
            expect(balance).to.equal(ethers.parseUnits("0", "ether"));
        });

        it("should revert if not called by executor", async function () {
            await expect(fairLauncher.connect(user1).launch(token, uniV2Router.getAddress(), 1))
                .to.be.revertedWithCustomError(fairLauncher, "OnlyExecutor");
        });

        it("should revert if presale has not ended", async function () {
            await expect(fairLauncher.connect(executor).launch(token, uniV2Router.getAddress(), 1))
                .to.be.revertedWithCustomError(fairLauncher, "NotEnded");
        });

        it("should revert if total raised ETH is below minimum launch requirement", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);
            const presaleSign = await getSign(signer, token, user1Str, inviterStr, 0);
            await fairLauncher.connect(user1).participate(presaleSign[1], presaleSign[0], inviterStr, token, { value: ethers.parseUnits("0.9", "ether") });

            await ethers.provider.send("evm_increaseTime", [1001]);
            await expect(fairLauncher.connect(executor).launch(token, uniV2Router.getAddress(), 1))
                .to.be.revertedWithCustomError(fairLauncher, "NotEnough");
        });

        it("should revert if already launched", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);
            const presaleSign = await getSign(signer, token, user1Str, inviterStr, 0);
            await fairLauncher.connect(user1).participate(presaleSign[1], presaleSign[0], inviterStr, token, { value: ethers.parseUnits("2", "ether") });

            await ethers.provider.send("evm_increaseTime", [1001]);
            await fairLauncher.connect(executor).launch(token, uniV2Router.getAddress(), 1);

            await expect(fairLauncher.connect(executor).launch(token, uniV2Router.getAddress(), 1))
                .to.be.revertedWithCustomError(fairLauncher, "AlreadyLaunched");
        });

        it("should revert if dexRouter not supported", async function () {
            await fairLauncher.setSupportedDexRouter(uniV2Router.getAddress(), false);

            await ethers.provider.send("evm_increaseTime", [1001]);
            const presaleSign = await getSign(signer, token, user1Str, inviterStr, 0);
            await fairLauncher.connect(user1).participate(presaleSign[1], presaleSign[0], inviterStr, token, { value: ethers.parseUnits("2", "ether") });

            await ethers.provider.send("evm_increaseTime", [1001]);
            await expect(fairLauncher.connect(executor).launch(token, uniV2Router.getAddress(), 1))
                .to.be.revertedWithCustomError(fairLauncher, "UnsupportedDex");
        });

        it("should revert if the number of OLEs swapped is less than the minimum number required", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);
            const presaleSign = await getSign(signer, token, user1Str, inviterStr, 0);
            await fairLauncher.connect(user1).participate(presaleSign[1], presaleSign[0], inviterStr, token, { value: ethers.parseUnits("2", "ether") });

            await ethers.provider.send("evm_increaseTime", [1001]);
            await uniV2Router.setMinSwapReturn(2);
            await expect(fairLauncher.connect(executor).launch(token, uniV2Router.getAddress(), 1))
                .to.be.revertedWith("INSUFFICIENT_OUTPUT_AMOUNT");
        });

        it("should revert if the liquidity provided is insufficient", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);
            const presaleSign = await getSign(signer, token, user1Str, inviterStr, 0);
            await fairLauncher.connect(user1).participate(presaleSign[1], presaleSign[0], inviterStr, token, { value: ethers.parseUnits("2", "ether") });

            await ethers.provider.send("evm_increaseTime", [1001]);
            await uniV2Router.setMinTokensForAddLiquidity(ethers.parseUnits("4000000001", 18));
            await expect(fairLauncher.connect(executor).launch(token, uniV2Router.getAddress(), 2))
                .to.be.revertedWith( "INSUFFICIENT_A_AMOUNT");
        });
    });

    describe("claims", function () {
        let token;
        let signature;
        let timestamp;

        beforeEach(async function () {
            // Make it impossible to meet the min launch amount
            let blockTime = await latestBlockTime();
            const tx = await fairLauncher.newFairLaunch(tokenCfg, {...presaleCfg, startTime: blockTime + 1000, endTime: blockTime + 2000}, tokenomicsCfg, 0, { value: 0 });
            const launchCreatedEvent = (await tx.wait()).logs.find(event => event.topics[0] === launchCreatedEventId);
            token = launchCreatedEvent.args[0];

            await fairLauncher.setSignConf(signConf);
            await fairLauncher.setFeesCfg(feesCfg);
            await fairLauncher.setExecutor(executorStr);
            await fairLauncher.setOLESwapCfg(oleSwapCfg);
            await fairLauncher.setSupportedDexRouter(uniV2Router.getAddress(), true);

            await ethers.provider.send("evm_increaseTime", [1001]);
            const presaleSign1 = await getSign(signer, token, user1Str, inviterStr, 0);
            await fairLauncher.connect(user1).participate(presaleSign1[1], presaleSign1[0], inviterStr, token, { value: hundredEth });

            const presaleSign2 = await getSign(signer, token, user2Str, user1Str, 0);
            await fairLauncher.connect(user2).participate(presaleSign2[1], presaleSign2[0], user1Str, token, { value: hundredEth });

            const reserveSign = await getSign(signer, token, user2Str, ZERO_ADDRESS, 2);
            await fairLauncher.connect(user2).reserveFreeClaim(reserveSign[1], reserveSign[0], token);

            const claimSign = await getSign(signer, token, user1Str, ZERO_ADDRESS, 3);
            signature = claimSign[0];
            timestamp = claimSign[1];
        });
        
        it("should allow user to claim their MEME token, OLE rewards and overfunded ETH refund after launch", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);
            await fairLauncher.connect(executor).launch(token, uniV2Router.getAddress(), 10000);

            await expect(fairLauncher.connect(user1).claims(timestamp, signature, token))
                .to.emit(fairLauncher, "Claimed")
                .withArgs(token, user1Str, ethers.parseUnits("2000000000", 18), 0, 0, ethers.parseUnits("50", "ether"));

            let claimSign2 = await getSign(signer, token, user2Str, ZERO_ADDRESS, 3);
            await expect(fairLauncher.connect(user2).claims(claimSign2[1], claimSign2[0], token))
                .to.emit(fairLauncher, "Claimed")
                .withArgs(token, user2Str, ethers.parseUnits("1000000000", 18), tokenomicsCfg.freeClaimPerUser, 0, ethers.parseUnits("50", "ether"));

            let claimSign3 = await getSign(signer, token, inviterStr, ZERO_ADDRESS, 3);
            await expect(fairLauncher.connect(inviter).claims(claimSign3[1], claimSign3[0], token))
                .to.emit(fairLauncher, "Claimed")
                .withArgs(token, inviterStr, 0, 0, 10000, 0);

            const erc20 = await ethers.getContractAt("D1MemeToken", token);

            expect(await erc20.balanceOf(user1Str)).to.equal(ethers.parseUnits("2000000000", 18));
            const participation1 = await fairLauncher.participation(token, user1Str);
            expect(participation1.claimed).to.be.true;

            expect(await erc20.balanceOf(user2Str)).to.equal(ethers.parseUnits("1010000000", 18));
            const participation2 = await fairLauncher.participation(token, user2Str);
            expect(participation2.claimed).to.be.true;

            const participation3 = await fairLauncher.participation(token, inviterStr);
            expect(participation2.claimed).to.be.true;
        });

        it("should revert if claim has suspended", async function () {
            await fairLauncher.setSuspendCfg({ all: false, presale: false, claim: true, refund: false, reserve: false });

            await expect(fairLauncher.connect(user1).claims(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "Suspend");
        });

        it("should revert if tokens are claimed before launch", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            await expect(fairLauncher.connect(user1).claims(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "NotLaunched");
        });

        it("should revert if user has already claimed", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);
            await fairLauncher.connect(executor).launch(token, uniV2Router.getAddress(), 10000);
            await fairLauncher.connect(user1).claims(timestamp, signature, token);

            await expect(fairLauncher.connect(user1).claims(timestamp, signature, token))
                .to.be.revertedWithCustomError(fairLauncher, "AlreadyClaimed");
        });

        it("should revert if claimable is null", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);
            await fairLauncher.connect(executor).launch(token, uniV2Router.getAddress(), 10000);

            let claimSign = await getSign(signer, token, ownerStr, ZERO_ADDRESS, 3);
            await expect(fairLauncher.connect(owner).claims(claimSign[1], claimSign[0], token))
                .to.be.revertedWithCustomError(fairLauncher, "ZeroAmount");
        });
    });
});





