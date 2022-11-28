export const config = {
  LPLMigration: {
    depositAmount: 50000000,
  },

  StakingAllowance: {
    name: 'Stake Dot Link',
    symbol: 'SDL',
    initialSupply: 220000000,
  },
  DelegatorPool: {
    derivativeTokenName: 'Staked SDL',
    derivativeTokenSymbol: 'stSDL',
  },
  FlatFee: {
    feeBasisPoints: 0,
  },

  LINK_WrappedSDToken: {
    name: 'Wrapped stLINK',
    symbol: 'wstLINK',
  },
  LINK_StakingPool: {
    derivativeTokenName: 'Staked LINK',
    derivativeTokenSymbol: 'stLINK',
    fees: [['0x11187eff852069a33d102476b2E8A9cc9167dAde', 300]],
  },

  ETH_WrappedSDToken: {
    name: 'Wrapped stETH',
    symbol: 'wstETH',
  },
  ETH_StakingPool: {
    derivativeTokenName: 'Staked ETH',
    derivativeTokenSymbol: 'stETH',
    fees: [],
    ownersFeeBasisPoints: 1000,
  },
}
