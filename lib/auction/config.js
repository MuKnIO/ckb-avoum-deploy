const DEFAULT_NODE_URL = "http://127.0.0.1:8114/";
const ALICE_PRIVATE_KEY = "0x81dabf8f74553c07999e1400a8ecc4abc44ef81c9466e6037bd36e4ad1631c17";
const ALICE_ADDRESS = "ckt1qyq2a6ymy7fjntsc2q0jajnmljt690g4xpdsyw4k5f";

const GENESIS_PRIVATE_KEY = "0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc";
const GENESIS_ADDRESS = "ckt1qyqvsv5240xeh85wvnau2eky8pwrhh4jr8ts8vyj37";

// Script Names
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

module.exports = {
    DEFAULT_NODE_URL,
    ALICE_PRIVATE_KEY,
    ALICE_ADDRESS,
    GENESIS_PRIVATE_KEY,
    GENESIS_ADDRESS,

    AUCTION_BID_LOCK_SCRIPT,
    AUCTION_ESCROW_LOCK_SCRIPT,
    AUCTION_SIG_LOCK_SCRIPT,
    AUCTION_AUCTION_TYPE_SCRIPT,
    AUCTION_NOOP_LOCK_SCRIPT,

    DEFAULT_TX_FEE,

    scriptPathTable
}
