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
    derivativeTokenName: 'Lent STA',
    derivativeTokenSymbol: 'lSTA',
    rateConstantA: 10,
    rateConstantB: 500,
    rateConstantC: 6,
    rateConstantD: 12,
    rateConstantE: 20,
  },
  LinkOwnersRewardsPool: {
    derivativeTokenName: 'LinkPool LINK',
    derivativeTokenSymbol: 'lplLINK',
  },
  LinkStakingPool: {
    derivativeTokenName: 'stLINK',
    derivativeTokenSymbol: 'Staked LINK',
    fees: [],
    ownersFeeBasisPoints: 1000,
  },
  LinkWrappedSDToken: {
    name: 'Wrapped stLINK',
    symbol: 'wstLINK',
  },
  LinkBorrowingPool: {
    derivativeTokenName: 'bstLINK',
    derivativeTokenSymbol: 'Borrowed stLINK',
  },
}
