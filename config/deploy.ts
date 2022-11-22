export const config = {
  StakingAllowance: {
    name: 'Staking Allowance',
    symbol: 'STA',
    initialSupply: 220000000,
  },
  DelegatorPool: {
    derivativeTokenName: 'Staked STA',
    derivativeTokenSymbol: 'stSTA',
  },
  RampUpCurve: {
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
