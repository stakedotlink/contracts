# stake.link Liquid Staking Protocol

stake.link is a Liquid Staking protocol, built initially for the Chainlink Network with upcoming support for Ethereum
2.0's beacon chain. stake.link consists of the highest-quality node operators and validators to ensure a seamless and
secure way to put tokens to stake.

## Chainlink

By building on top of Chainlink Staking stake.link offers a way for users to stake their LINK across Chainlink Node
Operators and in-future the wider community pool, receiving stLINK, the liquid staking receipt token that rebases
rewards. stLINK is always backed by the amount of LINK staked 1:1.

## Ethereum 2.0

stake.link proposes a unique way of liquid staking within the Ethereum ecosystem, by allowing both reputable and
self-hosted validators to participate in the same pool. By the way of governance, any self-hosted validator has the
opportunity to raise a proposal to become a whitelisted reputable validator removing the need for the validator to
provide collateral by being performant.

Users who stake their ETH within the stake.link protocol will in return receive sdlETH, the liquid staking receipt token
that is backed by staked ETH on the beacon chain 1:1. Users who stake ETH will see their tokens buffered, being
distributed between validators who are either whitelisted or non-whitelisted, with all users receiving a blended reward
rate between the two.

## Technical Documentation

For more detailed technical documentation:

https://docs.stake.link/

---

## I. Setup Locally

### Requirements

- [Yarn](https://github.com/yarnpkg/yarn)
- [Node Version Manager, i.e., nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

### Use node v22

```bash
$ nvm install 22
$ nvm use 22
```

### Install dependencies

```bash
$ yarn
```

### Hardhat configuration

1. Set env vars `MAINNET_RPC_URL` and `POLYGON_RPC_URL` for the networks you would like to connect to, and `ETHERSCAN_API_KEY` for contract verification
2. To sign deployments and scripts with a Ledger, add its address to `ledgerAccounts` in `hardhat.config.ts`
3. Set env var `HARDHAT_NETWORK` (or pass `--network`) to the network you want to deploy to and/or interact with (default is `localhost`)

## II. Running Locally

To run a local hardhat node, run:

```bash
$ yarn start
```

To run a local hardhat node, deploy all contracts, and send a series of transactions that mock user behaviour, run:

```bash
$ yarn start-test-env
```

To do the same against a node that is already running, run:

```bash
$ yarn deploy
$ yarn setup-test-env
```

Deployed addresses are written to `deployments/localhost.json`.

## III. Deploying Contracts

Production deployment and upgrade scripts live in `scripts/prod`, grouped by product and release. To run one against a network, run:

```bash
$ npx hardhat run scripts/prod/<product>/<release>/<script>.ts --network mainnet
```

Deployed addresses are recorded in `deployments/<network>.json`.

## IV. Testing

To run all contract tests, run:

```bash
$ yarn test
```

To generate a coverage report in `coverage/`, run:

```bash
$ yarn test --coverage
```
