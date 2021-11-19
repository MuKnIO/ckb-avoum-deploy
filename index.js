const {utils, values} = require("@ckb-lumos/base");
const {computeScriptHash} = utils;
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
       waitForConfirmation, DEFAULT_LOCK_HASH} = require("./lib/index.js");
const {ckbytesToShannons, hexToInt, intToHex, intToU128LeHexBytes,
       u128LeHexBytesToInt} = require("./lib/util.js");

const nodeUrl = "http://127.0.0.1:8114/";
const ALICE_PRIVATE_KEY = "0x81dabf8f74553c07999e1400a8ecc4abc44ef81c9466e6037bd36e4ad1631c17";
const ALICE_ADDRESS = "ckt1qyq2a6ymy7fjntsc2q0jajnmljt690g4xpdsyw4k5f";

const GENESIS_PRIVATE_KEY = "0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc";
const GENESIS_ADDRESS = "ckt1qyqvsv5240xeh85wvnau2eky8pwrhh4jr8ts8vyj37";

const binary_paths = [
    "./bin/avoum-auction-bid-lock",
    "./bin/avoum-auction-escrow-lock",
    "./bin/avoum-auction-sig-lock",
    "./bin/avoum-auction-type",
    "./bin/avoum-noop-lock"
];

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


const createCodeCells = (indexer) => async (path) => {
    // This is the TX fee amount that will be paid in Shannons.
    const txFee = 100_000n;

	// Create a transaction skeleton.
	let transaction = TransactionSkeleton({cellProvider: indexer});

	// Add the cell dep for the lock script.
	transaction = addDefaultCellDeps(transaction);

	// Create a cell with data from the specified file.
	const {hexString: hexString1, dataSize: dataSize1} = await readFileToHexString(path);
	const outputCapacity1 = ckbytesToShannons(61n) + ckbytesToShannons(dataSize1);
	const output1 = {cell_output: {capacity: intToHex(outputCapacity1), lock: addressToScript(ALICE_ADDRESS), type: null}, data: hexString1};
	transaction = transaction.update("outputs", (i)=>i.push(output1));
	// Add input capacity cells.
	const collectedCells = await collectCapacity(indexer, addressToScript(GENESIS_ADDRESS), outputCapacity1 + ckbytesToShannons(61n) + txFee);
	transaction = transaction.update("inputs", (i)=>i.concat(collectedCells.inputCells));

	// Determine the capacity of all input cells.
	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cell_output.capacity), 0n);
	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cell_output.capacity), 0n);

	// Create a change Cell for the remaining CKBytes.
	const changeCapacity = intToHex(inputCapacity - outputCapacity - txFee);
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
	const txid = await sendTransaction(nodeUrl, signedTx);
	process.stdout.write(txid);

    console.log("\nCreate code cells: Transaction sent")
	// Wait for the transaction to confirm.
	// process.stdout.write("Now setting up Cells for lab exercise. Please wait.");
	await waitForConfirmation(nodeUrl, txid, (_status)=>process.stdout.write("."), {recheckMs: 1_000});
	// console.log("\n");

    console.log("\nCreate code cells: Transaction confirmed")
	// Return the out point for the binary so it can be used in the next transaction.
	const outPoint =
	{
		tx_hash: txid,
		index: "0x0"
	};

    console.log("Outpoint is: ", txid);

	return outPoint;

}

// This is a demo script for running an auction in Nervos under high contention.
async function main()
{
	// Initialize the Lumos configuration which is held in config.json.
	initializeConfig();

	// Start the Lumos Indexer and wait until it is fully synchronized.
	const indexer = await initializeLumosIndexer(nodeUrl);

	console.debug("==== initialized indexer");

	await indexerReady(indexer);

    // deploy all code cells.
    for (let i = 0; i < binary_paths.length; i++) {
        const p = binary_paths[i]
        console.log("deploy code cell: ", p)
        await createCodeCells(indexer)(p)
    }

    // deploy all intiial contract state cells.

    // Run a
}

main()
