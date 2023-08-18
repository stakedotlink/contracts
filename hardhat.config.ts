import { HardhatUserConfig } from 'hardhat/config'
import '@nomiclabs/hardhat-ethers'
import '@typechain/hardhat'
import '@nomiclabs/hardhat-waffle'
import '@openzeppelin/hardhat-upgrades'
import '@nomiclabs/hardhat-etherscan'

const balance = '100000000000000000000000'
const accounts = [
  'c3381a96fa2be2aae2f2798e0887272e634417710aa09ecad9328754cdc8db8a', //0x11187eff852069a33d102476b2E8A9cc9167dAde
  '33a3d35ee3408a701f0ff775390ede800f728562ed656ec0036f9e4fd96e7d5b', //0x2228bdc8584595DfefA75597C96B13c00a2D88C2
  'fd52fbad9cb1258e30e6f83d1f2ecb2f6702887c1444d968133f41f3edb3f566', //0x33375555d73620FefD26cD083c425759a259FA18
  '73026645a77a51ebd812fd8780137f9b532a43cfadf379d1882dbfe5046bbff9', //0x444485D3d01447da706550B1c10362676193CAd0
  '73c8d46d8610c89d3f727fdd18099d9a142878bf5e010e65ba9382b8bb030b06', //0x555f27995D7BB56c989d7C1cA4e5e03e930ecA67
  '630c184b1bb553100f94dc0dc8234b9334e0bf2e5595f83b1c494e09d5f5713a', //0xccc41e903D40e13bC87eE29413219d33a1161f72
  'd9afa4025b9a827bc0e1024e156283df7e4eb1fabf1dd9469b1912cb1bb1069c', //0x65079BB3f085240f1AFCBb3E4188afE93c194b84
  'c3b3b1292886ac39c82bcbfec23fc0e44f257c23d9d75292f382ee02dedb45b4', //0x777E071fE919B6e6b750B5384c92c4d782aD7A66
]

const config: HardhatUserConfig = {
  defaultNetwork: 'localhost',
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545',
      accounts,
    },
    rinkeby: {
      url: '',
      accounts,
    },
    ropsten: {
      url: '',
      accounts,
    },
    mainnet: {
      url: 'http://localhost:1248',
      accounts: 'remote',
      timeout: 600000,
    },
    testnet: {
      url: '',
      accounts,
    },
    hardhat: {
      chainId: 1337,
      accounts: accounts.map((acct) => ({ privateKey: acct, balance })),
      mining: {
        auto: true,
        interval: 5000,
      },
    },
  },
  etherscan: {
    apiKey: '',
  },
  solidity: {
    compilers: [
      {
        version: '0.8.15',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.6.11',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
}

export default config
