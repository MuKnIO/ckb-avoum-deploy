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
       initializeLumosIndexer, readFileToHexString, sendTransaction,
       signMessage, signTransaction, syncIndexer,
       waitForTransactionConfirmation,
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
	// Initialize the Lumos Indexer
    const indexer = await initializeLumos();

    // Deploy Code cells
    // scriptMetaTable is a map between script names (see Config section above),
    // and their metadata (outpoints, codehash).
    const scriptMetaTable = await createCodeCells(indexer)
    const { codehash: noopCodeHash
          , outpoint: noopOutpoint } = scriptMetaTable[AUCTION_NOOP_LOCK_SCRIPT]

    // Creates the initial asset cell, owned by the seller.
    const assetOutpoint = await createAssetCell(indexer, noopCodeHash, noopOutpoint)

    // Creates auction state cells:
    // - Auction consensus: state of auction
    // - Auction escrow: holds the assets.
    const auctionTx0 =
          await createAuctionCells(indexer, assetOutpoint, noopOutpoint, noopCodeHash)

    // Initial auction bid
    const auctionTx1 =
          await placeBid(indexer, 10, auctionTx0)

    // Failed bid
    // NOTE: With rebase script it should pass through.
    const auctionTx3 =
          await placeBid(indexer, 100, auctionTx0)

    // Collate and describe auction end state
    // TODO: Change these to reference outpoint2 namespace.
    // after rebase has been integrated into RPC and syscalls.
    // const currentBidCellData = fetchCurrentBidData(indexer, auctionTx3)

    // printBidCellData(current_bid)

    headerLog("DONE")
}

// ----------- Internals

async function initializeLumos() {
    // configuration which is held in config.json.
	initializeConfig();

	// Start the Lumos Indexer and wait until it is fully synchronized.
	headerLog("Initializing Indexer")
	const indexer = await initializeLumosIndexer(DEFAULT_NODE_URL);
	headerLog("Initialized Indexer")
    return indexer
}

async function fetchCurrentBid(indexer, consensusOutpoint, escrowOutpoint, bidOutpoint) {
    const currentBidOutpoint =
          await fetchCurrentBidOutpoint(indexer, consensusOutpoint, escrowOutpoint);
    return currentBidOutpoint
}

async function fetchCurrentBidOutpoint(indexer, consensusOutpoint, escrowOutpoint) {
    await syncIndexer(indexer)
    headerLog("Fetching bid outpoint")
    headerLog("Fetched bid outpoint")
    return null
}

// TODO: Consume assetOutpoint
async function createAuctionCells(indexer, assetOutpoint, noopOutpoint, noopCodeHash) {
    headerLog("Creating Auction Cells")
    await syncIndexer(indexer)

    let transaction = make_default_transaction(indexer);
    transaction = addCellDeps(transaction, {dep_type: "code", out_point: noopOutpoint})

    // Create consensus cell
    // TODO: This needs auction type script.
    let consensusOutput = makeBasicCell(1000n, noopCodeHash)
	transaction = transaction.update("outputs", (i)=>i.push(consensusOutput));

    let escrowOutput = makeBasicCell(1000n, noopCodeHash)
	transaction = transaction.update("outputs", (i)=>i.push(escrowOutput));

    transaction = await balanceCapacity(GENESIS_ADDRESS, indexer, transaction)

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

    const { tx_hash } = await fulfillTransaction(transaction);

    // NOTE: This is left out, because it is expected encoding,
    // the type script will perform a check to ensure the tx
    // is in this exact format,
    // hence we can just grab the tx hash, and expect that its outpoints
    // will be indexed as such:
    // const consensusOutpoint = { tx_hash, index: "0x00" } // TODO: Is this the correct consensus outpoint???
    // const escrowOutpoint = { tx_hash, index: "0x01" } // TODO: Is this correct format??? hmm...
    headerLog("Created Auction Cells")
    return tx_hash
}

function makeBasicCell(amount, scriptHash) {
    const outputCapacity = ckbytesToShannons(1000n);
	const lockScript = { args: "0x00", code_hash: scriptHash , hash_type: "data"}
	const data = intToU128LeHexBytes(100n); // TODO: Construct the entire JSON of the consensus cell.
	const output =
    { cell_output:
      { capacity: intToHex(outputCapacity)
      , lock: lockScript, type: null // TODO: Add auction type script.
      }
    , data: data
    };
    return output
}
// TODO: Once rebase script is in, this should call `send_transaction`,
// with the rebase_script and cell indices parameters.
// TODO: We have elided the keypair argument you see in the test-suite for place_bid.
// This is needed in the real auction, in order to construct bid and refund lock scripts.
// Since we noop everything for contention PoC, this isn't an issue here.
async function placeBid(indexer, amount, auctionTxHash) {
    headerLog("Placing bid")
    await syncIndexer(indexer)
    const consensusOutpoint = null
    const escrowOutpoint = null
    headerLog("Placed bid")
    return "0x1234"
}

// indexer: Use to find cells.
// TODO: Replace noop lockscript with actual lockscript (auction-escrow-lock)
// noopScriptHash: Hash of noop script code
// noopOutpoint: Outpoint of noop lockscript, for use after code cell deployed.
async function createAssetCell(indexer, noopCodeHash, noopOutpoint) {
    console.debug("==== Deploying asset cells")
    await syncIndexer(indexer)

    let transaction = make_default_transaction(indexer);
    transaction = addCellDeps(transaction, {dep_type: "code", out_point: noopOutpoint})

	// Create asset cell
	const output = makeBasicCell(1000n, noopCodeHash)
	transaction = transaction.update("outputs", (i)=>i.push(output));

    transaction = await balanceCapacity(GENESIS_ADDRESS, indexer, transaction)

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

    const outpoint = await fulfillTransaction(transaction);
    console.debug("==== Deployed asset cells")
    return outpoint
}

// indexer: [indexer] - lumos indexer instance
// returns: Map scriptName { outpoint: [Outpoint], codehash: [CodeHash] }
//          e.g. { "AUCTION_BID_LOCK_SCRIPT": { outpoint: "0x123...", codehash: "0x456..." }
//               , ...
//               }
const createCodeCells = async (indexer) => {
    headerLog("Deploying all code cells")

    const scriptMetaTable = {};

    // deploy all code cells.
    for (const [scriptName, path] of Object.entries(scriptPathTable)) {
        console.log("Deploying code cell: ", scriptName)
        const metadata = await createCodeCell(indexer, path)
        scriptMetaTable[scriptName] = metadata
        console.log("Deployed code cell: ", scriptName)
    }

    headerLog("Deployed all code cells")
    console.log("Script Metadata:")
    console.debug(JSON.stringify(scriptMetaTable, null, 2))

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

    transaction = await balanceCapacity(GENESIS_ADDRESS, indexer, transaction)

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	// describeTransaction(transaction.toJS());

    const outpoint = await fulfillTransaction(transaction)

	return { outpoint, "codehash": scriptBinaryHash };
}

// ----------- Library functions

const addCellDeps = (transaction, cellDep) =>
      transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep))

// Signs, sends and waits for transaction confirmation
const fulfillTransaction = async (transaction) => {
	// Sign the transaction.
	const signedTx = signTransaction(transaction, GENESIS_PRIVATE_KEY);

    console.log("\nTransaction signed:")
	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Send the transaction to the RPC node.
	const txid = await sendTransaction(DEFAULT_NODE_URL, signedTx);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(DEFAULT_NODE_URL, txid);
	console.log(`Transaction Confirmed: ${txid}\n`);

	// Return the out point for the binary so it can be used in the next transaction.
	const outpoint =
	{
		tx_hash: txid,
		index: "0x0" // The first cell in the output is our code cell.
	};

    return outpoint
}

const make_default_transaction = (indexer) => {
    	// Create a transaction skeleton.
	let transaction = TransactionSkeleton({cellProvider: indexer});

	// Add the cell dep for the lock script.
	transaction = addDefaultCellDeps(transaction);
    return transaction
}

// cells := transaction.inputs | transaction.outputs
const getCapacity = (cells) => cells.toArray().reduce((a, c)=>a+hexToInt(c.cell_output.capacity), 0n)

// input_cells_address : [Address] - Address from which we retrieve live inputs
// indexer: [Indexer]
// transaction: [Transaction] - Partially fulfilled transaction, only with outputs.
// Balances the transaction by computing required input capacity,
// indexing and retrieving the necessary amount of
// input cells from `input_cells_address`,
// producing output cells with necessary amount of change,
// and updating the transaction with these cells.
const balanceCapacity = async (input_cells_address, indexer, transaction) => {
	// Determine the capacity from all output Cells.
	const outputCapacity = getCapacity(transaction.outputs)

	// Add input capacity cells.
	const capacityRequired = outputCapacity + ckbytesToShannons(61n) + DEFAULT_TX_FEE;
	const collectedCells = await collectCapacity(indexer, addressToScript(GENESIS_ADDRESS), capacityRequired);
	transaction = transaction.update("inputs", (i)=>i.concat(collectedCells.inputCells));

	// Determine the capacity of all input cells.
	const inputCapacity = getCapacity(transaction.inputs)

	// Create a change Cell for the remaining CKBytes.
	const changeCapacity = intToHex(inputCapacity - outputCapacity - DEFAULT_TX_FEE);
	let change = {cell_output: {capacity: changeCapacity, lock: addressToScript(GENESIS_ADDRESS), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (i)=>i.push(change));
    return transaction
}

// ----------- Utilities

const headerLog = (s) => {
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
