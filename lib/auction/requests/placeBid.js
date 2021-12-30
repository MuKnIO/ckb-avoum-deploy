const {RPC} = require("ckb-js-toolkit");
const { headerLog, stringToHex, jsonToHex, hexToJson, intToHex } = require("../../util")
const { addCellDep, addDefaultWitnessPlaceholders, syncIndexer  } = require("../../index")
const { addAllCellDeps, balanceCapacity,
        codeScriptFromHash, createAssetCell, createNoopCellInput,
        fulfillTransaction, hashFromData,
        makeConsensusCell, makeDefaultTransaction,
        makeEscrowCell, makeInputCell,
        newAvoumId, scriptAsJson
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
    const rpc = new RPC(auctionConfig.DEFAULT_NODE_URL);
    headerLog("Placing bid")
    await syncIndexer(indexer)

    // ----- Create Bid Cell Transaction start

    const prevTxWithStatus = await rpc.get_transaction(auctionTxHash)
    console.log("auction tx with status: ", prevTxWithStatus)
    const prevTx = prevTxWithStatus.transaction
    console.log("auction tx: ", prevTx)
    const prevTxData = prevTx
          .outputs_data[0] // Returns hexstring
    const prevAuctionState = hexToJson(prevTxData)
    console.log("previous auction state: ", prevAuctionState)

    const avoum_id = prevAuctionState.avoum_id


    headerLog("Creating Bid Cell")
    // Create Bid Cell Transaction
    // TODO: Use public key and sig lock to construct refund lock script.
    const refundLockScript = codeScriptFromHash(scriptMetaTable[auctionConfig.AUCTION_NOOP_LOCK_SCRIPT]["codehash"])
    const publicKey = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
    console.log("refund Lock Script:", refundLockScript)

    const bidRequest = createBidRequest(refundLockScript, publicKey)

    const bidCell = createBidCell(scriptMetaTable, avoum_id, publicKey, bidRequest, amount)
    headerLog("Constructed Bid Cell")
    console.log(bidCell)

    let bidTransaction = makeDefaultTransaction(indexer)
    bidTransaction = addAllCellDeps(scriptMetaTable, bidTransaction)

    // Add outputs
    bidTransaction = bidTransaction.update("outputs", o => o.push(bidCell))

    // Autocomplete
    bidTransaction = await balanceCapacity(0, indexer, bidTransaction)
    bidTransaction = addDefaultWitnessPlaceholders(bidTransaction)
    const { bid_tx_hash } = await fulfillTransaction(bidTransaction);

    const bidCellOutpoint = {
        tx_hash: bid_tx_hash,
        index: "0x0"
    }

    headerLog("Created Bid Cell output")

    // ----- Create Bid Cell Transaction complete
     
    // ----- Place Bid Transaction Start

    // let newAuctionState = prevAuctionState
    // newAuctionState["current_bid"] = amount
    // newAuctionState["refund_lock_script"] = refundLockScript

    // Setup tx with cell deps
    let transaction = makeDefaultTransaction(indexer);
    transaction = addAllCellDeps(scriptMetaTable, transaction)

    // Include inputs in index order
    const previousConsensusInput = await makeInputCell(auctionTxHash, 0)
    console.log("Previous consensus cell input:", previousConsensusInput)
    transaction = transaction.update("inputs", i => i.push(previousConsensusInput))
    const auctionAssetsInput = await makeInputCell(auctionTxHash, 1)
    transaction = transaction.update("inputs", i => i.push(auctionAssetsInput))
    const newBidInput = await makeInputCell(bid_tx_hash, 0)
    transaction = transaction.update("inputs", i => i.push(newBidInput))

    if (prevTx.outputs.length >= 4) { // Include old bid cell if there was previous bid
        const oldBidInput = makeInputCell(auctionTxHash, 2)
        transaction = transaction.update("inputs", i => i.push(oldBidInput))
    }

    // Include outputs in index order
    const consensusCell = makeConsensusCell(amount, avoum_id, scriptMetaTable)
    console.log("Consensus cell output: ", consensusCell)
    transaction = transaction.update("outputs", i => i.push(consensusCell))

    const assetsCell = auctionAssetsInput
    transaction = transaction.update("outputs", i => i.push(assetsCell))

    const escrowedBidCell = makeEscrowed(bidCell, scripts[AUCTION_ESCROW_LOCK_SCRIPT].script)
    transaction = transaction.update("outputs", i => i.push(escrowedBidCell))

    const refundCell = makeCell(oldEscrowedBidCell.capacity, refundLockScript)
    transaction = transaction.update("outputs", i => i.push(refundCell))

    // Include witness
    const bidWitness = jsonToHex(bidRequest)
	transaction = transaction.update("witnesses", w => w.push(bidWitness)) // indicate this is a new bid
    console.log("number of witnesses: ", transaction.get("witnesses").toArray().length)

    const { tx_hash } = await fulfillMalleableTransaction(transaction)

    headerLog("Placed bid")
    return tx_hash
}

function makeEscrowed(prevOutputCell, escrowLockScript) {
    console.log("making escrowed for: ", prevOutputCell)
    const escrowedCellOutput = { ...prevOutputCell, lock: escrowLockScript }
    return escrowedCellOutput
}

function createBidLockData(scriptMetaTable, avoum_id, pub_key, bidRequest) {
    const data = {
        request_hash: hashFromData(bidRequest),
        auction_script: codeScriptFromHash(scriptMetaTable[auctionConfig.AUCTION_NOOP_LOCK_SCRIPT]["codehash"]),
        avoum_id,
        pub_key // TODO: what JSON form is this in?
    }
    return jsonToHex(data)
}
// 4,190,100,000,000
//    54_400_000_000
function createBidLockScript(scriptMetaTable, avoum_id, pub_key, bidRequest) {
    const args = createBidLockData(scriptMetaTable, avoum_id, pub_key, bidRequest)
    console.log("Bid Lock data length: ", args.length)
    const code_hash = scriptMetaTable["AUCTION_BID_LOCK_SCRIPT"]["codehash"]
    return {
        args,
        code_hash,
        "hash_type": 'data'
    }
}

function createBidCell(scriptMetaTable, avoum_id, pub_key, bidRequest, amount) {
    const data = "0x"
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
