const {utils, values} = require("@ckb-lumos/base");
const {ckbHash, computeScriptHash} = utils;
const {ScriptValue} = values;
const {addressToScript} = require("@ckb-lumos/helpers");
const {TransactionSkeleton, createTransactionFromSkeleton} = require("@ckb-lumos/helpers");
const {initializeConfig} = require("@ckb-lumos/config-manager");
const {CellCollector} = require("@ckb-lumos/indexer");
const {RPC} = require("ckb-js-toolkit");
const {secp256k1Blake160} = require("@ckb-lumos/common-scripts");
const {sealTransaction} = require("@ckb-lumos/helpers");
const {addCellDep, addDefaultCellDeps, addDefaultWitnessPlaceholders, collectCapacity,
       describeTransactionCore, getLiveCell, indexerReady,
       initializeLumosIndexer, readFileToHexString, sendTransaction,
       signMessage, signTransaction, syncIndexer,
       waitForTransactionConfirmation,
       waitForConfirmation, DEFAULT_LOCK_HASH} = require("../index.js");
const {ckbytesToShannons, hexToInt, intToHex, intToU128LeHexBytes,
       headerLog, hexToUint8Array,
       stringToHex, hexToArrayBuffer, u128LeHexBytesToInt, sleep} = require("../util.js");
const sha256 = require('js-sha256');
const auctionConfig = require('./config')

// Auction utilities

// invoked with index := 0
function newAvoumId(outpoint, index) {
    console.log("avoum_id hex outpoint:", outpoint)
    console.log("avoum_id hex index:", index)
    const tx_hash_hexstring = outpoint.tx_hash
    let tx_hash = [...hexToUint8Array(tx_hash_hexstring)]
    console.log("avoum_id tx_hash:", tx_hash)
    // const outpoint_index_hexstring = outpoint.index
    const outpoint_index_hexstring = "0x00"
    // const outpoint_index = [...hexToUint8Array(outpoint_index_hexstring)]
    const outpoint_index = new Array(4).fill(0)

    console.log("avoum_id outpoint_index:", outpoint_index)
    // index = hexToUint8Array(intToHex(index))
    // index = [...hexToUint8Array("0x00")]
    index = new Array(4).fill(0)
    console.log("avoum_id index:", index)
    let id_u8_array = newAvoumIdInner(tx_hash, outpoint_index, index)
    console.log("avoum_id id_u8_array:", id_u8_array)
    // return { unique_hash : {digest: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] } }
    return { unique_hash: {digest: id_u8_array} }
}

// tx_hash: UInt8Array
// outpoint_index: UInt8Array
// index: UInt8Array
function newAvoumIdInner(tx_hash, outpoint_index, index) {
    var hash = sha256.create()
    hash.update(tx_hash)
    hash.update(outpoint_index)
    hash.update(index)
    const hash_array = hash.array()
    return hash_array
}


function makeBasicCell(amount, scriptHash) {
    const outputCapacity = ckbytesToShannons(amount);
	const lockScript = { args: "0x00", code_hash: scriptHash , hash_type: "data"}
	// const data = intToU128LeHexBytes(100n); // TODO: Construct the entire JSON of the consensus cell.
	const data = "0x00"
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

function codeScriptFromHash(codeHash) {
    let code_hash_ser = new Uint8Array(hexToArrayBuffer(code_hash))
    code_hash_ser = [...code_hash_ser]
    return {
        "args": [0],
        "code_hash": { digest: code_hash_ser },
        "hash_type": 0
    }
}


function makeConsensusData(bid_amount, avoumId, scriptMetaTable) {
    // TODO: Use the actual tx hash
    let seller_lock_script_hash = scriptMetaTable[auctionConfig.AUCTION_NOOP_LOCK_SCRIPT]["codehash"]
    let seller_lock_script = scriptAsJson({ code_hash : seller_lock_script_hash })

    let escrow_lock_script_hash = scriptMetaTable[auctionConfig.AUCTION_ESCROW_LOCK_SCRIPT]["codehash"]
    let escrow_lock_script = scriptAsJson({ code_hash : escrow_lock_script_hash })

    let data = {
        // avoum_id: { unique_hash : {digest: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] } },
        avoum_id: avoumId,
        current_bid: bid_amount,
        deadline_block: 0,
        seller_lock_script,
        escrow_lock_script,
        refund_lock_script: seller_lock_script
    }
    data = JSON.stringify(data)
    return stringToHex(data)
}

function makeConsensusCell(amount, avoumId, scriptMetaTable) {
    const outputCapacity = ckbytesToShannons(1000n); // TODO: Somewhat arbitrary, fit to data size.

    const auctionLockScriptHash = scriptMetaTable[auctionConfig.AUCTION_NOOP_LOCK_SCRIPT]["codehash"]
	const lockScript = { args: "0x00", code_hash: auctionLockScriptHash , hash_type: "data"}

    const auctionTypeScriptHash = scriptMetaTable[auctionConfig.AUCTION_AUCTION_TYPE_SCRIPT]["codehash"]
	const typeScript = { args: "0x00", code_hash: auctionTypeScriptHash , hash_type: "data"}

    const data = makeConsensusData(amount, avoumId, scriptMetaTable)

	const output =
    { cell_output:
      { capacity: intToHex(outputCapacity)
      , lock: lockScript
      , type: typeScript
      }
    , data: data
    };
    return output
}

function makeEscrowCell(amount, scriptMetaTable) {
    const outputCapacity = ckbytesToShannons(amount);

    const escrowLockScriptHash = scriptMetaTable[auctionConfig.AUCTION_ESCROW_LOCK_SCRIPT]["codehash"]
	const lockScript = { args: "0x00", code_hash: escrowLockScriptHash , hash_type: "data"}

	const output =
    { cell_output:
      { capacity: intToHex(outputCapacity)
      , lock: lockScript
      }
    , data: "0x00"
    };
    return output
}

async function createNoopCellInput(amount, indexer, noopOutpoint, noopCodeHash) {
    headerLog("Creating noop cell")
    await syncIndexer(indexer)
    let transaction = makeDefaultTransaction(indexer);
    transaction = addCellDep(transaction, {dep_type: "code", out_point: noopOutpoint})
    const noopCell = makeBasicCell(amount, noopCodeHash)
	transaction = transaction.update("outputs", (i)=>i.push(noopCell));
    transaction = await balanceCapacity(auctionConfig.GENESIS_ADDRESS, indexer, transaction);
    transaction = addDefaultWitnessPlaceholders(transaction)
    const { tx_hash } = await fulfillTransaction(transaction);
    const noopCellInput = makeInputCell(tx_hash, 0);
    headerLog("Created noop cell")
    return noopCellInput
}


async function makeInputCell(transactionHash, index) {
    console.debug("Making input cell from previous Tx: ", transactionHash)
    const out_point = { tx_hash: transactionHash, index: intToHex(index) }
    let rpc = new RPC(auctionConfig.DEFAULT_NODE_URL);
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
    console.debug(input_cell)
    return input_cell
}

// indexer: Use to find cells.
// TODO: Replace noop lockscript with actual lockscript (auction-escrow-lock)
// noopScriptHash: Hash of noop script code
// noopOutpoint: Outpoint of noop lockscript, for use after code cell deployed.
async function createAssetCell(indexer, lockScriptCodeHash, lockScriptOutPoint) {
    console.debug("==== Deploying asset cells")
    await syncIndexer(indexer)

    let transaction = makeDefaultTransaction(indexer);
    transaction = addCellDep(transaction, {dep_type: "code", out_point: lockScriptOutPoint})

	// Create asset cell
	const output = makeBasicCell(1000n, lockScriptCodeHash)
	transaction = transaction.update("outputs", (i)=>i.push(output));

    transaction = await balanceCapacity(auctionConfig.GENESIS_ADDRESS, indexer, transaction)

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
    for (const [scriptName, path] of Object.entries(auctionConfig.scriptPathTable)) {
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

    let transaction = makeDefaultTransaction(indexer)

	// Add output cell.
	const {hexString: hexString1, dataSize: dataSize1} = await readFileToHexString(path);
    const scriptBinaryHash = ckbHash(hexToArrayBuffer(hexString1)).serializeJson()
    console.log("Script (data) binary hash:", scriptBinaryHash)
	const outputCapacity1 = ckbytesToShannons(61n) + ckbytesToShannons(dataSize1);
	const output1 = {cell_output: {capacity: intToHex(outputCapacity1), lock: addressToScript(auctionConfig.GENESIS_ADDRESS), type: null}, data: hexString1};
	transaction = transaction.update("outputs", (i)=>i.push(output1));

    transaction = await balanceCapacity(auctionConfig.GENESIS_ADDRESS, indexer, transaction)

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	// describeTransaction(transaction.toJS());

    const outpoint = await fulfillTransaction(transaction)

	return { outpoint, "codehash": scriptBinaryHash };
}

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
	const signedTx = signTransaction(transaction, auctionConfig.GENESIS_PRIVATE_KEY);

    console.log("\nTransaction signed:")
	// Print the details of the transaction to the console.
	describeTransactionCore(transaction.toJS());

	// Send the transaction to the RPC node.
	const txid = await sendTransaction(auctionConfig.DEFAULT_NODE_URL, signedTx);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(auctionConfig.DEFAULT_NODE_URL, txid);
	console.log(`Transaction Confirmed: ${txid}\n`);

	// Return the out point for the binary so it can be used in the next transaction.
	const outpoint =
	{
		tx_hash: txid,
		index: "0x0" // The first cell in the output is our code cell.
	};

    return outpoint
}

const fulfillTransactionNoSign = async (transactionSkeleton) => {
    const transaction = createTransactionFromSkeleton(transactionSkeleton)
	// Print the details of the transaction to the console.
	describeTransactionCore(transactionSkeleton.toJS());

	// Send the transaction to the RPC node.
	const txid = await sendTransaction(auctionConfig.DEFAULT_NODE_URL, transaction);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(auctionConfig.DEFAULT_NODE_URL, txid);
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
	const signedTx = signTransaction(transaction, auctionConfig.GENESIS_PRIVATE_KEY);

    console.log("\nTransaction signed:")
	// Print the details of the transaction to the console.
	describeTransactionCore(transaction.toJS());

	// Send the transaction to the RPC node.
    const script = 1 // TODO: Replace these
    const indices = [0] // with the actual values
	const txid = await sendTransaction(auctionConfig.DEFAULT_NODE_URL, signedTx, script, indices);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(auctionConfig.DEFAULT_NODE_URL, txid);
	console.log(`Transaction Confirmed: ${txid}\n`);

	// Return the out point for the binary so it can be used in the next transaction.
	const outpoint =
	{
		tx_hash: txid,
		index: "0x0" // The first cell in the output is our code cell.
	};

    return outpoint
}


const makeDefaultTransaction = (indexer) => {
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
const balanceCapacity = async (_input_cells_address, indexer, transaction) => {
	// Determine the capacity from all output Cells.
	const outputCapacity = getCapacity(transaction.outputs)
    console.debug('balanced outputs')
    // Inputs do not have same format as outputs.
	// const currentInputCapacity = getCapacity(transaction.inputs)

	// Add input capacity cells.
	const capacityRequired = outputCapacity + ckbytesToShannons(61n) + auctionConfig.DEFAULT_TX_FEE; // - currentInputCapacity;
	const collectedCells = await collectCapacity(indexer, addressToScript(auctionConfig.GENESIS_ADDRESS), capacityRequired);
	transaction = transaction.update("inputs", (i)=>i.concat(collectedCells.inputCells));

	// Determine the capacity of all input cells.
	const inputCapacity = getCapacity(transaction.inputs)
    console.debug('balanced inputs')

	// Create a change Cell for the remaining CKBytes.
	const changeCapacity = intToHex(inputCapacity - outputCapacity - auctionConfig.DEFAULT_TX_FEE);
	let change = {cell_output: {capacity: changeCapacity, lock: addressToScript(auctionConfig.GENESIS_ADDRESS), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (i)=>i.push(change));
    return transaction
}

async function initializeContext() {
	// configuration which is held in config.json.
	initializeConfig();

	// Start the Lumos Indexer and wait until it is fully synchronized.
	headerLog("Initializing Indexer")
	const indexer = await initializeLumosIndexer(auctionConfig.DEFAULT_NODE_URL);
	headerLog("Initialized Indexer")

    // Deploy Code cells
    // scriptMetaTable maps script names so their metadata (outpoint, codehash).
    const scriptMetaTable = await createCodeCells(indexer)

    // Setup scriptMetaTable
	return { indexer, scriptMetaTable }
}

function addAllCellDeps(scriptMetaTable, transaction) {
    for (const [_scriptName, {outpoint}] of Object.entries(scriptMetaTable)) {
        transaction = addCellDep(transaction, {dep_type: "code", out_point: outpoint})
    }
    return transaction
}


module.exports = {
    balanceCapacity,
    createAssetCell,
    createNoopCellInput,
    fulfillTransactionNoSign,
    getCapacity,
    initializeContext,
    makeBasicCell,
    makeConsensusCell,
    makeDefaultTransaction,
    makeEscrowCell,
    makeInputCell,
    newAvoumId,
    scriptAsJson,
}
