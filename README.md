# Deployment for CKB avoum auction

## Setup

1. Build and copy script binaries into `./bin`.

## To run

1. `node index.js`

## Troubleshooting

If ckb node fails and you wipe it, please remember to update the `config.json` file.

You will also need to purge the indexer cache, grep for `new Indexer(..., <path>)`,
and remove <path>.
