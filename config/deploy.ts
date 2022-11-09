export const config = {
  PoolOwners: {
    derivativeTokenName: 'Staked LPL',
    derivativeTokenSymbol: 'stLPL',
  },
  StakingAllowance: {
    name: 'Staking Allowance',
    symbol: 'STA',
  },
  LendingPool: {
    derivativeTokenName: 'Staked STA',
    derivativeTokenSymbol: 'stSTA',
    rateConstantA: 10,
    rateConstantB: 500,
    rateConstantC: 6,
    rateConstantD: 12,
    rateConstantE: 20,
  },

  LINK_WrappedSDToken: {
    name: 'Wrapped stLINK',
    symbol: 'wstLINK',
  },
  LINK_StakingPool: {
    derivativeTokenName: 'Staked LINK',
    derivativeTokenSymbol: 'stLINK',
    fees: [],
    ownersFeeBasisPoints: 1000,
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
