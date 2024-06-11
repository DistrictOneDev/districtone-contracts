const { expect } = require("chai");
const { ethers, web3} = require("hardhat");
const {hexStringToArray} = require("../util/EtheUtil");

describe("TokenVault", function () {
    let  tokenVault, owner, issuer, user, token;
    let issuerStr, userStr, tokenStr, tokenVaultStr;

    beforeEach(async function () {
        [owner, issuer, user] = await ethers.getSigners();
        issuerStr = await issuer.getAddress();
        userStr = await user.getAddress();

        // Deploy TokenVault contract
        const TokenVault = await ethers.getContractFactory("TokenVault");
        tokenVault = await TokenVault.deploy();
        tokenVaultStr = await tokenVault.getAddress();

        // Set issuer address
        await tokenVault.setIssuerAddress(issuerStr);

        // Deploy a mock ERC20 token
        const MockToken = await ethers.getContractFactory("MockToken");
        token = await MockToken.deploy("Mock Token", "MTK", ethers.parseEther("1000"));
        tokenStr = String(await token.getAddress());

        // Transfer some tokens to the user
        await token.transfer(userStr, ethers.parseEther("100"));
    });

    const getSignature = async (signer, tokenAddress, userAddress, amount, nonce, signType) => {
        let sign;
        await signer.signMessage(hexStringToArray(ethers.solidityPackedKeccak256(["address", "address", "uint256", "uint256", "uint256"], [tokenAddress, userAddress, amount, nonce, signType]))).then(result => {
            sign = result;
        });
        return sign;
    };

    it("should allow deposits with valid signature", async function () {
        const amount = ethers.parseEther("10");
        const signature = await getSignature(issuer, tokenStr, userStr, amount, 0, 0);

        await token.connect(user).approve(tokenVaultStr, amount);

        await expect(tokenVault.connect(user).deposit(tokenStr, amount, signature))
            .to.emit(tokenVault, "Deposited")
            .withArgs(userStr, tokenStr, amount);

        expect(await tokenVault.deposited(userStr, tokenStr)).to.equal(amount);
    });

    it("should revert deposit with invalid signature", async function () {
        const amount = ethers.parseEther("10");
        const invalidSignature = await getSignature(user, tokenStr, userStr, amount, 0, 0);

        await token.connect(user).approve(tokenVaultStr, amount);
        await expect(tokenVault.connect(user).deposit(tokenStr, amount, invalidSignature))
            .to.be.revertedWithCustomError(tokenVault,"InvalidSignature");
    });

    it("should allow withdrawals with valid signature", async function () {
        const amount = ethers.parseEther("100");
        await token.transfer(tokenVaultStr, amount);
        expect(await token.balanceOf(userStr)).to.equal(ethers.parseEther("100"));

        const signature = await getSignature(issuer, tokenStr, userStr, amount, 1, 1);
        await expect(tokenVault.connect(user).withdraw(tokenStr, amount, 1, signature))
            .to.emit(tokenVault, "Withdrawn")
            .withArgs(userStr, tokenStr, amount);

        expect(await tokenVault.withdrawn(userStr, tokenStr)).to.equal(amount);
        expect(await token.balanceOf(userStr)).to.equal(ethers.parseEther("200"));
    });

    it("should revert withdrawal with invalid signature", async function () {
        const amount = ethers.parseEther("100");
        
        const invalidSignature = await getSignature(user, tokenStr, userStr, amount, 1, 1);
        await expect(tokenVault.connect(user).withdraw(tokenStr, amount, 2, invalidSignature))
            .to.be.revertedWithCustomError(tokenVault,"InvalidSignature");
    });

    it("should revert withdrawal if nonce has already been used", async function () {
        const amount = ethers.parseEther("100");
        await token.transfer(tokenVaultStr, amount);
        let nonce = 1;

        const signature = await getSignature(issuer, tokenStr, userStr, amount, nonce, 1);
        await tokenVault.connect(user).withdraw(tokenStr, amount, nonce, signature);

        // Attempt to withdraw again with the same nonce
        await expect(tokenVault.connect(user).withdraw(tokenStr, amount, nonce, signature))
            .to.be.revertedWithCustomError(tokenVault,"NonceUsed");
    });
});
