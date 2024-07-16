const { expect } = require("chai");
const { ethers } = require("hardhat");
const { hexStringToArray } = require("./util/EtheUtil");
const { parseEther } = require("ethers");
const { now } = require("./launch/LaunchUtil");

describe("OLEClaim Contract", function() {
  let oleClaim;
  let oleToken;
  let owner;
  let addr1;
  let addr2;
  let addrs;

  beforeEach(async function() {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    // Deploy a mock ERC20 token for testing
    const Token = await ethers.getContractFactory("MockToken");
    oleToken = await Token.deploy("OLE Token", "OLE", parseEther("1000000"));

    // Deploy the OLEClaim contract
    const OLEClaimFactory = await ethers.getContractFactory("OLEClaim");
    oleClaim = await OLEClaimFactory.deploy(await oleToken.getAddress(), owner.address);
  });

  describe("Claiming OLE Tokens", function() {
    it("should allow a valid claim with correct signature", async function() {
      const amount = 100;
      const epoch = 1;
      const timestamp = now();
      const message = ethers.solidityPackedKeccak256(
        ["address", "address", "uint256", "uint256", "uint256"],
        [await oleClaim.getAddress(), addr1.address, amount, epoch, timestamp]
      );
      const signature = await owner.signMessage(hexStringToArray(message));
      await oleToken.transfer(await oleClaim.getAddress(), amount);
      await expect(oleClaim.connect(addr1).claimOLE(epoch, amount, timestamp, signature))
        .to.emit(oleClaim, "Claimed")
        .withArgs(addr1.address, epoch, amount, signature);
    });

    it("should reject a claim with reused signature", async function() {
      const amount = 100;
      const epoch = 1;
      const timestamp = now();
      const message = ethers.solidityPackedKeccak256(
        ["address", "address", "uint256", "uint256", "uint256"],
        [await oleClaim.getAddress(), addr1.address, amount, epoch, timestamp]
      );
      const signature = await owner.signMessage(hexStringToArray(message));
      await oleToken.transfer(await oleClaim.getAddress(), amount);
      // First claim
      await oleClaim.connect(addr1).claimOLE(epoch, amount, timestamp, signature);

      // Try to claim again with the same signature
      await expect(oleClaim.connect(addr1).claimOLE(epoch, amount, timestamp, signature))
        .to.be.revertedWithCustomError(oleClaim, "SignatureAlreadyUsed");
    });

    it("should reject a claim with an invalid signature", async function() {
      const amount = 100;
      const epoch = 1;
      const timestamp = now();
      const message = ethers.solidityPackedKeccak256(
        ["address", "address", "uint256", "uint256", "uint256"],
        [await oleClaim.getAddress(), addr1.address, amount, epoch, timestamp]
      );
      const signature = await addr2.signMessage(hexStringToArray(message));
      // Attempt to claim with the wrong signature
      await expect(oleClaim.connect(addr1).claimOLE(epoch, amount, timestamp, signature))
        .to.be.revertedWithCustomError(oleClaim, "InvalidSignature");
    });
  });

  describe("Batch Claiming OLE Tokens", function() {
    it("should allow multiple valid claims in a batch", async function() {
      const epochs = [1, 2];
      const amounts = [100, 200];
      const timestamps = [now(), now() + 10];
      const oleClaimAddr = await oleClaim.getAddress();
      const messages = epochs.map((epoch, i) =>
        ethers.solidityPackedKeccak256(
          ["address", "address", "uint256", "uint256", "uint256"],
          [oleClaimAddr, addr1.address, amounts[i], epoch, timestamps[i]]
        )
      );
      const signatures = await Promise.all(
        messages.map(message =>
          owner.signMessage(hexStringToArray(message))
        )
      );

      // Simulate sending enough tokens to the contract for claims
      await oleToken.transfer(oleClaimAddr, 500);

      await expect(oleClaim.connect(addr1).claimOLEBatch(epochs, amounts, timestamps, signatures))
        .to.emit(oleClaim, "Claimed").withArgs(addr1.address, 1, 100, signatures[0])
        .and.to.emit(oleClaim, "Claimed").withArgs(addr1.address, 2, 200, signatures[1]);

      // Verify final token balances
      expect(await oleToken.balanceOf(addr1.address)).to.equal(300);
    });

    it("should revert with MismatchedInputLengths if input arrays are of different lengths", async function() {
      const epochs = [1, 2]; // Two epochs
      const amounts = [100]; // One amount
      const timestamps = [now(), now() + 10];
      const oleClaimAddr = await oleClaim.getAddress();
      const messages = epochs.map((epoch, i) =>
        ethers.solidityPackedKeccak256(
          ["address", "address", "uint256", "uint256", "uint256"],
          [oleClaimAddr, addr1.address, amounts[0], epoch, timestamps[i]] // Using the same amount for simplicity
        )
      );
      const signatures = await Promise.all(
        messages.map(message =>
          owner.signMessage(hexStringToArray(message))
        )
      );

      // Remove one signature to make lengths different
      signatures.pop();

      // Expect the transaction to revert with the custom error
      await expect(oleClaim.connect(addr1).claimOLEBatch(epochs, amounts, timestamps, signatures))
        .to.be.revertedWithCustomError(oleClaim, "MismatchedInputLengths")
        .withArgs(); // No additional arguments expected with this error
    });
  });

  describe("Admin Functions", function() {
    it("should allow the owner to set a new signer", async function() {
      await oleClaim.setSigner(addr2.address);
      expect(await oleClaim.signer()).to.equal(addr2.address);
    });

    it("should prevent non-owners from setting a new signer", async function() {
      await expect(oleClaim.connect(addr1).setSigner(addr2.address))
        .to.be.revertedWithCustomError(oleClaim, "OwnableUnauthorizedAccount");
    });

    it("should allow the owner to change the OLE token contract address", async function() {
      await oleClaim.setOLETokenAddress(addr2.address);
      expect(await oleClaim.oleToken()).to.equal(addr2.address);
    });

    it("should prevent non-owners from changing the OLE token contract address", async function() {
      await expect(oleClaim.connect(addr1).setOLETokenAddress(addr2.address))
        .to.be.revertedWithCustomError(oleClaim, "OwnableUnauthorizedAccount");
    });

    it("should allow the owner to recycle tokens", async function() {
      // Simulate sending tokens to the contract
      await oleToken.transfer(await oleClaim.getAddress(), 500);

      // Recycle some tokens
      await oleClaim.recycleOLE(addr2.address, 100);
      expect(await oleToken.balanceOf(addr2.address)).to.equal(100);
    });

    it("should prevent non-owners from recycling tokens", async function() {
      // Simulate sending tokens to the contract
      await oleToken.transfer(await oleClaim.getAddress(), 500);

      // Attempt to recycle tokens by a non-owner
      await expect(oleClaim.connect(addr1).recycleOLE(addr2.address, 100))
        .to.be.revertedWithCustomError(oleClaim, "OwnableUnauthorizedAccount");
    });
  });

});
