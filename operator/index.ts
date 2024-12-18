import { ethers } from "ethers";
import * as dotenv from "dotenv";
const fs = require('fs');
const path = require('path');
dotenv.config();

// Check if the process.env object is empty
if (!Object.keys(process.env).length) {
    throw new Error("process.env object is empty");
}

// Setup env variables
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
let chainId = process.env.CHAIN_ID!;

const avsDeploymentData = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../contracts/deployments/hello-world/${chainId}.json`), 'utf8'));
// Load core deployment data
const coreDeploymentData = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../contracts/deployments/core/${chainId}.json`), 'utf8'));


const delegationManagerAddress = coreDeploymentData.addresses.delegation; // todo: reminder to fix the naming of this contract in the deployment file, change to delegationManager
const avsDirectoryAddress = coreDeploymentData.addresses.avsDirectory;
const helloWorldServiceManagerAddress = avsDeploymentData.addresses.helloWorldServiceManager;
const ecdsaStakeRegistryAddress = avsDeploymentData.addresses.stakeRegistry;


// Load ABIs
const delegationManagerABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/IDelegationManager.json'), 'utf8'));
const ecdsaRegistryABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/ECDSAStakeRegistry.json'), 'utf8'));
const helloWorldServiceManagerABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/HelloWorldServiceManager.json'), 'utf8'));
const avsDirectoryABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abis/IAVSDirectory.json'), 'utf8'));

// Initialize contract objects from ABIs
const delegationManager = new ethers.Contract(delegationManagerAddress, delegationManagerABI, wallet);
const helloWorldServiceManager = new ethers.Contract(helloWorldServiceManagerAddress, helloWorldServiceManagerABI, wallet);
const ecdsaRegistryContract = new ethers.Contract(ecdsaStakeRegistryAddress, ecdsaRegistryABI, wallet);
const avsDirectory = new ethers.Contract(avsDirectoryAddress, avsDirectoryABI, wallet);


const signAndRespondToTask = async (taskIndex: number, taskCreatedBlock: number, taskName: string) => {
    const message = "Hello World";
    const messageHash = ethers.solidityPackedKeccak256(["string"], [message]);
    const eip191prefix= "\x19Ethereum Signed Message:\n32";
    const ethMessageHash1 = ethers.solidityPackedKeccak256(["string",'bytes32'], [eip191prefix, messageHash]);
    console.log("ethMessageHash1: ", ethMessageHash1);
    const ethMessageHash = ethers.hashMessage(message);
    const signature = await wallet.signMessage(ethMessageHash);
    const walletAddress = await wallet.getAddress();
    const operators = [walletAddress];
    const signatures = [signature];
    const blockNumber = await provider.getBlockNumber() - 1;
    console.log("walletAddress: ", walletAddress); 
    console.log("blockNumber: ", blockNumber);
    console.log("signature: ", signature);
    const signedTask = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address[]", "bytes[]", "uint32"],
        [operators, signatures, blockNumber]
    );
    
    console.log("signature encoded data: ", signedTask);
    // console.log("regular messageHash: ", messageHash);
    console.log("signature data: ", signature);
    // console.log("stringSignature: ", stringSignature);
    const tx = await ecdsaRegistryContract.isValidSignature(ethMessageHash, signedTask);
    await tx.wait();
    console.log(`Responded to task.`);
};

const submitSignature = async (message: string) => {
    const messageHash = ethers.solidityPackedKeccak256(["string"], [message]);
    const messageBytes = ethers.getBytes(messageHash);
    const signature = await wallet.signMessage(messageBytes);
    const operators = [await wallet.getAddress()];
    const signatures = [signature];
    const signatureData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address[]", "bytes[]", "uint32"],
        [operators, signatures, ethers.toBigInt(await provider.getBlockNumber()-1)]
    );

    const tx = await ecdsaRegistryContract.isValidSignature(messageHash, signatureData);
    await tx.wait();
};


const registerOperator = async () => {
    const isOperator = await delegationManager.isOperator(await wallet.address);
    if (!isOperator) {
            // Registers as an Operator in EigenLayer.
        try {
            const tx1 = await delegationManager.registerAsOperator({
                __deprecated_earningsReceiver: await wallet.address,
                delegationApprover: "0x0000000000000000000000000000000000000000",
                stakerOptOutWindowBlocks: 0
            }, "");
            await tx1.wait();
            console.log("Operator registered to Core EigenLayer contracts");
        } catch (error) {
            console.error("Error in registering as operator:", error);
        }

    } else {
        console.log("Operator already registered, skipping registration");
    }
    
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const expiry = Math.floor(Date.now() / 1000) + 3600; // Example expiry, 1 hour from now

    // Define the output structure
    let operatorSignatureWithSaltAndExpiry = {
        signature: "",
        salt: salt,
        expiry: expiry
    };

    // Calculate the digest hash, which is a unique value representing the operator, avs, unique value (salt) and expiration date.
    const operatorDigestHash = await avsDirectory.calculateOperatorAVSRegistrationDigestHash(
        wallet.address, 
        await helloWorldServiceManager.getAddress(), 
        salt, 
        expiry
    );
    console.log(operatorDigestHash);
    
    // Sign the digest hash with the operator's private key
    console.log("Signing digest hash with operator's private key");
    const operatorSigningKey = new ethers.SigningKey(process.env.PRIVATE_KEY!);
    const operatorSignedDigestHash = operatorSigningKey.sign(operatorDigestHash);

    // Encode the signature in the required format
    operatorSignatureWithSaltAndExpiry.signature = ethers.Signature.from(operatorSignedDigestHash).serialized;

    console.log("Registering Operator to AVS Registry contract");

    
    // Register Operator to AVS
    // Per release here: https://github.com/Layr-Labs/eigenlayer-middleware/blob/v0.2.1-mainnet-rewards/src/unaudited/ECDSAStakeRegistry.sol#L49
    const tx2 = await ecdsaRegistryContract.registerOperatorWithSignature(
        operatorSignatureWithSaltAndExpiry,
        wallet.address
    );
    const receipt = await tx2.wait();
    console.log("Operator registered on AVS successfully");
};

const monitorNewTasks = async () => {
    //console.log(`Creating new task "EigenWorld"`);
    //await helloWorldServiceManager.createNewTask("EigenWorld");

    helloWorldServiceManager.on("NewTaskCreated", async (taskIndex: number, task: any) => {
        console.log(`New task detected: Hello, ${task.name}`);
        await signAndRespondToTask(taskIndex, task.taskCreatedBlock, task.name);
    });

    console.log("Monitoring for new tasks...");
};

const main = async () => {
    // await registerOperator();
    await signAndRespondToTask(0, 0, "Hello World");
    // await monitorNewTasks();
};

main().catch((error) => {
    console.error("Error in main function:", error);
});