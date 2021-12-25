const {utils, values} = require("@ckb-lumos/base");
const {ckbHash, computeScriptHash} = utils;
const {ScriptValue} = values;
const {initializeConfig} = require("@ckb-lumos/config-manager");
const {addressToScript} = require("@ckb-lumos/helpers");
const {TransactionSkeleton, createTransactionFromSkeleton} = require("@ckb-lumos/helpers");
const {CellCollector} = require("@ckb-lumos/indexer");
const {RPC} = require("ckb-js-toolkit");
const {secp256k1Blake160} = require("@ckb-lumos/common-scripts");
const {sealTransaction} = require("@ckb-lumos/helpers");
const {addDefaultCellDeps, addDefaultWitnessPlaceholders, collectCapacity,
       describeTransactionCore, getLiveCell, indexerReady,
       initializeLumos, initializeLumosIndexer, readFileToHexString, sendTransaction,
       signMessage, signTransaction, syncIndexer,
       waitForTransactionConfirmation,
       waitForConfirmation, DEFAULT_LOCK_HASH} = require("./lib/index.js");
const {ckbytesToShannons, hexToInt, intToHex, intToU128LeHexBytes,
       hexToUint8Array,
       stringToHex, hexToArrayBuffer, u128LeHexBytesToInt, sleep} = require("./lib/util.js");
const sha256 = require('js-sha256');

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


// ----------- Implementation Notes
//
// Balance CKB cells: Used in inputs provide extra capacity to ensure CKB of inputs >= outputs + tx fee.
// Change CKB cells: Used in outputs to take back any remaining CKB in excess to original owner,
//                   change (CKB) = inputs - (outputs + tx fee)

// ----------- Entrypoint

// This is a demo script for running an auction in Nervos under high contention.
async function main()
{
	// Initialize the Lumos Indexer
    const indexer = await initializeLumos();

    // Deploy Code cells
    // scriptMetaTable maps script names so their metadata (outpoint, codehash).
    const scriptMetaTable = await createCodeCells(indexer)


    // Creates auction state cells:
    // 0x0 Auction consensus: state of auction, inclusive of the account id.
    // 0x1 Auction escrow: holds the assets.
    const auctionTx0Hash =
          await openAuction(indexer, scriptMetaTable)

    // const { codehash: noopCodeHash
    //       , outpoint: noopOutpoint } = scriptMetaTable[AUCTION_NOOP_LOCK_SCRIPT]

    // Initial auction bid
    const auctionTx1 =
          await placeBid(indexer, scriptMetaTable, 10, auctionTx0Hash)

    // Failed bid
    // NOTE: With rebase script it should pass through.
    // const auctionTx3 =
    //       await placeBid(indexer, 100, auctionTx0, noopOutpoint, noopCodeHash)

    // TODO: Collate and describe auction end state

    headerLog("DONE")
}

// ----------- Exec

main()
