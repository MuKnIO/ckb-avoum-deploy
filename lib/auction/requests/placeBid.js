const { headerLog, stringToHex } = require("../../util")
const { addCellDep, syncIndexer } = require("../../index")
const { createAssetCell, createNoopCellInput,
        makeConsensusCell, makeDefaultTransaction,
        makeEscrowCell, makeInputCell,
        newAvoumId
      } = require("../../auction/util")
const auctionConfig = require("../config")

// TODO: We have elided the keypair argument you see in the test-suite for place_bid.
// This is needed in the real auction, in order to construct bid and refund lock scripts.
// Since we noop everything for contention PoC, this isn't an issue here.
// ----------- Place Bid Transaction formats
//
// ----- Create Bid Cell Transaction
// witness0: Signatures for balance / change cells.
// inputs: Balance Cell(s).
// output0: New Bid Cell, locked with Bid Lock Script
//          N.B. This has to include enough CKB to balance Place Bid Transaction.
//          The other cells in Place Bid Transaction are fixed capacity.
// outputs: Change Cell(s)
//
// ----- Place Bid Transaction
// witness0: Bid { ... } (For Proof of Concept)
// input0: Auction Consensus Cell
// input1: Auction Assets
// input2: New Bid (From the above Create Bid Cell Transaction)
// input3: Old Escrowed Bid
// output0: input0 cell, modified with new bid
// output1: input1 cell, no change.
// output2: input2, lock script swapped to use auction's lock script
// output3: input3 (Old Escrowed Bid), uses refund lock script from old bidder,
//          allows them to retrieve their assets.
async function placeBid(indexer, scriptMetaTable, amount, auctionTxHash) {
    headerLog("Placing bid")
    await syncIndexer(indexer)

    // Create Bid Cell Transaction
    createBidCell(indexer, scriptMetaTable, amount)

    // Extract input cells:
    // 1. Extract cell original consensus cell
    // 2. Extract the original assets
    // 3. Extract old bids.
    let transaction = make_default_transaction(indexer);
    transaction = addCellDep(transaction, {dep_type: "code", out_point: noopOutpoint})

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

module.exports = {
    placeBid
}
