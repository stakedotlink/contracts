import { updateDeployments, getContract, deploy } from '../../../utils/deployment'

// Chainlink price feeds on Ethereum mainnet
const linkUSDFeed = '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c' // LINK/USD
const usdcUSDFeed = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6' // USDC/USD

async function main() {
  const wsdToken = await getContract('LINK_WrappedSDToken')

  const underlyingAdapter = await deploy(
    'contracts/core/integrations/WLSTUnderlyingChainlinkPriceAdapter.sol:WLSTUnderlyingChainlinkPriceAdapter',
    [wsdToken.target]
  )
  console.log('LINK_WLSTUnderlyingChainlinkPriceAdapter deployed: ', underlyingAdapter.target)

  const usdcAdapter = await deploy(
    'contracts/core/integrations/WLSTUSDCChainlinkPriceAdapter.sol:WLSTUSDCChainlinkPriceAdapter',
    [wsdToken.target, linkUSDFeed, usdcUSDFeed]
  )
  console.log('LINK_WLSTUSDCChainlinkPriceAdapter deployed: ', usdcAdapter.target)

  updateDeployments(
    {
      LINK_WLSTUnderlyingChainlinkPriceAdapter: underlyingAdapter.target,
      LINK_WLSTUSDCChainlinkPriceAdapter: usdcAdapter.target,
    },
    {
      LINK_WLSTUnderlyingChainlinkPriceAdapter: 'WLSTUnderlyingChainlinkPriceAdapter',
      LINK_WLSTUSDCChainlinkPriceAdapter: 'WLSTUSDCChainlinkPriceAdapter',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
