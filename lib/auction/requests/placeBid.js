const { headerLog, stringToHex, jsonToHex } = require("../../util")
const { addCellDep, syncIndexer } = require("../../index")
const { codeScriptFromHash, createAssetCell, createNoopCellInput,
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

    // ----- Create Bid Cell Transaction start

    const prevTx = rpc.getTransaction(auctionTxHash)
                      .transaction
    const prevTxData = prevTx
          .outputs_data[0] // Returns hexstring
    const prevAuctionState = hexToJson(prevTxData)
    console.log(prevAuctionState)

    const avoum_id = prevAuctionState.avoum_id


    headerLog("Creating Bid Cell")
    // Create Bid Cell Transaction
    // TODO: Use public key and sig lock to construct refund lock script.
    const refundLockScript = codeScriptFromHash(scriptMetaTable[AUCTION_NOOP_LOCK_SCRIPT])
    const publicKey = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]

    const bidRequest = createBidRequest(refundLockScript, publicKey)

    const bidCell = createBidCell(scriptMetaTable, avoum_id, publicKey, bidRequest, amount)
    headerLog("Constructed Bid Cell")

    let bidTransaction = make_default_transaction(indexer)
    bidTransaction = addAllCellDeps(scriptMetaTable, bidTransaction)

    // Add outputs
    bidTransaction = bidTransaction.update("outputs", o => o.push(bidCell))

    // Autocomplete
    bidTransaction = await balanceCapacity(0, indexer, bidTransaction)
    bidTransaction = addDefaultWitnessPlaceholders(bidTransaction)
    const { bid_tx_hash } = await fulfillTransaction(bidTransaction);

    const bidCellOutpoint = {
        tx_hash: bid_tx_hash
        index: "0x0"
    }

    headerLog("Created Bid Cell output")

    // ----- Create Bid Cell Transaction complete
     
    // ----- Place Bid Transaction Start

    // let newAuctionState = prevAuctionState
    // newAuctionState["current_bid"] = amount
    // newAuctionState["refund_lock_script"] = refundLockScript

    // Setup tx with cell deps
    let transaction = make_default_transaction(indexer);
    transaction = addAllCellDeps(scriptMetaTable, transaction)

    // Include inputs in index order
    const previousConsensusInput = makeInputCell(auctionTxHash, 0)
    transaction = transaction.update("inputs", i => i.push(previousConsensusInput))
    const auctionAssetsInput = makeInputCell(auctionTxHash, 1)
    transaction = transaction.update("inputs", i => i.push(auctionAssetsInput))
    const newBidInput = makeInputCell(bid_tx_hash, 0)
    transaction = transaction.update("inputs", i => i.push(newBidInput))

    if (prevTx.outputs.length >= 4) { // Include old bid cell if there was previous bid
        const oldBidInput = makeInputCell(auctionTxHash, 2)
        transaction = transaction.update("inputs", i => i.push(oldBidInput))
    }

    // Include outputs in index order
    const consensusCell = makeConsensusCell(amount, avoum_id, scriptMetaTable)
    transaction = transaction.update("outputs", i => i.push(consensusCell))
    const assetsCell = outputFromInput(auctionAssetsInput)
    transaction = transaction.update("outputs", i => i.push(assetsCell))
    const escrowedBidCell = makeEscrowed(bidCell)
    transaction = transaction.update("outputs", i => i.push(escrowedBidCell))
    const refundCell = makeCell(oldEscrowedBidCell.capacity, refundLockScript)

    // Include witness
    const bidRequest = createBidRequest(refundLockScript)
    const bidWitness = jsonToHex(bidRequest)
	transaction = transaction.update("witnesses", w => w.push(bidWitness)) // indicate this is a new bid
    console.log("number of witnesses: ", transaction.get("witnesses").toArray().length)

    const { tx_hash } = await fulfillMalleableTransaction(transaction);

    headerLog("Placed bid")
    return tx_hash
}

function createBidLockData(scriptMetaTable, avoum_id, pub_key, bidRequest) {
    return {
        request_hash: hashFromData(bidRequest),
        auction_script: scriptAsJson(scriptMetaTable[AUCTION_NOOP_LOCK_SCRIPT]["codehash"]),
        avoum_id,
        pub_key // TODO: what JSON form is this in?
    }
}

function createBidLockScript(scriptMetaTable, avoum_id, pub_key, bidRequest) {
    const args = createBidLockData(scriptMetaTable, avoum_id, pub_key, bidRequest)
    const lockHash = scriptMetaTable["AUCTION_BID_LOCK_SCRIPT"]
    return {
        args,
        code_hash,
        "hash_type": 0
    }
}

function createBidCell(scriptMetaTable, avoum_id, pub_key, bidRequest, amount) {
    const data = "0x00"
    const lockScript = createBidLockScript(scriptMetaTable, avoum_id, pub_key, bidRequest)
    const output =
          {
              cell_output:
              { capacity: intToHex(amount), // TODO: Probably need to factor in tx fee somehow...
                lock: lockScript
              }
          , data
          }
    return output
}

function createBidRequest(refundScript, publicKey) {
    return {
        "Bid": {
            "refund_lock_script": scriptAsJson(refundScript),
            "retract_key": publicKey
        }
    }
}

// FIXME: Use bid lock script instead of noop lock script.
function createRefundLockScript(lockScriptHash, publicKey) {
    return { args: "0x00", code_hash: lockScriptHash , hash_type: "data"}
}

module.exports = {
    placeBid
}
