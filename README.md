# Staking Contracts v2

Provisions contracts for stake.link

**Table of contents**

- [I. Setup Locally](#I-Setup-Locally)
- [II. Running Locally](#II-Running-Locally)
- [III. Deploying Contracts](#III-Deploying-Contracts)
- [IV. Testing](#IV-Testing)

## I. Setup Locally

### Requirements

- [Yarn](https://github.com/yarnpkg/yarn)
- [Node Version Manager, i.e., nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

### Use node v14.17.4

```bash
$ nvm install 14.17.4
$ nvm use 14.17.4
```

### Install dependencies

```bash
$ yarn
```

### Hardhat configuration

1. Inside `hardhat.config.ts`, add a provider url to the networks object for each network you would like to connect to
2. Also replace `accounts[0]` with the private key of the address you will be using for contract deployments and running scripts
3. Set env var `HARDHAT_NETWORK` to the network you want to deploy to and/or interact with (default is `localhost`)

## II. Running Locally

To run hardhat and deploy all contracts, run:

```bash
$ yarn start
```

To run hardhat, deploy all contracts, and send a series of transactions that mock user behaviour, run:

```bash
$ yarn start-mock-data
```

## III. Deploying Contracts

The following commands can be used both on local and non-local networks.

To deploy all contracts to the currently selected network, run:

```bash
$ yarn deploy
```

To deploy only a subset of contracts (see [here](https://github.com/wighawag/hardhat-deploy#deploy-scripts-tags-and-dependencies) for details), run:

```bash
$ yarn deploy --tags <tags>
```

## IV. Testing

To run all contract tests, run:

```bash
$ yarn test
```

To generate events for metrics testing, run:

```bash
$ yarn luv-deyta
```
