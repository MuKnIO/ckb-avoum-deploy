const {utils, values} = require("@ckb-lumos/base");
const {ckbHash, computeScriptHash} = utils;
const {ScriptValue} = values;
const {initializeConfig} = require("@ckb-lumos/config-manager");
const {addressToScript} = require("@ckb-lumos/helpers");
const {TransactionSkeleton} = require("@ckb-lumos/helpers");
const {CellCollector} = require("@ckb-lumos/indexer");
const {secp256k1Blake160} = require("@ckb-lumos/common-scripts");
const {sealTransaction} = require("@ckb-lumos/helpers");
const {addDefaultCellDeps, addDefaultWitnessPlaceholders, collectCapacity,
       describeTransaction: libDescribeTransaction, getLiveCell, indexerReady,
       initializeLumosIndexer,
       readFileToHexString, sendTransaction, signMessage, signTransaction,
       syncIndexer,
       waitForConfirmation, DEFAULT_LOCK_HASH} = require("./lib/index.js");
const {ckbytesToShannons, hexToInt, intToHex, intToU128LeHexBytes,
       hexToArrayBuffer, u128LeHexBytesToInt, sleep} = require("./lib/util.js");

// ----------- Deploying and Running the auction interaction under high-contention
//
// == Prerequisite readings ==
//
// Transaction structure:
// https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0022-transaction-structure/0022-transaction-structure.md
//
// Script:
// https://docs.nervos.org/docs/reference/script
//
// Script Code / Cell data hash:
// https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0022-transaction-structure/0022-transaction-structure.md


// ----------- Config

const DEFAULT_NODE_URL = "http://127.0.0.1:8114/";
const ALICE_PRIVATE_KEY = "0x81dabf8f74553c07999e1400a8ecc4abc44ef81c9466e6037bd36e4ad1631c17";
const ALICE_ADDRESS = "ckt1qyq2a6ymy7fjntsc2q0jajnmljt690g4xpdsyw4k5f";

const GENESIS_PRIVATE_KEY = "0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc";
const GENESIS_ADDRESS = "ckt1qyqvsv5240xeh85wvnau2eky8pwrhh4jr8ts8vyj37";

const AUCTION_BID_LOCK_SCRIPT = "AUCTION_BID_LOCK_SCRIPT"
const AUCTION_ESCROW_LOCK_SCRIPT = "AUCTION_ESCROW_LOCK_SCRIPT"
const AUCTION_SIG_LOCK_SCRIPT = "AUCTION_SIG_LOCK_SCRIPT"
const AUCTION_AUCTION_TYPE_SCRIPT = "AUCTION_AUCTION_TYPE_SCRIPT"
const AUCTION_NOOP_LOCK_SCRIPT = "AUCTION_NOOP_LOCK_SCRIPT"

// This is the TX fee amount that will be paid in Shannons.
const DEFAULT_TX_FEE = 100_000n

const scriptPathTable = {
    AUCTION_BID_LOCK_SCRIPT: "./bin/avoum-auction-bid-lock",
    AUCTION_ESCROW_LOCK_SCRIPT: "./bin/avoum-auction-escrow-lock",
    AUCTION_SIG_LOCK_SCRIPT: "./bin/avoum-auction-sig-lock",
    AUCTION_AUCTION_TYPE_SCRIPT: "./bin/avoum-auction-type",
    AUCTION_NOOP_LOCK_SCRIPT: "./bin/avoum-noop-lock"
}


// ----------- Entrypoint


// This is a demo script for running an auction in Nervos under high contention.
async function main()
{
	// Initialize the Lumos configuration which is held in config.json.
	initializeConfig();

	// Start the Lumos Indexer and wait until it is fully synchronized.
	header_log("Initializing Indexer")
	const indexer = await initializeLumosIndexer(DEFAULT_NODE_URL);
	header_log("Initialized Indexer")

    // Deploy code cells
    header_log("Deploying all code cells")
    const scriptMetaTable = await createCodeCells(indexer) // Returns metadata of scripts (outpoints, script hash)
                                                     // Which are used in later steps
    header_log("Deployed all code cells")
    console.log("Script Metadata:")
    console.debug(JSON.stringify(scriptMetaTable, null, 2))

    // console.debug("==== Deploying asset cells")
    // let assetOutpoint = createAssetCell(indexer, outpoints)
    // outpoints['assets'] = assetOutpoint
    // console.debug("==== Deployed asset cells")

    // console.debug("==== Deploying initial contract state cells")
    // let {consensusOutpoint, assetsOutpoint} =
    //     createInitialContractStateCells(indexer, outpoints)
    // console.debug("==== Deployed initial contract state cells")
}


// indexer: Use to find cells.
// outpoints: Input live cell outpoints
// async function createAssetCells(indexer, input_outpoints) {
//     	// Create a transaction skeleton.
// 	let transaction = TransactionSkeleton({cellProvider: indexer});

// 	// Add the cell deps (noop script, )
// 	transaction = addDefaultCellDeps(transaction);
// 	const cellDep = {dep_type: "code", out_point: scriptCodeOutPoint};
// 	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));

// 	// Create asset cell
// 	const outputCapacity1 = ckbytesToShannons(1000n);
// 	const lockScript1 = { args: "0x0", code_hash: "" }
// 	const data1 = intToU128LeHexBytes(100n); // TODO: maybe use a proper asset?
// 	const output1 = {cell_output: {capacity: intToHex(outputCapacity1), lock: lockScript1, type: null}, data: data1};
// 	transaction = transaction.update("outputs", (i)=>i.push(output1));

// 	// Determine the capacity from all output Cells.
// 	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cell_output.capacity), 0n);

// 	// Add input capacity cells.
// 	const capacityRequired = outputCapacity + ckbytesToShannons(61n) + DEFAULT_TX_FEE;
// 	const collectedCells = await collectCapacity(indexer, addressToScript(ALICE_ADDRESS), capacityRequired);
// 	transaction = transaction.update("inputs", (i)=>i.concat(collectedCells.inputCells));

// 	// Determine the capacity of all input cells.
// 	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cell_output.capacity), 0n);

// 	// Create a change Cell for the remaining CKBytes.
// 	const changeCapacity = intToHex(inputCapacity - outputCapacity - DEFAULT_TX_FEE);
// 	let change = {cell_output: {capacity: changeCapacity, lock: addressToScript(ALICE_ADDRESS), type: null}, data: "0x"};
// 	transaction = transaction.update("outputs", (i)=>i.push(change));

// 	// Add in the witness placeholders.
// 	transaction = addDefaultWitnessPlaceholders(transaction);

// 	// Print the details of the transaction to the console.
// 	describeTransaction(transaction.toJS());

// 	// Validate the transaction against the lab requirements.
// 	await validateLab(transaction, "create");

// 	// Sign the transaction.
// 	const signedTx = signTransaction(transaction, ALICE_PRIVATE_KEY);

// 	// Send the transaction to the RPC node.
// 	const txid = await sendTransaction(DEFAULT_NODE_URL, signedTx);
// 	console.log(`Transaction Sent: ${txid}\n`);

// 	// Wait for the transaction to confirm.
// 	await waitForTransactionConfirmation(DEFAULT_NODE_URL, txid);
// 	console.log("\n");
// }

// async function createInitialContractStateCells(indexer, outpoints) {

//     // Must wait for indexer to sync
//     await syncIndexer(indexer)

// 	// Create a transaction skeleton.
// 	let transaction = TransactionSkeleton({cellProvider: indexer});

// 	// Add the cell deps:
//     // TODO: What scripts do we need???
// 	transaction = addDefaultCellDeps(transaction);
// 	const cellDep = {dep_type: "code", out_point: scriptCodeOutPoint};
// 	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));

// 	// Create asset cells
// 	const outputCapacity = ckbytesToShannons(1000n);
// 	const lockScript = null; // TODO: escrow lockscript
//     const typeScript = null; // TODO: auction typescript.
// 	// const typeScript1 =
// 	// 	{
// 	// 		code_hash: dataFileHash1,
// 	// 		hash_type: "data",
// 	// 		args: lockScriptHashAlice
// 	// 	};
// 	// 	const data1 = intToU128LeHexBytes(addressTokenPair[1]);
// 	const output = {cell_output: {capacity: intToHex(outputCapacity), lock: lockScript, type: typeScript}, data: data};
// 	transaction = transaction.update("outputs", (i)=>i.push(output));

// 	// Determine the capacity from all output Cells.
// 	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cell_output.capacity), 0n);

// 	// Add input capacity cells.
// 	const capacityRequired = outputCapacity + ckbytesToShannons(61n) + DEFAULT_TX_FEE;
// 	const collectedCells = await collectCapacity(indexer, addressToScript(ALICE_ADDRESS), capacityRequired);
// 	transaction = transaction.update("inputs", (i)=>i.concat(collectedCells.inputCells));

// 	// Determine the capacity of all input cells.
// 	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cell_output.capacity), 0n);

// 	// Create a change Cell for the remaining CKBytes.
// 	const changeCapacity = intToHex(inputCapacity - outputCapacity - DEFAULT_TX_FEE);
// 	let change = {cell_output: {capacity: changeCapacity, lock: addressToScript(ALICE_ADDRESS), type: null}, data: "0x"};
// 	transaction = transaction.update("outputs", (i)=>i.push(change));

// 	// Add in the witness placeholders.
// 	transaction = addDefaultWitnessPlaceholders(transaction);

// 	// Print the details of the transaction to the console.
// 	describeTransaction(transaction.toJS());

// 	// Validate the transaction against the lab requirements.
// 	await validateLab(transaction, "create");

// 	// Sign the transaction.
// 	const signedTx = signTransaction(transaction, ALICE_PRIVATE_KEY);

// 	// Send the transaction to the RPC node.
// 	const txid = await sendTransaction(DEFAULT_NODE_URL, signedTx);
// 	console.log(`Transaction Sent: ${txid}\n`);

// 	// Wait for the transaction to confirm.
// 	await waitForTransactionConfirmation(DEFAULT_NODE_URL, txid);
// 	console.log("\n");
// }

// ----------- Internals

// indexer: [indexer] - lumos indexer instance
// returns: Map scriptName { outpoint: [Outpoint], codehash: [CodeHash] }
//          e.g. { "AUCTION_BID_LOCK_SCRIPT": { outpoint: "0x123...", codehash: "0x456..." }
//               , ...
//               }
const createCodeCells = async (indexer) => {
     const scriptMetaTable = {};

    // deploy all code cells.
    for (const [scriptName, path] of Object.entries(scriptPathTable)) {
        console.log("Deploying code cell: ", scriptName)
        const metadata = await createCodeCell(indexer, path)
        scriptMetaTable[scriptName] = metadata
        console.log("Deployed code cell: ", scriptName)
    }
    return scriptMetaTable
}

// indexer: [indexer] - lumos indexer instance
// path: [string] - path to script code binary
// returns: { outpoint: [Outpoint] - Transaction and index used to locate the code cell
//          , codehash: [CodeHash] - Codehash used to other cells reference the script code in celldeps
//          }
// NOTE: We produce a Script Code cell, NOT a Script cell.
// See the distinction: https://docs.nervos.org/docs/reference/script
const createCodeCell = async (indexer, path) => {
    await syncIndexer(indexer)

    let transaction = make_default_transaction(indexer)

	// Add output cell.
	const {hexString: hexString1, dataSize: dataSize1} = await readFileToHexString(path);
    const scriptBinaryHash = ckbHash(hexToArrayBuffer(hexString1)).serializeJson()
	const outputCapacity1 = ckbytesToShannons(61n) + ckbytesToShannons(dataSize1);
	const output1 = {cell_output: {capacity: intToHex(outputCapacity1), lock: addressToScript(ALICE_ADDRESS), type: null}, data: hexString1};
	transaction = transaction.update("outputs", (i)=>i.push(output1));

	// Add input cells.
	const collectedCells = await collectCapacity(indexer, addressToScript(GENESIS_ADDRESS), outputCapacity1 + ckbytesToShannons(61n) + DEFAULT_TX_FEE);
	transaction = transaction.update("inputs", (i)=>i.concat(collectedCells.inputCells));

    const inputCapacity = getCapacity(transaction.inputs)
    const outputCapacity = getCapacity(transaction.outputs)

	// Add output change Cell for the remaining CKBytes.
	const changeCapacity = intToHex(inputCapacity - outputCapacity - DEFAULT_TX_FEE);
	let change = {cell_output: {capacity: changeCapacity, lock: addressToScript(GENESIS_ADDRESS), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (i)=>i.push(change));

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	// describeTransaction(transaction.toJS());

	// Sign the transaction.
	const signedTx = signTransaction(transaction, GENESIS_PRIVATE_KEY);

    console.log("Create code cells: Transaction signed")
	describeTransaction(transaction.toJS());

	// Send the transaction to the RPC node.
	// process.stdout.write("Setup Transaction Sent: ");
	const txid = await sendTransaction(DEFAULT_NODE_URL, signedTx);
	console.log("\n Transaction id: ", txid);

    console.log("\nCreate code cells: Transaction sent")
	await waitForConfirmation(DEFAULT_NODE_URL, txid, (_status)=>process.stdout.write("."), {recheckMs: 1_000});
    console.log("\nCreate code cells: Transaction confirmed")

	// Return the out point for the binary so it can be used in the next transaction.
	const outpoint =
	{
		tx_hash: txid,
		index: "0x0" // The first cell in the output is our code cell.
	};

	return { outpoint, "codehash": scriptBinaryHash };
}

// ----------- Library functions

const make_default_transaction = (indexer) => {
    	// Create a transaction skeleton.
	let transaction = TransactionSkeleton({cellProvider: indexer});

	// Add the cell dep for the lock script.
	transaction = addDefaultCellDeps(transaction);
    return transaction
}

// cells := transaction.inputs | transaction.outputs
const getCapacity = (cells) => cells.toArray().reduce((a, c)=>a+hexToInt(c.cell_output.capacity), 0n)

// ----------- Utilities

const header_log = (s) => {
    console.debug("\n" + "====" + s + "\n")
}

function describeTransaction(transaction)
{
	const options =
	{
		showCellDeps: true,
		showInputs: true,
		showInputType: true,
		showInputData: true,
		showOutputs: true,
		showOutputType: true,
		showOutputData: true,
		showWitnesses: false
	};

	return libDescribeTransaction(transaction, options);
}

// ----------- Exec

main()
