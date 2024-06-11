const { web3 } = require("hardhat");
const { toBN, hexStringToArray } = require("../util/EtheUtil");
const { AbiCoder, ethers } = require("ethers");

const getSign = async (signer, token, user, inviter, signType) => {
  let timestamp = (await web3.eth.getBlock("latest")).timestamp;
  let sign;
  await signer.signMessage(hexStringToArray(ethers.solidityPackedKeccak256(["address", "address", "address", "uint256", "uint256"], [token, user, inviter, timestamp, signType]))).then(result => {
    sign = result;
  });
  return [sign, timestamp];
};

const latestBlockTime = async () => {
  return (await web3.eth.getBlock("latest")).timestamp;
};

function now() {
  return Math.floor(Date.now() / 1000);
}

module.exports = {
  getSign,
  now,
  latestBlockTime
};



