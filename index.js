const {utils, values} = require("@ckb-lumos/base");
const {ckbHash, computeScriptHash} = utils;
const {ScriptValue} = values;
const {initializeConfig} = require("@ckb-lumos/config-manager");
const {addressToScript} = require("@ckb-lumos/helpers");
const {TransactionSkeleton} = require("@ckb-lumos/helpers");
const {CellCollector} = require("@ckb-lumos/indexer");
const {RPC} = require("ckb-js-toolkit");
const {secp256k1Blake160} = require("@ckb-lumos/common-scripts");
const {sealTransaction} = require("@ckb-lumos/helpers");
const {addDefaultCellDeps, addDefaultWitnessPlaceholders, collectCapacity,
       describeTransaction: libDescribeTransaction, getLiveCell, indexerReady,
       initializeLumosIndexer, readFileToHexString, sendTransaction,
       signMessage, signTransaction, syncIndexer,
       waitForTransactionConfirmation,
       waitForConfirmation, DEFAULT_LOCK_HASH} = require("./lib/index.js");
const {ckbytesToShannons, hexToInt, intToHex, intToU128LeHexBytes,
       stringToHex, hexToArrayBuffer, u128LeHexBytesToInt, sleep} = require("./lib/util.js");

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

    // Create the initial asset cell, owned by the seller.
    const assetOutpoint = await createAssetCell(indexer, noopCodeHash, noopOutpoint)

    // Creates auction state cells:
    // 0x0 Auction consensus: state of auction, inclusive of the account id.
    // 0x1 Auction escrow: holds the assets.
    const auctionTx0 =
          await createAuctionCells(indexer, assetOutpoint, noopOutpoint, noopCodeHash)

    // Initial auction bid
    const auctionTx1 =
          await placeBid(indexer, 10, auctionTx0, noopOutpoint, noopCodeHash)

    // Failed bid
    // NOTE: With rebase script it should pass through.
    const auctionTx3 =
          await placeBid(indexer, 100, auctionTx0, noopOutpoint, noopCodeHash)

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
    let consensusOutput = makeConsensusCell(1, noopCodeHash)
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

function scriptAsJson(script) {
    let code_hash_ser = new Uint8Array(hexToArrayBuffer(script.code_hash))
    code_hash_ser = [...code_hash_ser]
    console.log(code_hash_ser)
    return {
        "args": [0],
        "code_hash": { digest: code_hash_ser },
        "hash_type": 0
    }
}

function makeConsensusData(new_bid, script) {
    script = scriptAsJson(script)
    let data = {
        avoum_id: { unique_hash : {digest: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] } },
        current_bid: new_bid,
        deadline_block: 0,
        seller_lock_script: script,
        escrow_lock_script: script,
        refund_lock_script: script
    }
    data = JSON.stringify(data)
    return stringToHex(data)
}

function makeConsensusCell(amount, scriptHash) {
    const outputCapacity = ckbytesToShannons(1000n);
	const lockScript = { args: "0x00", code_hash: scriptHash , hash_type: "data"}
    // Construct the account id, the first 32bytes of data.
	// const data = "0x01020304050607080910" + "11121314151617181920" + "21222324252627282930" + "3132"
    const data = makeConsensusData(amount, lockScript)
	const output =
    { cell_output:
      { capacity: intToHex(outputCapacity)
      , lock: lockScript
      , type: lockScript
      }
    , data: data
    };
    return output
}

async function createNoopCellInput(amount, indexer, noopOutpoint, noopCodeHash) {
    headerLog("Creating noop cell")
    let transaction = make_default_transaction(indexer);
    transaction = addCellDeps(transaction, {dep_type: "code", out_point: noopOutpoint})
    const noopCell = makeBasicCell(amount, noopCodeHash)
	transaction = transaction.update("outputs", (i)=>i.push(noopCell));
    transaction = await balanceCapacity(GENESIS_ADDRESS, indexer, transaction);
    transaction = addDefaultWitnessPlaceholders(transaction)
    const { tx_hash } = await fulfillTransaction(transaction);
    const noopCellInput = makeInputCell(tx_hash, 0);
    headerLog("Created noop cell")
    return noopCellInput
}


// TODO: Once rebase script is in, this should call `send_transaction`,
// with the rebase_script and cell indices parameters.
// TODO: We have elided the keypair argument you see in the test-suite for place_bid.
// This is needed in the real auction, in order to construct bid and refund lock scripts.
// Since we noop everything for contention PoC, this isn't an issue here.
async function placeBid(indexer, amount, auctionTxHash, noopOutpoint, noopCodeHash) {
    headerLog("Placing bid")
    await syncIndexer(indexer)

    // Extract input cells:
    // 1. Extract cell original consensus cell
    // 2. Extract the original assets
    // 3. Extract old bids.
    let transaction = make_default_transaction(indexer);
    transaction = addCellDeps(transaction, {dep_type: "code", out_point: noopOutpoint})

    const consensusCellInput = await makeInputCell(auctionTxHash, 0)
    const assetsCellInput = await makeInputCell(auctionTxHash, 1)

    // const consensusLiveCellOutput = old_tx.outputs[0]
    // const consensusLiveCell = { cell_output:  }
    // console.log(consensusLiveCell)
    // const assetsLiveCell = old_tx.outputs[1]
    // console.log(assetsLiveCell)

    const consensusOutpoint = { "tx_hash": auctionTxHash, "index": "0x0" }
    transaction = transaction
        .update("inputs", (i)=>i.push(consensusCellInput))
    transaction = transaction
        .update("inputs", (i)=>i.push(assetsCellInput))
    const noopCellInput = await createNoopCellInput(10, indexer, noopOutpoint, noopCodeHash)
    transaction = transaction
        .update("inputs", (i)=>i.push(noopCellInput))
    const noopCellInput2 = await createNoopCellInput(2000, indexer, noopOutpoint, noopCodeHash)
    transaction = transaction
        .update("inputs", (i)=>i.push(noopCellInput2))
    // If this doesn't work maybe we need to update the LiveCells we use to have OutPoints as well.
    //
	// transaction = transaction
    //     .update("inputs", (i)=>i
    //             .push({ "previous_output": consensusOutpoint, "since": "0x0" }));
    // const assetsOutpoint = { "tx_hash": auctionTxHash, "index": "0x1" }
	// transaction = transaction
    //     .update("inputs", (i)=>i
    //             .push({ "previous_output": assetsOutpoint, "since": "0x1"}));
    // FIXME: Check if there's old bids
    // const oldBidsOutpoint = { "tx_hash": auctionTxHash, "index": "0x02" }
	// transaction = transaction.update("inputs", (i)=>i.push(oldBidsOutpoint));

    // Create output cells with:
    // 1. Cell with New auction consensus, with new state of auction.
    const newConsensusOutpoint = makeConsensusCell(amount, noopCodeHash)
	transaction = transaction.update("outputs", (i)=>i.push(newConsensusOutpoint));
    // 2. Cell with new assets, with a lock script allowing access only by the auction.
    const newAssetsOutpoint = makeBasicCell(amount, noopCodeHash)
	transaction = transaction.update("outputs", (i)=>i.push(newAssetsOutpoint));
    // 3. Cell with new bid, locked for use by auction
    const newBidOutpoint = makeBasicCell(amount, noopCodeHash)
	transaction = transaction.update("outputs", (i)=>i.push(newBidOutpoint));
    // 4. Cell owned by previous bidder... why do we need this?
    const oldBidOutpoint = makeBasicCell(amount, noopCodeHash)
	transaction = transaction.update("outputs", (i)=>i.push(oldBidOutpoint));

    transaction = await balanceCapacity(GENESIS_ADDRESS, indexer, transaction);

    transaction = addDefaultWitnessPlaceholders(transaction)
    const refund_script = { args: "0x00", code_hash: noopCodeHash , hash_type: "data"}
    let bidWitness = { "Bid": { "refund_lock_script": scriptAsJson(refund_script), "retract_key": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] } }
    bidWitness = JSON.stringify(bidWitness)
    bidWitness = stringToHex(bidWitness)
	transaction = transaction.update("witnesses", w => w.push(bidWitness)) // indicate this is a new bid
    console.log("number of witnesses: ", transaction.get("witnesses").toArray().length)
	// transaction = transaction.update("witnesses", w => w.push("0x01")) // indicate this is a new bid
	// transaction = transaction.update("witnesses", w => w.push("0x00"))

    const { tx_hash } = await fulfillMalleableTransaction(transaction);
    //    Because of capacity?
    // TODO Ask why we need this.
    // For now it's good enough to dump 1-3.
    headerLog("Placed bid")
    return "0x1234"
}

async function makeInputCell(transactionHash, index) {
    console.debug("Making input cell from previous Tx: ", transactionHash)
    const out_point = { tx_hash: transactionHash, index: intToHex(index) }
    let rpc = new RPC(DEFAULT_NODE_URL);
    let { transaction: old_tx } = await rpc.get_transaction(transactionHash);
    const prev_cell_output = old_tx.outputs[index];
    const prev_cell_data = old_tx.outputs_data[index];
    const input_cell = {
        cell_output: prev_cell_output,
        data: prev_cell_data,
        out_point
        // TODO: block_hash, block_number do we need these??
    }
    console.debug("Constructed input cell:")
    // console.debug(input_cell)
    return input_cell
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
	const output1 = {cell_output: {capacity: intToHex(outputCapacity1), lock: addressToScript(GENESIS_ADDRESS), type: null}, data: hexString1};
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
// NOTE:
// The argument `transaction` is not in the proper form yet.
// This calls `signTransaction` -> `sealTransaction` -> `createTransactionFromSkeleton`,
// which takes the transaction object,
// and transforms it into the JSON transaction object
// which the rpc expects.
// You can see the definition of `createTransaction` to see the rough structure,
// and conversion of the skeleton object to the rpc object.
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

const fulfillMalleableTransaction = async (transaction) => {
	// Sign the transaction.
	const signedTx = signTransaction(transaction, GENESIS_PRIVATE_KEY);

    console.log("\nTransaction signed:")
	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Send the transaction to the RPC node.
    const script = 1 // TODO: Replace these
    const indices = [0] // with the actual values
	const txid = await sendTransaction(DEFAULT_NODE_URL, signedTx, script, indices);
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
const getCapacity = (cells) => {
    // console.debug(cells.toArray())
    return cells.toArray().reduce((a, c)=>a+hexToInt(c.cell_output.capacity), 0n)
}

// input_cells_address : [Address] - Address from which we retrieve live inputs
// indexer: [Indexer]
// transaction: [Transaction] - Partially fulfilled transaction, only with outputs.
// Balances the transaction by computing required input capacity,
// indexing and retrieving the necessary amount of
// input cells from `input_cells_address`,
// producing output cells with necessary amount of change,
// and updating the transaction with these cells.
// FIXME: We should have a counterpart which balances with unlocked cells for fast prototyping.
const balanceCapacity = async (input_cells_address, indexer, transaction) => {
	// Determine the capacity from all output Cells.
	const outputCapacity = getCapacity(transaction.outputs)
    console.debug('balanced outputs')
    // Inputs do not have same format as outputs.
	// const currentInputCapacity = getCapacity(transaction.inputs)

	// Add input capacity cells.
	const capacityRequired = outputCapacity + ckbytesToShannons(61n) + DEFAULT_TX_FEE; // - currentInputCapacity;
	const collectedCells = await collectCapacity(indexer, addressToScript(GENESIS_ADDRESS), capacityRequired);
	transaction = transaction.update("inputs", (i)=>i.concat(collectedCells.inputCells));

	// Determine the capacity of all input cells.
	const inputCapacity = getCapacity(transaction.inputs)
    console.debug('balanced inputs')

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
