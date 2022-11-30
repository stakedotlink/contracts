export const config = {
  /** LPL Migration **/

  // LPL -> SDL migration contract
  LPLMigration: {
    depositAmount: 50000000, // amount of SDL to be deposited into contract
  },

  /** Core Staking **/

  // SDL Token
  StakingAllowance: {
    name: 'Stake Dot Link', // SDL token name
    symbol: 'SDL', // SDL token symbol
    initialSupply: 220000000, // initial SDL supply to mint
  },
  // Delegator Pool (SDL staking)
  DelegatorPool: {
    derivativeTokenName: 'Staked SDL', // SDL staking derivative token name
    derivativeTokenSymbol: 'stSDL', // SDL staking derivative token symbol
  },
  // Fee curve to be used by Delegator Pool
  FlatFee: {
    feeBasisPoints: 0, // constant percentage fee in basis points
  },

  /** LINK Staking **/

  // LINK Wrapped Staking Derivative Token
  LINK_WrappedSDToken: {
    name: 'Wrapped stLINK', // wrapped staking derivative token name
    symbol: 'wstLINK', // wrapped staking derivative token symbol
  },
  // LINK Staking Pool
  LINK_StakingPool: {
    derivativeTokenName: 'Staked LINK', // LINK staking derivative token name
    derivativeTokenSymbol: 'stLINK', // LINK staking derivative token symbol
    fees: [['0x11187eff852069a33d102476b2E8A9cc9167dAde', 300]], // fee receivers & percentage amounts in basis points
  },
  // Operator Vault Controller Strategy
  OperatorVCS: {
    stakeController: '0x11187eff852069a33d102476b2E8A9cc9167dAde', // address of Chainlink staking contract
    minDepositThreshold: 1000, // minimum deposits required to initiate a deposit
    fees: [], // fee receivers & percentage amounts in basis points
    vaultOperatorAddresses: [
      '0x11187eff852069a33d102476b2E8A9cc9167dAde',
      '0x11187eff852069a33d102476b2E8A9cc9167dAde',
      '0x11187eff852069a33d102476b2E8A9cc9167dAde',
      '0x11187eff852069a33d102476b2E8A9cc9167dAde',
      '0x11187eff852069a33d102476b2E8A9cc9167dAde',
      '0x11187eff852069a33d102476b2E8A9cc9167dAde',
      '0x11187eff852069a33d102476b2E8A9cc9167dAde',
      '0x11187eff852069a33d102476b2E8A9cc9167dAde',
      '0x11187eff852069a33d102476b2E8A9cc9167dAde',
      '0x11187eff852069a33d102476b2E8A9cc9167dAde',
    ], // list of operator addresses that correspond to each vault
  },
  // Community Vault Controller Strategy
  CommunityVCS: {
    stakeController: '0x11187eff852069a33d102476b2E8A9cc9167dAde', // address of Chainlink staking contract
    minDepositThreshold: 1000, // minimum deposits required to initiate a deposit
    fees: [], // fee receivers & percentage amounts in basis points
    maxDeposits: 5000000, // maximum amount of deposits that can be deposited into this contract
    maxVaultDeployments: 10, // maximum number of vaults that can be deployed at once
  },

  /** ETH Staking **/

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
