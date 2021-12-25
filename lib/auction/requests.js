// Functions for placing requests:
const { openAuction } = require('./requests/openAuction.js')
const { placeBid } = require('./requests/placeBid.js')
// TODO: Close Auction
module.exports = {
    openAuction,
    placeBid
}
