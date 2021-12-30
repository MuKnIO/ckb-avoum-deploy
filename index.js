const { initializeLumos } = require('./lib/index')
const auctionRequests = require('./lib/auction/requests')
const auctionUtils = require('./lib/auction/util')

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
    const { indexer, scriptMetaTable } = await auctionUtils.initializeContext();

    // Creates auction state cells:
    // 0x0 Auction consensus: state of auction, inclusive of the account id.
    // 0x1 Auction escrow: holds the assets.
    const auctionTx0Hash =
          await auctionRequests.openAuction(indexer, scriptMetaTable)

    // Initial auction bid
    const auctionTx1 =
          await auctionRequests.placeBid(indexer, scriptMetaTable, 100_000_000_000, auctionTx0Hash)

    // Failed bid
    // NOTE: With rebase script it should pass through.
    // const auctionTx3 =
    //       await placeBid(indexer, 100, auctionTx0, noopOutpoint, noopCodeHash)

    // TODO: Collate and describe auction end state

    headerLog("DONE")
}

// ----------- Exec

main()
