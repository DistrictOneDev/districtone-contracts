const { expect } = require("chai");
const { ethers } = require("hardhat");
const {latestBlockTime} = require("./LaunchUtil");
const {MerkleTree} = require("merkletreejs");
const keccak256 = require("keccak256");
describe("Airdropper", function () {
    let airdropper, launcher, token, owner, addr1, addr2, executor;
    let tokenStr, ownerStr, addr1Str, addr2Str, executorStr, airdropperStr, launcherStr;
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    const airdropAmt = ethers.parseUnits("1000", 18);
    const totalEpochReward = ethers.parseUnits("10", 18);
    let merkleRoot, merkleTree, leaves;
    let addr1ClaimAmt = 100;
    let addr2ClaimAmt = 400;

    beforeEach(async function () {
        [owner, addr1, addr2, executor] = await ethers.getSigners();
        ownerStr = String(await owner.getAddress());
        addr1Str = String(await addr1.getAddress());
        addr2Str = String(await addr2.getAddress());
        executorStr = String(await executor.getAddress());
        
        const MockFairLaunch = await ethers.getContractFactory("MockFairLaunch");
        launcher = await MockFairLaunch.deploy();
        launcherStr = String(await launcher.getAddress());

        const Airdropper = await ethers.getContractFactory("Airdropper");
        airdropper = await Airdropper.deploy(launcherStr, executorStr);
        airdropperStr = String(await airdropper.getAddress());
        await airdropper.setExecutor(executorStr);

        const TOKEN = await ethers.getContractFactory("MockToken");
        token = await TOKEN.deploy("D1 MEME TOKEN", "D1MT", ethers.parseUnits("10000000000", 18));
        tokenStr = String(await token.getAddress());

        const users = [
            {address: addr1Str, amount: addr1ClaimAmt},
            {address: addr2Str, amount: addr2ClaimAmt}
        ];
        leaves = users.map((x) =>
            ethers.solidityPackedKeccak256(["address", "uint256"], [x.address, x.amount])
        );
        merkleTree = new MerkleTree(leaves, keccak256, {sort: true});
        merkleRoot = merkleTree.getHexRoot();
    });

    const launchCreatedEventId = ethers.id("LaunchCreated(address,uint256,address,(uint256,string,string),(uint256,uint256,uint256,uint256,uint256,uint256,uint256),(uint256,uint256,uint256,uint256,uint256,uint256),uint256)");

    describe("createAirdrop", function () {
        it("should create a new airdrop successfully", async function () {
            await token.mint(launcherStr, airdropAmt);
            let blockTime = await latestBlockTime();

            await expect(launcher.createAirdrop(airdropperStr, tokenStr, airdropAmt, blockTime + 1000, blockTime + 2000))
                .to.emit(airdropper, "Airdropped")
                .withArgs(token, airdropAmt, blockTime + 1000, blockTime + 2000, launcherStr);

            const airdrop = await airdropper.airdrops(tokenStr);
            expect(airdrop.totalAmount).to.equal(airdropAmt);
            expect(airdrop.releaseStartAt).to.equal(blockTime + 1000);
            expect(airdrop.releaseEndAt).to.equal(blockTime + 2000);
            expect(airdrop.fairLauncher).to.equal(launcherStr);

            expect(await token.balanceOf(airdropperStr)).to.equal(airdropAmt);
        });

        it("should revert if not called by FairLauncher", async function () {
            let blockTime = await latestBlockTime();
            await expect(airdropper.connect(addr1).createAirdrop(tokenStr, 1000, blockTime, blockTime + 3600))
                .to.be.revertedWithCustomError(airdropper,"OnlyFairLauncher");
        });

        it("should revert if start time is in the past", async function () {
            let blockTime = await latestBlockTime();
            await expect(launcher.createAirdrop(airdropperStr, tokenStr, airdropAmt, blockTime - 3600, blockTime+ 3600))
                .to.be.revertedWithCustomError(airdropper,"InvalidTime");
        });

        it("should revert if end time is before start time", async function () {
            let blockTime = await latestBlockTime();
            await expect(launcher.createAirdrop(airdropperStr, tokenStr, airdropAmt, blockTime + 3600, blockTime + 3600))
                .to.be.revertedWithCustomError(airdropper,"InvalidTime");
        });

        it("should revert if airdrop already exists for the token", async function () {
            await token.mint(launcherStr, airdropAmt);
            let blockTime = await latestBlockTime();
            await launcher.createAirdrop(airdropperStr, tokenStr, airdropAmt, blockTime + 1000, blockTime + 2000);
            
            await expect(launcher.createAirdrop(airdropperStr, tokenStr, airdropAmt, blockTime + 1000, blockTime + 2000))
                .to.be.revertedWithCustomError(airdropper,"AlreadyCreated");
        });

        it("should revert if token transfer fails", async function () {            
            let blockTime = await latestBlockTime();
            await expect(launcher.createAirdrop(airdropperStr, tokenStr, airdropAmt, blockTime + 1000, blockTime + 3600))
                .to.be.rejectedWith("ERC20InsufficientBalance");
        });
    });

    describe("newTranche", function () {
        let blockTime;
        beforeEach(async function () {
            await token.mint(launcherStr, airdropAmt);
            blockTime = await latestBlockTime();
            await launcher.createAirdrop(airdropperStr, tokenStr, airdropAmt, blockTime + 1, blockTime + 2000);
            await launcher.setTokenLaunch(tokenStr);
        });

        it("should add a new tranche successfully", async function () {
            await expect(airdropper.connect(executor).newTranche(token, 500, blockTime + 1000, merkleRoot))
                .to.emit(airdropper, "TrancheAdded")
                .withArgs(token, 1, 500, blockTime + 1000, merkleRoot);

            const tranche = await airdropper.tranches(token, 1);
            expect(tranche.total).to.equal(500);
        });

        it("should revert if not called by executor", async function () {
            await expect(airdropper.connect(addr1).newTranche(token, 500, blockTime + 1800, merkleRoot))
                .to.be.revertedWithCustomError(airdropper,"OnlyExecutor");
        });

        it("should revert if token not launched", async function () {
            await launcher.removeTokenLaunch(tokenStr);
            await expect(airdropper.connect(executor).newTranche(token, 500, blockTime + 1800, merkleRoot))
                .to.be.revertedWithCustomError(airdropper,"NotStarted");
        });

        it("should revert if start time is in the past", async function () {
            await expect(airdropper.connect(executor).newTranche(token, 500, blockTime - 1800, merkleRoot))
                .to.be.revertedWithCustomError(airdropper,"InvalidTime");
        });

        it("should revert if tranche amount is zero", async function () {
            await expect(airdropper.connect(executor).newTranche(token, 0, blockTime + 1800, merkleRoot))
                .to.be.revertedWithCustomError(airdropper,"InvalidAmount");
        });

        it("should revert if tranche amount exceeds releasable amount", async function () {
            await expect(airdropper.connect(executor).newTranche(token, airdropAmt, blockTime + 1800, merkleRoot))
                .to.be.revertedWithCustomError(airdropper,"InvalidAmount");
        });
    });

    describe("claims", function () {
        let blockTime;
        beforeEach(async function () {
            await token.mint(launcherStr, airdropAmt);
            blockTime = await latestBlockTime();
            await launcher.createAirdrop(airdropperStr, tokenStr, airdropAmt, blockTime + 1, blockTime + 2000);
            await launcher.setTokenLaunch(tokenStr);
            await airdropper.connect(executor).newTranche(token, 500, blockTime + 1000, merkleRoot);
        });

        it("should claim tokens successfully from multiple tranches", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);
            let blockTime = await latestBlockTime();
            await airdropper.connect(executor).newTranche(token, 500, blockTime + 2000, merkleRoot);
            
            await ethers.provider.send("evm_increaseTime", [1001]);

            await expect(airdropper.connect(addr1).claims(token, [1,2], [addr1ClaimAmt, addr1ClaimAmt], [merkleTree.getHexProof(leaves[0]), merkleTree.getHexProof(leaves[0])]))
                .to.emit(airdropper, "Claimed")
                .withArgs(token, 1, addr1Str, addr1ClaimAmt);

            const claimed1 = await airdropper.claimed(token, 1, addr1Str);
            expect(claimed1).to.equal(addr1ClaimAmt);
            const claimed2 = await airdropper.claimed(token, 2, addr1Str);
            expect(claimed2).to.equal(addr1ClaimAmt);
            
            expect(await token.balanceOf(addr1Str)).to.equal(addr1ClaimAmt * 2);

            const tranche1 = await airdropper.tranches(token, 1);
            expect(tranche1.claimed).to.equal(addr1ClaimAmt);

            const tranche2 = await airdropper.tranches(token, 1);
            expect(tranche2.claimed).to.equal(addr1ClaimAmt);
        });

        it("should revert if claim before tranche start time", async function () {
            await expect(airdropper.connect(addr1).claims(token, [1], [addr1ClaimAmt], [merkleTree.getHexProof(leaves[0])]))
                .to.be.revertedWithCustomError(airdropper,"NotStarted");
        });

        it("should revert if user has already claimed from tranche", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);
            await airdropper.connect(addr1).claims(token, [1], [addr1ClaimAmt], [merkleTree.getHexProof(leaves[0])]);

            await expect(airdropper.connect(addr1).claims(token, [1], [addr1ClaimAmt], [merkleTree.getHexProof(leaves[0])]))
                .to.be.revertedWithCustomError(airdropper,"AlreadyClaimed");
        });

        it("should revert if claim same tranche", async function () {
            await ethers.provider.send("evm_increaseTime", [1001]);

            await expect(airdropper.connect(addr1).claims(token, [1, 1], [addr1ClaimAmt, addr1ClaimAmt], [merkleTree.getHexProof(leaves[0]), merkleTree.getHexProof(leaves[0])]))
                .to.be.revertedWithCustomError(airdropper,"AlreadyClaimed");
        });

        it("should revert if claim amount exceeds tranche total", async function () {
            let users1 = [{address: addr1Str, amount: 600}];
            let leaves1 = users1.map((x) =>
                ethers.solidityPackedKeccak256(["address", "uint256"], [x.address, x.amount])
            );
            let merkleTree1 = new MerkleTree(leaves1, keccak256, {sort: true});
            await ethers.provider.send("evm_increaseTime", [1001]);
            let blockTime = await latestBlockTime();
            await airdropper.connect(executor).newTranche(token, 500, blockTime + 2000, merkleTree1.getHexRoot());

            await ethers.provider.send("evm_increaseTime", [1001]);

            await expect(airdropper.connect(addr1).claims(token, [2], [600], [merkleTree1.getHexProof(leaves[0])]))
                .to.be.revertedWithCustomError(airdropper,"ExceedsMaximum");
        });

        it("should revert if claim amount is zero", async function () {
            let users1 = [{address: addr1Str, amount: 0}];
            let leaves1 = users1.map((x) =>
                ethers.solidityPackedKeccak256(["address", "uint256"], [x.address, x.amount])
            );
            let merkleTree1 = new MerkleTree(leaves1, keccak256, {sort: true});
            await ethers.provider.send("evm_increaseTime", [1001]);
            let blockTime = await latestBlockTime();
            await airdropper.connect(executor).newTranche(token, 500, blockTime + 2000, merkleTree1.getHexRoot());

            await ethers.provider.send("evm_increaseTime", [1001]);

            await expect(airdropper.connect(addr1).claims(token, [2], [0], [merkleTree1.getHexProof(leaves[0])]))
                .to.be.revertedWithCustomError(airdropper,"InvalidParam");
        });

        it("should revert if merkle proof is invalid", async function () {
            let users1 = [{address: addr1Str, amount: 100}];
            let leaves1 = users1.map((x) =>
                ethers.solidityPackedKeccak256(["address", "uint256"], [x.address, x.amount])
            );
            let merkleTree1 = new MerkleTree(leaves1, keccak256, {sort: true});
            await ethers.provider.send("evm_increaseTime", [1001]);
            let blockTime = await latestBlockTime();
            await airdropper.connect(executor).newTranche(token, 500, blockTime + 2000, merkleTree1.getHexRoot());

            await ethers.provider.send("evm_increaseTime", [1001]);

            await expect(airdropper.connect(addr1).claims(token, [2], [200], [merkleTree1.getHexProof(leaves[0])]))
                .to.be.revertedWithCustomError(airdropper,"InvalidParam");
        });
    });

    describe("setFairLauncher", function () {
        it("should set fairLauncher", async function () {
            await airdropper.setFairLauncher(addr1Str);
            const fairLauncher = await airdropper.fairLauncher();
            expect(fairLauncher).to.equal(addr1Str);
        });

        it("should revert setFairLauncher if not owner", async function () {
            await expect(airdropper.connect(addr1).setFairLauncher(addr1Str)).to.be.revertedWithCustomError(airdropper, "OwnableUnauthorizedAccount");
        });
    });

    describe("setExecutor", function () {
        it("should set executor", async function () {
            await airdropper.setExecutor(addr1Str);
            const executor = await airdropper.executor();
            expect(executor).to.equal(addr1Str);
        });

        it("should revert setExecutor if not owner", async function () {
            await expect(airdropper.connect(addr1).setExecutor(addr1Str)).to.be.revertedWithCustomError(airdropper, "OwnableUnauthorizedAccount");
        });
    });

});