import { deploy } from '../../../utils/deployment'

export async function deploySubgraphMockContracts() {
  const mockEthUsdAggregator = await deploy(
    'contracts/core/test/EthUsdAggregator.sol:MockEthUsdAggregator',
    []
  )
  console.log('MockEthUsdAggregator deployed: ', mockEthUsdAggregator.target)

  const mockLinkSdlSushiPool = await deploy(
    'contracts/core/test/LinkSdlSushiPool.sol:MockLinkSdlSushiPool',
    []
  )
  console.log('MockLinkSdlSushiPool deployed: ', mockLinkSdlSushiPool.target)

  const mockLinkSdlUniswapPool = await deploy(
    'contracts/core/test/LinkSdlUniswapPool.sol:MockLinkSdlUniswapPool',
    []
  )
  console.log('MockLinkSdlUniswapPool deployed: ', mockLinkSdlUniswapPool.target)

  const mockLinkUsdAggregator = await deploy(
    'contracts/core/test/LinkUsdAggregator.sol:MockLinkUsdAggregator',
    []
  )
  console.log('MockLinkUsdAggregator deployed: ', mockLinkUsdAggregator.target)

  const mockMetisEthUniswapPool = await deploy(
    'contracts/core/test/MetisEthUniswapPool.sol:MockMetisEthUniswapPool',
    []
  )
  console.log('MockMetisEthUniswapPool deployed: ', mockMetisEthUniswapPool.target)
}
