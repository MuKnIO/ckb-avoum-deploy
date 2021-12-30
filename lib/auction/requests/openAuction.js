const { headerLog, stringToHex } = require("../../util")
const { addCellDep, syncIndexer } = require("../../index")
const { addAllCellDeps, createAssetCell, createNoopCellInput,
        makeConsensusCell, makeDefaultTransaction,
        makeEscrowCell, makeInputCell,
        newAvoumId, fulfillTransactionNoSign
      } = require("../../auction/util")
const auctionConfig = require("../config")

// Open Auction Transaction format
// witness0: 0
// input0: assets
// input1..: balance capacity cells
// output0: auction consensus
// output1: auction assets
// output2..: change capacity cells
async function openAuction(indexer, scriptMetaTable) {

    headerLog("Creating Auction Cells")
    await syncIndexer(indexer)

    // Setup cell deps
    let transaction = makeDefaultTransaction(indexer);
    transaction = addAllCellDeps(scriptMetaTable, transaction)

    // Create the initial asset cell, owned by the seller.
    // TODO: Sign with seller lock script.
    const { codehash: noopCodeHash,
            outpoint: noopOutpoint } = scriptMetaTable[auctionConfig.AUCTION_NOOP_LOCK_SCRIPT]
    const assetOutpoint = await createAssetCell(indexer, noopCodeHash, noopOutpoint)

    // Add the asset cell as input
    const assetCellInput = await makeInputCell(assetOutpoint.tx_hash, 0)
	transaction = transaction.update("inputs", (i)=>i.push(assetCellInput));

    // transaction = addCellDep(transaction, {dep_type: "code", out_point: noopOutpoint})

    // Create consensus cell
    // TODO: This needs auction type script.
    let initialBidAmount = 0
    let avoumId = newAvoumId(assetOutpoint, 0)
    let consensusOutput = makeConsensusCell(initialBidAmount, avoumId, scriptMetaTable)
	transaction = transaction.update("outputs", (i)=>i.push(consensusOutput));

    // TODO: This is assets cell, not escrow.
    let escrowOutput = makeEscrowCell(1000n, scriptMetaTable, avoumId)
	transaction = transaction.update("outputs", (i)=>i.push(escrowOutput));

    let balanceInput = await createNoopCellInput(3000, indexer, scriptMetaTable)
	transaction = transaction.update("inputs", (i)=>i.push(balanceInput));
    // transaction = await balanceCapacity(GENESIS_ADDRESS, indexer, transaction)

	// Add in the witness placeholders.
	// transaction = addDefaultWitnessPlaceholders(transaction);

    let bidWitness = "Open"
    bidWitness = JSON.stringify(bidWitness)
    bidWitness = stringToHex(bidWitness)
	transaction = transaction.update("witnesses", w => w.push(bidWitness)) // indicate this is opening tx

    headerLog("Constructed open auction cells")
    const { tx_hash } = await fulfillTransactionNoSign(transaction);

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

module.exports = {
    openAuction
}
