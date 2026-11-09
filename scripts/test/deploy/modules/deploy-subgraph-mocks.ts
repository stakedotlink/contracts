import { deploy, updateDeployments } from '../../../utils/deployment'

export async function deploySubgraphMockContracts() {
  const mockEthUsdAggregator = await deploy(
    'contracts/core/test/subgraphMocks/EthUsdAggregator.sol:MockEthUsdAggregator',
    []
  )
  console.log('MockEthUsdAggregator deployed: ', mockEthUsdAggregator.target)

  const mockLinkSdlSushiPool = await deploy(
    'contracts/core/test/subgraphMocks/LinkSdlSushiPool.sol:MockLinkSdlSushiPool',
    []
  )
  console.log('MockLinkSdlSushiPool deployed: ', mockLinkSdlSushiPool.target)

  const mockLinkSdlUniswapPool = await deploy(
    'contracts/core/test/subgraphMocks/LinkSdlUniswapPool.sol:MockLinkSdlUniswapPool',
    []
  )
  console.log('MockLinkSdlUniswapPool deployed: ', mockLinkSdlUniswapPool.target)

  const mockLinkUsdAggregator = await deploy(
    'contracts/core/test/subgraphMocks/LinkUsdAggregator.sol:MockLinkUsdAggregator',
    []
  )
  console.log('MockLinkUsdAggregator deployed: ', mockLinkUsdAggregator.target)

  updateDeployments(
    {
      mockEthUsdAggregator: mockEthUsdAggregator.target,
      mockLinkSdlSushiPool: mockLinkSdlSushiPool.target,
      mockLinkSdlUniswapPool: mockLinkSdlUniswapPool.target,
      mockLinkUsdAggregator: mockLinkUsdAggregator.target,
    },
    {
      mockEthUsdAggregator: 'mockEthUsdAggregator',
      mockLinkSdlSushiPool: 'mockLinkSdlSushiPool',
      mockLinkSdlUniswapPool: 'mockLinkSdlUniswapPool',
      mockLinkUsdAggregator: 'mockLinkUsdAggregator',
    }
  )
}
