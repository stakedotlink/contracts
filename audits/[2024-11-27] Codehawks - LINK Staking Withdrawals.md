# Liquid Staking - Findings Report

# Table of contents
- ### [Contest Summary](#contest-summary)
- ### [Results Summary](#results-summary)
- ### [Resolved findings](#resolved)
- ## High Risk Findings
    - [H-01. No LSTs transfer on node operator withdrawals resulting in stuck funds and loss for node operators](#H-01)
- ## Medium Risk Findings
    - [M-01. Remove splitter will always revert if there are some rewards left on splitter contract](#M-01)
    - [M-02. Removed vaults still remain valid in `OperatorVCS`](#M-02)
    - [M-03. [WithdrawalPool.sol] Prevent efficient return of data in getBatchIds() by blocking updateWithdrawalBatchIdCutoff() update of newWithdrawalIdCutoff](#M-03)
    - [M-04. Chainlink automation Upkeep can not function because of improper integration](#M-04)
    - [M-05. Griefer can permanently DOS all the deposits to the `StakingPool`](#M-05)
    - [M-06. Vault fee receivers can conditionally block rewards distribution flow](#M-06)
    - [M-07. Principal amount of removed operator get's stuck in Chainlink's Staking Contract forever ](#M-07)
- ## Low Risk Findings
    - [L-01. Low Findings  : L01 - L04](#L-01)
    - [L-02.  Oversight while Updating the basis fee in staking pool without updating rewards strategy](#L-02)
    - [L-03. Overestimated Vault Group Capacity Due to globalVaultState.depositIndex Misuse in CommunityVCS::deposit Function](#L-03)
    - [L-04. Upgrading `OperatorVCS` Contract Will Fail](#L-04)
    - [L-05. Cross-function Merkle Proof Usage Vulnerability](#L-05)
    - [L-06. Potential Deposit Reverts Due to Removed Operator Vaults](#L-06)
    - [L-07. Upgrade Initialization Logic Will Never Execute Due to Incorrect Initializer Usage in CommunityVCS](#L-07)
    - [L-08. No way to update unbonding and claim periods](#L-08)
    - [L-09. Wrong value emitted in Withdraw event](#L-09)
    - [L-10. Due To The `minWithdrawalAmount` check Users Who Want To Withdraw Wont Be Able To Queue Their Token Withdrawals On Some Amounts ](#L-10)
    - [L-11. Handling of Empty Data Arrays in StakingPool Causes Array Out-of-Bounds Access](#L-11)
    - [L-12. The total amount to be distributed can be manipulated](#L-12)
    - [L-13. Incorrect update for state variable `sharesSinceLastUpdate` in contract `PriorityPool`](#L-13)
    - [L-14. The withdrawal index can be set to an index outside of the group, resulting in incorrect totalDepositRoom accounting](#L-14)
    - [L-15. DepositTokens event in  PriorityPool does not emit the correct values](#L-15)
    - [L-16. Attacker Can Reset the Unbonding Period for Vaults in `globalState.curUnbondedVaultGroup`, Preventing User Withdrawals](#L-16)
    - [L-17. Incorrect `nextGroupTotalUnbonded` Calculation in `FundFlowController::_getVaultUpdateData` Includes Non-grouped Vaults, Leading to Potential Withdrawal and Deposit Errors](#L-17)


# <a id='contest-summary'></a>Contest Summary

### Sponsor: Stakelink

### Dates: Sep 30th, 2024 - Oct 17th, 2024

[See more contest details here](https://codehawks.cyfrin.io/c/2024-09-stakelink)

# <a id='results-summary'></a>Results Summary

### Number of findings:
   - High: 1
   - Medium: 7
   - Low: 17


# High Risk Findings

## <a id='H-01'></a>H-01. No LSTs transfer on node operator withdrawals resulting in stuck funds and loss for node operators

_Submitted by [joicygiore](https://profiles.cyfrin.io/u/undefined), [0xtheblackpanther](https://profiles.cyfrin.io/u/undefined), [danzero](https://profiles.cyfrin.io/u/undefined), [strapontin](https://profiles.cyfrin.io/u/undefined), [bugHunters69](https://codehawks.cyfrin.io/team/cm1w299xw0039d6qmvziel1vc), [0xsolus](https://profiles.cyfrin.io/u/undefined), [trtrth](https://profiles.cyfrin.io/u/undefined), [zxriptor](https://profiles.cyfrin.io/u/undefined), [focusoor](https://profiles.cyfrin.io/u/undefined), [abdu1918](https://profiles.cyfrin.io/u/undefined), [auditweiler](https://profiles.cyfrin.io/u/undefined), [pep7siup](https://profiles.cyfrin.io/u/undefined), [tendency](https://profiles.cyfrin.io/u/undefined), [0xrs](https://profiles.cyfrin.io/u/undefined), [bigsam](https://profiles.cyfrin.io/u/undefined), [federodes](https://profiles.cyfrin.io/u/undefined), [aycozynfada](https://profiles.cyfrin.io/u/undefined). Selected submission by: [focusoor](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

Inside `OperatorStakingPool`, node operators are required to stake their LSTs. Total LST staked and node operators balances are tracked by state variables:

```Solidity
// stores the LST share balance for each operator
mapping(address => uint256) private shareBalances;
// total number of LST shares staked in this pool
uint256 private totalShares;
```

Upon withdrawing (`OperatorStakingPool:_withdraw:L200-204`) `sharesBalances` and `totalShares` are updated but no LST is transfered from `OperatorStakingPool` back to operator. This leaves `OperatorStakingPool` with stuck LST tokens and node operators can't withdraw their stake.

```Solidity
function withdraw(uint256 _amount) external {
     if (!isOperator(msg.sender)) revert SenderNotAuthorized();
         _withdraw(msg.sender, _amount);
}

function _withdraw(address _operator, uint256 _amount) private {
      uint256 sharesAmount = lst.getSharesByStake(_amount);
 @>   shareBalances[_operator] -= sharesAmount;
 @>   totalShares -= sharesAmount;
  
      emit Withdraw(_operator, _amount, sharesAmount);
}
```

## Vulnerability Details

Vulnerable code: <https://github.com/Cyfrin/2024-09-stakelink/blob/main/contracts/linkStaking/OperatorStakingPool.sol#L199>

## PoC

```TypeScript
it('PoC:High:OperatorStakingPool.sol#L199-204=>No LSTs transfer on node operator withdrawals resulting in stuck funds', async () => {
    const { signers, accounts, opPool, lst } = await loadFixture(deployFixture)
    const operator = signers[0]
    const operatorDepositAmount = toEther(1000)

    // 1. ========= Deposit to operator staking pool =========

    // take snapshot of operator balance before deposit
    const operatorBalanceBeforeDeposit = await lst.balanceOf(operator.address)
    // take snapshot of operator staking pool balance before deposit
    const opStakingPoolBalanceBeforeDeposit = await lst.balanceOf(opPool.target)

    // deposit to operator staking pool
    await lst.connect(operator).transferAndCall(opPool.target, operatorDepositAmount, '0x')

    // take snapshot of operator balance after deposit
    const operatorBalanceAfterDeposit = await lst.balanceOf(operator.address)
    // take snapshot of operator staking pool balance after deposit
    const opStakingPoolBalanceAfterDeposit = await lst.balanceOf(opPool.target)

    // make sure operator balance decreased by the deposit amount
    assert.equal(operatorBalanceBeforeDeposit - operatorBalanceAfterDeposit, operatorDepositAmount)
    // make sure operator staking pool balance increased by the deposit amount
    assert.equal(opStakingPoolBalanceAfterDeposit, opStakingPoolBalanceBeforeDeposit + operatorDepositAmount)

    // 2. ========= Withdraw from operator staking pool =========
    
    // take snapshot of operator balance before withdraw
    const operatorBalanceBeforeWithdraw = await lst.balanceOf(operator.address)
    // take snapshot of operator staking pool balance before withdraw
    const opStakingPoolBalanceBeforeWithdraw = await lst.balanceOf(opPool.target)

    // withdraw from operator staking pool
    await opPool.connect(operator).withdraw(operatorDepositAmount)

    // take snapshot of operator balance after withdraw
    const operatorBalanceAfterWithdraw = await lst.balanceOf(operator.address)
    // take snapshot of operator staking pool balance after withdraw
    const opStakingPoolBalanceAfterWithdraw = await lst.balanceOf(opPool.target)

    // make sure operator principal is 0
    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[0])), 0)
    // make sure operator staked is 0
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[0])), 0)

    // show that operator LST balance didn't change
    assert.equal(operatorBalanceAfterWithdraw, operatorBalanceBeforeWithdraw)
    // show that operator staking pool has the same balance as before the withdraw
    assert.equal(opStakingPoolBalanceAfterWithdraw, opStakingPoolBalanceBeforeWithdraw)
  })
```

**Running Poc:**

1. Copy test to `./test/linkStaking/operator-staking-pool.test.ts`
2. Run tests with `npx hardhat test ./test/linkStaking/operator-staking-pool.test.ts --network hardhat`

**Output:**

```Solidity
OperatorStakingPool
    ✔ PoC:High:OperatorStakingPool.sol#L200-204=>No LSTs transfer on operator withdrawals resulting in stuck funds (1499ms)
```

## Impact

**Likelihood: High**

This will happen on every call to `withdraw` function inside `OperatorStakingPool`.\
Also when owner calls `removeOperators` function which will call underlying withdraw method if operator has some stake.

**Impact: Medium**

Operators won't be able to retrieve their staked LSTs, and the funds will be temporarily locked inside the `OperatorStakingPool`. One way to handle this issue in production would be for the owner to upgrade this implementation with a new one that withdraws all stuck funds. By reviewing past `Withdraw` events, the owner could redistribute the funds back to the operators.

## Tools Used

Manual review, hardhat tests.

## Recommendations

Inside `_withdraw` method after totalShares update, send `amount` of LSTs back to `operator`.

```diff
+   import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
+   import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
    import "../core/interfaces/IStakingPool.sol";

    contract OperatorStakingPool is Initializable, UUPSUpgradeable, OwnableUpgradeable {
        using SafeERC20Upgradeable for IERC20Upgradeable;
+       using SafeERC20 for IERC20;
  
    ...
  
  /**
     * @notice Withdraws tokens
     * @param _operator address of operator with withdraw for
     * @param _amount amount to withdraw
     **/
    function _withdraw(address _operator, uint256 _amount) private {
        uint256 sharesAmount = lst.getSharesByStake(_amount);
        shareBalances[_operator] -= sharesAmount;
        totalShares -= sharesAmount;
+       IERC20(address(lst)).safeTransfer(_operator, _amount);

        emit Withdraw(_operator, _amount, sharesAmount);
    }
```


# Medium Risk Findings

## <a id='M-01'></a>M-01. Remove splitter will always revert if there are some rewards left on splitter contract

_Submitted by [0xsurena](https://profiles.cyfrin.io/u/undefined), [joicygiore](https://profiles.cyfrin.io/u/undefined), [danielarmstrong](https://profiles.cyfrin.io/u/undefined), [pyro](https://profiles.cyfrin.io/u/undefined), [robertodf99](https://profiles.cyfrin.io/u/undefined), [spomaria](https://profiles.cyfrin.io/u/undefined), [aksoy](https://profiles.cyfrin.io/u/undefined), [bigsam](https://profiles.cyfrin.io/u/undefined), [biakia](https://profiles.cyfrin.io/u/undefined), [4rdiii](https://profiles.cyfrin.io/u/undefined), [onthehunt11](https://profiles.cyfrin.io/u/undefined), [coinymous](https://profiles.cyfrin.io/u/undefined), [0xrochimaru](https://profiles.cyfrin.io/u/undefined), [cheatcode](https://profiles.cyfrin.io/u/undefined), [ragnarok](https://profiles.cyfrin.io/u/undefined), [tendency](https://profiles.cyfrin.io/u/undefined), [0xrs](https://profiles.cyfrin.io/u/undefined), [hunter_w3b](https://profiles.cyfrin.io/u/undefined), [krisrenzo](https://profiles.cyfrin.io/u/undefined), [ro1sharkm](https://profiles.cyfrin.io/u/undefined), [focusoor](https://profiles.cyfrin.io/u/undefined), [Z0NaN](https://codehawks.cyfrin.io/team/cm24h8h2v0001bxykbd4fsecp), [0xaman](https://profiles.cyfrin.io/u/undefined), [bladesec](https://profiles.cyfrin.io/u/undefined), [ChainDefenders](https://codehawks.cyfrin.io/team/cm2bxupf00003grinaqv78qfm), [aycozynfada](https://profiles.cyfrin.io/u/undefined), [Jeffauditor](https://profiles.cyfrin.io/u/undefined). Selected submission by: [focusoor](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

Stakelink users can register to share their LST rewards with other addresses through the `LSTRewardsSplitterController` contract. Upon registration, the user will set fee addresses, and an individual `LSTRewardSplitter` contract will be created for the user.

```Solidity
 function addSplitter(
        address _account,
        LSTRewardsSplitter.Fee[] memory _fees
    ) external onlyOwner {
        if (address(splitters[_account]) != address(0)) revert SplitterAlreadyExists();

        address splitter = address(new LSTRewardsSplitter(lst, _fees, owner()));
        splitters[_account] = ILSTRewardsSplitter(splitter);
   ...
```

All user-accrued rewards are distributed to fee addresses in the individual `LSTRewardsSplitter` contract inside the `_splitRewards` function.

```Solidity
   /**
     * @notice Splits new rewards
     * @param _rewardsAmount amount of new rewards
     */
    function _splitRewards(uint256 _rewardsAmount) private {
        for (uint256 i = 0; i < fees.length; ++i) {
            Fee memory fee = fees[i];
            uint256 amount = (_rewardsAmount * fee.basisPoints) / 10000;

            if (fee.receiver == address(lst)) {
                IStakingPool(address(lst)).burn(amount);
            } else {
                lst.safeTransfer(fee.receiver, amount);
            }
        }

        principalDeposits = lst.balanceOf(address(this));
        emit RewardsSplit(_rewardsAmount);
    }
```

When a user wants to remove a splitter, the `removeSplitter` function will be called on the `LSTRewardsSplitterController`. Upon removing the splitter, all rewards at that moment should be distributed to the fee addresses. However, if there are some rewards left, this will always fail because the controller contract will try to transfer the entire balance of the splitter contract to the user, including previously distributed rewards. This will revert because the balance is not reduced by the already distributed rewards.

```Solidity
/**
     * @notice Removes an account's splitter
     * @param _account address of account
     **/
    function removeSplitter(address _account) external onlyOwner {
        ILSTRewardsSplitter splitter = splitters[_account];
        if (address(splitter) == address(0)) revert SplitterNotFound();

        uint256 balance = IERC20(lst).balanceOf(address(splitter));
        uint256 principalDeposits = splitter.principalDeposits();
        if (balance != 0) {
            if (balance != principalDeposits) splitter.splitRewards();
@>          splitter.withdraw(balance, _account);
        }
```

## Vulnerability Details

Vulnerable code: <https://github.com/Cyfrin/2024-09-stakelink/blob/main/contracts/core/lstRewardsSplitter/LSTRewardsSplitterController.sol#L138>

## PoC

```Solidity
it('PoC:Medium:LSTRewardsSplitterController#134-138=>remove splitter will always revert if there are some rewards left on splitter contract', async () => {
    const { accounts, controller, token } = await loadFixture(deployFixture)

    // add new splitter for some account
    await controller.addSplitter(accounts[2], [
      { receiver: accounts[7], basisPoints: 4000 },
      { receiver: accounts[8], basisPoints: 4000 },
    ])

    // read newly created splitter
    const splitter = await ethers.getContractAt(
      'LSTRewardsSplitter',
      await controller.splitters(accounts[2])
    )

    // simulate reward amount
    const rewardAmount = toEther(100)
    await token.transfer(splitter.target, rewardAmount)
    
    // remove splitter will fail trying to transfer full balance amount without accounting for previous rewards distribution
    await expect(controller.removeSplitter(accounts[2])).to.be.reverted;
})
```

**Running Poc:**

1. Copy test to `./test/core/lst-rewards-splitter.test.ts`
2. Run tests with `npx hardhat test ./test/core/lst-rewards-splitter.test.ts --network hardhat`

**Output**

```Solidity
 LSTRewardsSplitter
    ✔ PoC:Medium:LSTRewardsSplitterController#134-138=>remove splitter does not work when there are some rewards left on splitter contract (1252ms)

```

## Impact

**Likelihood: Medium**

This will happen on every call to removeSplitter function inside LSTRewardsSplitterController if some rewards are accured.

**Impact: Medium**

The functionality of removing the splitter will be broken. The only way to remove the splitter would be to require that accrued rewards are zero. To ensure always correct functionality, the rewards would need to be distributed within the same block.

## Tools Used

Manual review, hardhat tests.

## Recommendations

After `splitRewards` call, only lst balance left on splitter contract should be transfered to user. This amount is captured at the end of `_splitRewardsFunction` inside `principalDeposits` state variable.\
&#x20;

```diff
/**
     * @notice Removes an account's splitter
     * @param _account address of account
     **/
    function removeSplitter(address _account) external onlyOwner {
        ILSTRewardsSplitter splitter = splitters[_account];
        if (address(splitter) == address(0)) revert SplitterNotFound();

        uint256 balance = IERC20(lst).balanceOf(address(splitter));
        uint256 principalDeposits = splitter.principalDeposits();
        if (balance != 0) {
            if (balance != principalDeposits) splitter.splitRewards();
-            splitter.withdraw(balance, _account);
+            splitter.withdraw(splitter.principalDeposits(), _account);
        }
```

A new test can be added to show that the functionality is now satisfied.

```Solidity
it('remove splitter should work when some rewards are left on splitter contract', async () => {
    const { accounts, controller, token } = await loadFixture(deployFixture)

    // add new splitter for accounts[2]
    await controller.addSplitter(accounts[2], [
      { receiver: accounts[7], basisPoints: 4000 },
      { receiver: accounts[8], basisPoints: 4000 },
    ])

    // read newly created splitter
    const splitter = await ethers.getContractAt(
      'LSTRewardsSplitter',
      await controller.splitters(accounts[2])
    )

    // simulate reward amount
    const rewardAmount = toEther(100)
    await token.transfer(splitter.target, rewardAmount)

    // take snapshot before removing splitter
    const firstReceiverBalanceBefore = await token.balanceOf(accounts[7])
    const secondReceiverBalanceBefore = await token.balanceOf(accounts[8])
    const splitterBalanceBefore = await token.balanceOf(splitter.target)
    const splitterPrincipalDepositsBefore = await splitter.principalDeposits()
    const accountBalanceBefore = await token.balanceOf(accounts[2])

    console.log('\n=================BEFORE REMOVE SPLITTER====================')
    console.log('firstReceiverBalanceBefore', firstReceiverBalanceBefore.toString())
    console.log('secondReceiverBalanceBefore', secondReceiverBalanceBefore.toString())
    console.log('splitterBalanceBefore', splitterBalanceBefore.toString())
    console.log('splitterPrincipalDepositsBefore', splitterPrincipalDepositsBefore.toString())
    console.log('accountBalanceBefore', accountBalanceBefore.toString())

    // make sure splitter has 'rewardAmount' to distribute
    assert.equal(splitterBalanceBefore - splitterPrincipalDepositsBefore, BigInt(rewardAmount))

    // remove splitter
    await controller.removeSplitter(accounts[2])

    const firstReceiverBalanceAfter = await token.balanceOf(accounts[7])
    const secondReceiverBalanceAfter = await token.balanceOf(accounts[8])
    const splitterBalanceAfter = await token.balanceOf(splitter.target)
    const accountBalanceAfter = await token.balanceOf(accounts[2])

    console.log('\n=================AFTER REMOVE SPLITTER====================')
    console.log('firstReceiverBalanceAfter', firstReceiverBalanceAfter.toString())
    console.log('secondReceiverBalanceAfter', secondReceiverBalanceAfter.toString())
    console.log('splitterBalanceAfter', splitterBalanceAfter.toString())
    console.log('accountBalanceAfter', accountBalanceAfter.toString())

    // show that rewards were distributed correctly and no funds were left on splitter contract
    assert.equal(firstReceiverBalanceAfter - firstReceiverBalanceBefore, BigInt(rewardAmount) * 4n / 10n)
    assert.equal(secondReceiverBalanceAfter - secondReceiverBalanceBefore, BigInt(rewardAmount) * 4n / 10n)
    assert.equal(splitterBalanceAfter, 0n)
    assert.equal(accountBalanceAfter, accountBalanceBefore + BigInt(rewardAmount) * 2n / 10n)
  })
```

Output:

```Solidity
LSTRewardsSplitter

=================BEFORE REMOVE SPLITTER====================
firstReceiverBalanceBefore 0
secondReceiverBalanceBefore 0
splitterBalanceBefore 100000000000000000000
splitterPrincipalDepositsBefore 0
accountBalanceBefore 10000000000000000000000

=================AFTER REMOVE SPLITTER====================
firstReceiverBalanceAfter 40000000000000000000
secondReceiverBalanceAfter 40000000000000000000
splitterBalanceAfter 0
accountBalanceAfter 10020000000000000000000
    ✔ remove splitter should work when some rewards are left on splitter contract (1286ms)


  1 passing (1s)
```


## <a id='M-02'></a>M-02. Removed vaults still remain valid in `OperatorVCS`

_Submitted by [rhaydden](https://profiles.cyfrin.io/u/undefined), [zubyoz](https://profiles.cyfrin.io/u/undefined), [baz1ka](https://profiles.cyfrin.io/u/undefined), [Joseph](https://profiles.cyfrin.io/u/undefined), [krisrenzo](https://profiles.cyfrin.io/u/undefined), [slvdev](https://profiles.cyfrin.io/u/undefined), [avoloder](https://profiles.cyfrin.io/u/undefined), [bladesec](https://profiles.cyfrin.io/u/undefined), [ChainDefenders](https://codehawks.cyfrin.io/team/cm2bxupf00003grinaqv78qfm). Selected submission by: [rhaydden](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

`OperatorVCS::removeVault` doesn't  update the `vaultMapping` which allows removed vaults to continue interacting with the strategy which is not intended.

## Impact

The function fails to update the `vaultMapping`, which means that even after a vault is removed, its address would still return true when checked against the `vaultMapping` and  removed vaults could continue withdrawing operator rewards

## Vulnerability Details

`removeVault` function is responsible for removing a vault from the strategy. Albeit, while it removes the vault from the `vaults` array, it doesn't update the `vaultMapping`. As a result, removed vaults are still considered valid by the contract and can continue to call functions that should only be restricted to active vaults.

<https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/linkStaking/OperatorVCS.sol#L324-L331>

```solidity
304:     function removeVault(uint256 _queueIndex) public {
305:         address vault = vaultsToRemove[_queueIndex];
306: 
307:         vaultsToRemove[_queueIndex] = vaultsToRemove[vaultsToRemove.length - 1];
308:         vaultsToRemove.pop();
309: 
310:         _updateStrategyRewards();
311:         (uint256 principalWithdrawn, uint256 rewardsWithdrawn) = IOperatorVault(vault).exitVault();
312: 
313:         totalDeposits -= principalWithdrawn + rewardsWithdrawn;
314:         totalPrincipalDeposits -= principalWithdrawn;
315: 
316:         uint256 numVaults = vaults.length;
317:         uint256 index;
318:         for (uint256 i = 0; i < numVaults; ++i) {
319:             if (address(vaults[i]) == vault) {
320:                 index = i;
321:                 break;
322:             }
323:         }
324:         for (uint256 i = index; i < numVaults - 1; ++i) {
325:             vaults[i] = vaults[i + 1];
326:         }
327:         vaults.pop();
328:         vaultMapping[vault] = false;
329:         token.safeTransfer(address(stakingPool), token.balanceOf(address(this)));
330:     }

```

Add this test to `operator-vcs.test.ts`

```typescript
it('removeVault should update vaultMapping correctly', async () => {
    const { accounts, strategy, stakingPool, vaults, stakingController, fundFlowController } = await loadFixture(deployFixture)

    // Initial setup
    await stakingPool.deposit(accounts[0], toEther(1000), [encodeVaults([])])
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()

    // Remove an operator and queue the vault for removal
    await stakingController.removeOperator(vaults[5])
    await strategy.queueVaultRemoval(5)

    // Wait for the unbonding period
    await time.increase(unbondingPeriod)
    await fundFlowController.updateVaultGroups()

    // Remove the vault
    await strategy.removeVault(0)

    // We verify that the vault is no longer in the vaults array
    const remainingVaults = await strategy.getVaults()
    assert.isFalse(remainingVaults.includes(vaults[5]), "Vault should be removed from vaults array")

    //Let's check if the removed vault is still considered valid by the strategy
    const isVaultValid = await strategy.isVaultValid(vaults[5])

    // This should be false if the suggested fix in the recommendation is applied
    assert.isFalse(isVaultValid, "Removed vault should not be considered valid")

    // Attempt to withdraw operator rewards for the removed vault
    // This should now revert after the fix
    await expect(strategy.withdrawOperatorRewards(accounts[1], 1))
      .to.be.revertedWithCustomError(strategy, "SenderNotAuthorized")
})
```

* Firstly, add this function to the `OperatorVCS.sol` contract:

```solidity
function isVaultValid(address vault) public view returns (bool) {
    return vaultMapping[vault];
}
```

Then run the poc test with:

* `yarn test test/linkStaking/operator-vcs.test.ts`

The test should fail which means that removed vaults are still considered valid.

* Update the `removeVault` function in the OperatorVCS contract using the recommendation in the recommendations section below:
* Run the test again. itll pass which shows the issue has been mitigated( i.e removed vaults are not valid anymore)

## Tools Used

\-- Vscode
\-- Manual review

## Recommendations

Modify the `removeVault` function to set the vault's mapping to false:

```diff
 function removeVault(uint256 _queueIndex) public {
        address vault = vaultsToRemove[_queueIndex];

        vaultsToRemove[_queueIndex] = vaultsToRemove[vaultsToRemove.length - 1];
        vaultsToRemove.pop();

        _updateStrategyRewards();
        (uint256 principalWithdrawn, uint256 rewardsWithdrawn) = IOperatorVault(vault).exitVault();

        totalDeposits -= principalWithdrawn + rewardsWithdrawn;
        totalPrincipalDeposits -= principalWithdrawn;

        uint256 numVaults = vaults.length;
        uint256 index;
        for (uint256 i = 0; i < numVaults; ++i) {
            if (address(vaults[i]) == vault) {
                index = i;
                break;
            }
        }
        for (uint256 i = index; i < numVaults - 1; ++i) {
            vaults[i] = vaults[i + 1];
        }
        vaults.pop();
+        vaultMapping[vault] = false;

        token.safeTransfer(address(stakingPool), token.balanceOf(address(this)));
    }
```

## <a id='M-03'></a>M-03. [WithdrawalPool.sol] Prevent efficient return of data in getBatchIds() by blocking updateWithdrawalBatchIdCutoff() update of newWithdrawalIdCutoff

_Submitted by [neilalois](https://profiles.cyfrin.io/u/undefined), [donkicha](https://profiles.cyfrin.io/u/undefined), [meeve](https://profiles.cyfrin.io/u/undefined), [bube](https://profiles.cyfrin.io/u/undefined), [krisrenzo](https://profiles.cyfrin.io/u/undefined), [ChainDefenders](https://codehawks.cyfrin.io/team/cm2bxupf00003grinaqv78qfm). Selected submission by: [neilalois](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

\[WithdrawalPool.sol] `updateWithdrawalBatchIdCutoff()` is used to update values `withdrawalIdCutoff` and `withdrawalBatchIdCutoff` . `withdrawalBatchIdCutoff` is used in `getBatchIds` and `getFinalizedWithdrawalIdsByOwner` view functions to more efficiently return data without iterating over all batches. By purposefully or by some innocent staker forgetting to call `withdraw()` on their `queuedWithdrawal` the `updateWithdrawalBatchIdCutoff()` will no longer update the `withdrawalIdCutoff` and `withdrawalBatchIdCutoff` because there will be a queuedWithdrawal with smaller index and still left with balance.

## Vulnerability Details

`updateWithdrawalBatchIdCutoff()` is used for updating `withdrawalIdCutoff` and `withdrawalBatchIdCutoff` to increase view function efficiency. It has a loop:

```Solidity
...
        // find the first withdrawal that has funds remaining
        for (uint256 i = newWithdrawalIdCutoff; i < numWithdrawals; ++i) {
            newWithdrawalIdCutoff = i;

            Withdrawal memory withdrawal = queuedWithdrawals[i];
            if (withdrawal.sharesRemaining != 0 || withdrawal.partiallyWithdrawableAmount != 0) { // <- breaks on first queuedWithdrawal with any balance
                break;
            }
        }
...
```

Because it depends on `queuedWithdrawals`, it is possible to permanently halt the optimization by simply not finalizing own withdrawal.

The only place that clears `queuedWithdrawals` balance is the `withdraw()` function:

```Solidity
...
                delete queuedWithdrawals[withdrawalId];
                delete withdrawalOwners[withdrawalId];
            } else {
                amountToWithdraw += withdrawal.partiallyWithdrawableAmount;
                queuedWithdrawals[withdrawalId].partiallyWithdrawableAmount = 0;
            }
...
```

But before that it has a check:

```Solidity
    if (withdrawalOwners[withdrawalId] != owner) revert SenderNotAuthorized(); // <- only true owner can call
```

Because only the true owner can finalize and clear the balance once the malicious actor or forgetful staker successfully queues their withdrawal and not clears it, it will cause the optimization function to stop increasing the stored cutoff variables.

Updated existing hardhat test for withdrawals and checked `withdrawalBatchIdCutoff` and `withdrawalIdCutoff`  values

```Solidity
  it('once queuedWithdrawal is not called with withdraw() it is the highest index for updateWithdrawalBatchIdCutoff()', async () => {
    const { signers, accounts, withdrawalPool, token } = await loadFixture(deployFixture)

    await withdrawalPool.queueWithdrawal(accounts[0], toEther(1000)) // <- will not be withdrawan - index 1 (because 0 is by default stored)
    await withdrawalPool.queueWithdrawal(accounts[1], toEther(250))
    await withdrawalPool.queueWithdrawal(accounts[0], toEther(500))
    await withdrawalPool.deposit(toEther(1200))

    await expect(withdrawalPool.withdraw([1, 2, 3], [1, 1, 0])).to.be.revertedWithCustomError(
      withdrawalPool,
      'SenderNotAuthorized()'
    )
    await expect(withdrawalPool.withdraw([1, 3], [1, 1])).to.be.revertedWithCustomError(
      withdrawalPool,
      'InvalidWithdrawalId()'
    )

    await withdrawalPool.deposit(toEther(550))

    await expect(withdrawalPool.withdraw([1], [2])).to.be.revertedWithCustomError(
      withdrawalPool,
      'InvalidWithdrawalId()'
    )

    let startingBalance = await token.balanceOf(accounts[1])
    await withdrawalPool.connect(signers[1]).withdraw([2], [2])
    assert.equal(fromEther((await token.balanceOf(accounts[1])) - startingBalance), 250)
    assert.deepEqual(
      (await withdrawalPool.getWithdrawalIdsByOwner(accounts[1])).map((id) => Number(id)),
      []
    )
    assert.deepEqual(
      (await withdrawalPool.getWithdrawals([2])).map((d: any) => [
        fromEther(d[0]),
        fromEther(d[1]),
      ]),
      [[0, 0]]
    )

    startingBalance = await token.balanceOf(accounts[0])
    await withdrawalPool.withdraw([3], [2]);

    // account[0] did not withdraw its first queueWithdrawal 
    // updateWithdrawalBatchIdCutoff will not be able to update the cutoffs beyond it's index

    await withdrawalPool.updateWithdrawalBatchIdCutoff()

    console.log(await withdrawalPool.withdrawalBatchIdCutoff()) // <- returns 0
    console.log(await withdrawalPool.withdrawalIdCutoff())          // <- returns 1 (matching leftover queuedWithdrawal index)
  })
```

## Impact

The  `getBatchIds` and `getFinalizedWithdrawalIdsByOwner` view functions will increasingly consume more and more computational resources to be called due to increasing iteration count. If the project uses 3rd party nodes this will cause the qoutas to increase and after longer periods of time can reach limits. If own node is used it will cause increasing computational pressure.

## Tools Used

Manual review + hardhat test.

## Recommendations

Few possible workarounds:

* Allow WithdrawalPool owner to forcefully withdraw a queuedWithdrawal if it's been pending for a long time
* Refactor getBatchIds to not iterate through all withdrawalBatches, but rather use some form of mapping get constant performance


## Notes

Although this issue is somewhat mentioned in the LightChaser as "permanent Denial of Service (DoS) vulnerability", it is likely that the developers were hoping to solve it by using these stored cutoff variables. Which as described here are still open to circumvention.

## <a id='M-04'></a>M-04. Chainlink automation Upkeep can not function because of improper integration

_Submitted by [bugHunters69](https://codehawks.cyfrin.io/team/cm1w299xw0039d6qmvziel1vc), [trtrth](https://profiles.cyfrin.io/u/undefined), [kwakudr](https://profiles.cyfrin.io/u/undefined), [bladesec](https://profiles.cyfrin.io/u/undefined). Selected submission by: [trtrth](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary
Chainlink automation Upkeep can not work properly because of wrong integration in contracts `PriorityPool`, `WithdrawalPool`

## Vulnerability Details
From [Chainlink's docs](https://docs.chain.link/chainlink-automation/reference/automation-interfaces#checkupkeep-function), the function `checkUpkeep(bytes calldata checkData) external view override returns (bool upkeepNeeded, bytes memory performData)`. In case `upkeepNeeded` returned `true`, then the `performData` is used as input for function `performUpkeep(bytes calldata performData)`.

Chainlink upkeep integration from contract PriorityPool: The function `checkUpkeep()` returns a `abi-encoded` of an `uint256`, when the function `performUpkeep()` tries to decode the input to `bytes[]`. With the returned values from `checkUpkeep()`, the function `performUpkeep()` will always revert.

```Solidity
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        uint256 strategyDepositRoom = stakingPool.getStrategyDepositRoom();
        uint256 unusedDeposits = stakingPool.getUnusedDeposits();

        if (poolStatus != PoolStatus.OPEN) return (false, "");
        if (
            strategyDepositRoom < queueDepositMin ||
            (totalQueued + unusedDeposits) < queueDepositMin
        ) return (false, "");

        return (
            true,
@>            abi.encode(
                MathUpgradeable.min(
                    MathUpgradeable.min(strategyDepositRoom, totalQueued + unusedDeposits),
                    queueDepositMax
                )
            )
        );
    }

    function performUpkeep(bytes calldata _performData) external {
@>        bytes[] memory depositData = abi.decode(_performData, (bytes[]));
        _depositQueuedTokens(queueDepositMin, queueDepositMax, depositData);
    }
```

Similarly, the integration in contract `WithdrawalPool` is improper such that: `checkUpkeep()` returns empty data if upkeep is needed, when the function `performUpkeep()` tries to decode input to `bytes[]` which will always revert

```Solidity
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        if (
            _getStakeByShares(totalQueuedShareWithdrawals) != 0 &&
            priorityPool.canWithdraw(address(this), 0) != 0 &&
            block.timestamp > timeOfLastWithdrawal + minTimeBetweenWithdrawals
        ) {
@>            return (true, "");
        }
        return (false, "");
    }

    function performUpkeep(bytes calldata _performData) external {
        uint256 canWithdraw = priorityPool.canWithdraw(address(this), 0);
        uint256 totalQueued = _getStakeByShares(totalQueuedShareWithdrawals);
        if (
            totalQueued == 0 ||
            canWithdraw == 0 ||
            block.timestamp <= timeOfLastWithdrawal + minTimeBetweenWithdrawals
        ) revert NoUpkeepNeeded();

        timeOfLastWithdrawal = uint64(block.timestamp);

        uint256 toWithdraw = totalQueued > canWithdraw ? canWithdraw : totalQueued;
@>        bytes[] memory data = abi.decode(_performData, (bytes[]));

        priorityPool.executeQueuedWithdrawals(toWithdraw, data);

        _finalizeWithdrawals(toWithdraw);
    }
```

## Impact
Automation tasks can not be done by Upkeep

## Tools Used
Manual

## Recommendations
Update integration to return and decode data properly

## <a id='M-05'></a>M-05. Griefer can permanently DOS all the deposits to the `StakingPool`

_Submitted by [galturok](https://profiles.cyfrin.io/u/undefined), [bugHunters69](https://codehawks.cyfrin.io/team/cm1w299xw0039d6qmvziel1vc), [bigsam](https://profiles.cyfrin.io/u/undefined), [tejaswarambhe](https://profiles.cyfrin.io/u/undefined), [trtrth](https://profiles.cyfrin.io/u/undefined), [ro1sharkm](https://profiles.cyfrin.io/u/undefined), [moo888](https://profiles.cyfrin.io/u/undefined). Selected submission by: [bugHunters69](https://codehawks.cyfrin.io/team/cm1w299xw0039d6qmvziel1vc)._      
            


## Summary

Griefer can DOS the whole `StakingPool` by `donating` tokens before the first actual `deposit` comes in. After that, it's not possible for any deposits transactions to complete.

## Vulnerability Details

In the `StakingPool` contract there is a deposit function that increases the `totalStaked` variable:

```js
    function donateTokens(uint256 _amount) external {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        totalStaked += _amount;
        emit DonateTokens(msg.sender, _amount);
    }
```

Increasing the `totalStaked` variable before any deposits/shares get minted, results in the `getSharesByStake` function to always `return 0`:

```js
    function getSharesByStake(uint256 _amount) public view returns (uint256) {
        uint256 totalStaked = _totalStaked();
        if (totalStaked == 0) {
            return _amount;
        } else {
            return (_amount * totalShares) / totalStaked;
        }
    }
```

As we can see, `totalStaked == donation > 0` and `totalShares == 0` since no shares have been minted yet. Any `_amount * 0` will `return 0`. This function is used during the `deposit` process.

```js
StakingPool.sol

    function deposit(address _account, uint256 _amount, bytes[] calldata _data) external onlyPriorityPool {
        require(strategies.length > 0, "Must be > 0 strategies to stake");

        uint256 startingBalance = token.balanceOf(address(this));

        if (_amount > 0) {
            token.safeTransferFrom(msg.sender, address(this), _amount);
            _depositLiquidity(_data);
@>          _mint(_account, _amount);
            totalStaked += _amount;
        } else {
            _depositLiquidity(_data);
        }

        uint256 endingBalance = token.balanceOf(address(this));
        if (endingBalance > startingBalance && endingBalance > unusedDepositLimit) {
            revert InvalidDeposit();
        }
    }
```

```js
StakingRewardsPool.sol

    function _mint(address _recipient, uint256 _amount) internal override {
@>      uint256 sharesToMint = getSharesByStake(_amount);
        _mintShares(_recipient, sharesToMint);

        emit Transfer(address(0), _recipient, _amount);
    }

    function _mintShares(address _recipient, uint256 _amount) internal {
        require(_recipient != address(0), "Mint to the zero address");

@>      if (totalShares == 0) {
            shares[address(0)] = DEAD_SHARES;
            totalShares = DEAD_SHARES;
            _amount -= DEAD_SHARES;
        }

        totalShares += _amount;
        shares[_recipient] += _amount;
    }
```

In the `_mint` function, the `getSharesByStake` will `return 0`, so `_mintShares` will get called with `_amount == 0`. Since, there hasn't been any deposits yet and `totalShares == 0`, it will go inside the `if` statement and try to `_amount -= DEAD_SHARES` where `DEAD_SHARES = 10 ** 3` constant. This will always `revert` with an underflow error.

## Impact

Permanent Denial of Service (DOS) of all `deposits` into the protocol. Renders the whole protocol useless since there can't be any deposits. Attacker can simply frontrun the first `deposit` transaction to `donate` just 1 wei and DOS the protocol.

## Coded Proof of Concept

Create a new `tests.test.ts` file in the `test/core/priorityPool` folder and paste the following code:

```JavaScript
import { assert, expect } from 'chai'
import {
    toEther,
    deploy,
    fromEther,
    deployUpgradeable,
    getAccounts,
    setupToken,
} from '../../utils/helpers'
import {
    ERC677,
    SDLPoolMock,
    StakingPool,
    PriorityPool,
    StrategyMock,
    WithdrawalPool,
} from '../../../typechain-types'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('PriorityPool', () => {
    async function deployFixture() {
        const { accounts, signers } = await getAccounts()
        const adrs: any = {}

        const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
            'Chainlink',
            'LINK',
            1000000000,
        ])) as ERC677
        adrs.token = await token.getAddress()
        await setupToken(token, accounts, true)

        const stakingPool = (await deployUpgradeable('StakingPool', [
            adrs.token,
            'Staked LINK',
            'stLINK',
            [],
            toEther(10000),
        ])) as StakingPool
        adrs.stakingPool = await stakingPool.getAddress()

        const strategy = (await deployUpgradeable('StrategyMock', [
            adrs.token,
            adrs.stakingPool,
            toEther(1000),
            toEther(100),
        ])) as StrategyMock
        adrs.strategy = await strategy.getAddress()

        const sdlPool = (await deploy('SDLPoolMock')) as SDLPoolMock
        adrs.sdlPool = await sdlPool.getAddress()

        const pp = (await deployUpgradeable('PriorityPool', [
            adrs.token,
            adrs.stakingPool,
            adrs.sdlPool,
            toEther(100),
            toEther(1000),
        ])) as PriorityPool
        adrs.pp = await pp.getAddress()

        const withdrawalPool = (await deployUpgradeable('WithdrawalPool', [
            adrs.token,
            adrs.stakingPool,
            adrs.pp,
            toEther(10),
            0,
        ])) as WithdrawalPool
        adrs.withdrawalPool = await withdrawalPool.getAddress()

        await stakingPool.addStrategy(adrs.strategy)
        await stakingPool.setPriorityPool(adrs.pp)
        await stakingPool.setRebaseController(accounts[0])
        await pp.setDistributionOracle(accounts[0])
        await pp.setWithdrawalPool(adrs.withdrawalPool)

        for (let i = 0; i < signers.length; i++) {
            await token.connect(signers[i]).approve(adrs.pp, ethers.MaxUint256)
        }

        return { signers, accounts, adrs, token, stakingPool, strategy, sdlPool, pp, withdrawalPool }
    }



    it('donating dos deposits', async () => {
        const { signers, accounts, adrs, pp, token, strategy, stakingPool } = await loadFixture(
            deployFixture
        )

        await token.connect(signers[1]).approve(adrs.stakingPool, 1)
        await stakingPool.connect(signers[1]).donateTokens(1)

        // https://docs.soliditylang.org/en/v0.8.14/control-structures.html#panic-via-assert-and-error-via-require
        // Panic code 0x11: If an arithmetic operation results in underflow or overflow outside of an unchecked { ... } block.
        await expect(pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])).to.be.revertedWithPanic(0x11)
    })
})
```

## Tools Used

Manual Review

## Recommendations

Don't allow donations if the `totalStaked == 0`

## <a id='M-06'></a>M-06. Vault fee receivers can conditionally block rewards distribution flow

_Submitted by [dimah7](https://profiles.cyfrin.io/u/undefined), [bigsam](https://profiles.cyfrin.io/u/undefined), [0xw3](https://profiles.cyfrin.io/u/undefined), [trtrth](https://profiles.cyfrin.io/u/undefined). Selected submission by: [trtrth](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

Rewards distribution flow can be blocked by fee receivers through token transfer callback

## Vulnerability Details

The internal function `StakingPool#_updateStrategyRewards()` is expected to update and distribute rewards if net positive earned from strategies. Fees/rewards are minted as shares and sent to receivers using function `ERC677#transferAndCallFrom()`, which has contract callback if receiver is a contract.

```Solidity
    function _updateStrategyRewards(uint256[] memory _strategyIdxs, bytes memory _data) private {
        ...
        ...
            uint256 feesPaidCount;
            for (uint256 i = 0; i < receivers.length; i++) {
                for (uint256 j = 0; j < receivers[i].length; j++) {
                    if (feesPaidCount == totalFeeCount - 1) {
@>                        transferAndCallFrom(
                            address(this),
                            receivers[i][j],
                            balanceOf(address(this)),
                            "0x"
                        );
                    } else {
@>                        transferAndCallFrom(address(this), receivers[i][j], feeAmounts[i][j], "0x");
                        feesPaidCount++;
                    }
                }
            }
        }

        emit UpdateStrategyRewards(msg.sender, totalStaked, totalRewards, totalFeeAmounts);
    }
```

The function `StakingPool#_updateStrategyRewards()` is called from public functions `StakingPool#updateStrategyRewards()` and `StakingPool#removeStrategy()`

```Solidity
    function removeStrategy(
        uint256 _index,
        bytes memory _strategyUpdateData,
        bytes calldata _strategyWithdrawalData
    ) external onlyOwner {
        require(_index < strategies.length, "Strategy does not exist");

        uint256[] memory idxs = new uint256[]();
        idxs[0] = _index;
@>        _updateStrategyRewards(idxs, _strategyUpdateData);

        IStrategy strategy = IStrategy(strategies[_index]);
        uint256 totalStrategyDeposits = strategy.getTotalDeposits(); // @info the new total deposit after changed in updateDeposits()
        if (totalStrategyDeposits > 0) {
            strategy.withdraw(totalStrategyDeposits, _strategyWithdrawalData); // @question can withdraw all ?
        }

        for (uint256 i = _index; i < strategies.length - 1; i++) {
            strategies[i] = strategies[i + 1]; // @info shifting ==> strategies order does not change
        }
        strategies.pop();
        token.safeApprove(address(strategy), 0);
    }
```

```Solidity
    function updateStrategyRewards(uint256[] memory _strategyIdxs, bytes memory _data) external {
        if (msg.sender != rebaseController && !_strategyExists(msg.sender))
            revert SenderNotAuthorized();
@>        _updateStrategyRewards(_strategyIdxs, _data);
    }
```

The function `StakingPool#updateStrategyRewards()` can be called from `rebaseController` or, called from strategy contracts. In strategy contracts, there are 2 flows that call the function: `addFee` and `updateFee`:

```Solidity
    function addFee(address _receiver, uint256 _feeBasisPoints) external onlyOwner {
@>        _updateStrategyRewards();
        fees.push(Fee(_receiver, _feeBasisPoints));
        if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();
    }

    function updateFee(
        uint256 _index,
        address _receiver,
        uint256 _feeBasisPoints
    ) external onlyOwner {
@>        _updateStrategyRewards();

        if (_feeBasisPoints == 0) {
            fees[_index] = fees[fees.length - 1];
            fees.pop();
        } else {
            fees[_index].receiver = _receiver;
            fees[_index].basisPoints = _feeBasisPoints;
        }

        if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();
    }

    function _updateStrategyRewards() internal {
        address[] memory strategies = stakingPool.getStrategies();
        uint256[] memory strategyIdxs = new uint256[]();
        for (uint256 i = 0; i < strategies.length; ++i) {
            strategyIdxs[i] = i;
        }
@>        stakingPool.updateStrategyRewards(strategyIdxs, "");
    }
```

So, the with the single failure point here at the function `_updateStrategyRewards`, malicious fee receivers can conditionally block 3 flows: removing strategies, adding fees in strategies, updating fees in strategies

## Impact

A malicious fee receiver can conditionally block 3 flows: removing strategies, adding fees in strategies, updating fees in strategies

## Tools Used

Manual

## Recommendations

Consider adding mechanism to try/catch to skip revert callbacks, or force transfers

## <a id='M-07'></a>M-07. Principal amount of removed operator get's stuck in Chainlink's Staking Contract forever 

_Submitted by [angrymustacheman](https://profiles.cyfrin.io/u/undefined), [krisrenzo](https://profiles.cyfrin.io/u/undefined), [moo888](https://profiles.cyfrin.io/u/undefined). Selected submission by: [angrymustacheman](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

When an operator is removed by Chainlink's Staking Contract , it needs to call `unbound` function of Chainlink's OperatorStakingPool.sol before wthdrawing it's principal amounts using `unstakeRemovedPrincipal` function , but in Stakelink protocol , the Operators misses to call the unbound function , so the `unstakeRemovedPrincipal` function always reverts causing lock of funds of removed operator in Chainlink's Staking Contract .

## Vulnerability Details

As it can be seen in Chainlink's `OperatorStakingPool.sol` at #233 -
<https://etherscan.io/address/0xBc10f2E862ED4502144c7d632a3459F49DFCDB5e#code>

```solidity
/// @inheritdoc StakingPoolBase
  /// @dev Removed operators need to go through the unbonding period before they can withdraw. This
  /// function will check if the operator has removed principal they can unstake.
  function unbond() external override {
    Staker storage staker = s_stakers[msg.sender];
    uint224 history = staker.history.latest();
    uint112 stakerPrincipal = uint112(history >> 112);
    if (stakerPrincipal == 0 && s_operators[msg.sender].removedPrincipal == 0) {
      revert StakeNotFound(msg.sender);
    }

    _unbond(staker);
  }
```

removed operators need to go through unbound period and thereby needs to call this function before unstaking from Chainlink's OperatorStakingPool.sol .

&#x20;In normal condition , when an Operator is not removed the `unbound` is being called by invoking `FundFlowController.sol#updateVaultGroups` which gets the vaults for which unbound needs to be called , the flow looks like `FundFlowController.sol#updateVaultGroups` -> `FundFlowController.sol#_getVaultUpdateData` -> `FundFlowController.sol#_getTotalDepositRoom` to get the `nonEmptyVaultsFormatted` which is further used as `curGroupOpVaultsToUnbond` in `updateVaultGroups` function of `FundFlowController.sol` .
The problem is , while getting the `nonEmptyVaultsFormatted` from `FundFlowController.sol#_getTotalDepositRoom` , the vaults for which operator's are removed are avoided as can be seen here -
<https://github.com/Cyfrin/2024-09-stakelink/blob/main/contracts/linkStaking/FundFlowController.sol#L413C8-L415C1>

```solidity
 for (uint256 i = _vaultGroup; i < _depositIndex; i += _numVaultGroups) {
            if (IVault(_vaults[i]).isRemoved()) continue;

```

So when `FundFlowController.sol#updateVaultGroups` goes further to call `operatorVCS.updateVaultGroups` which is `VaultControllerStrategy.sol#updateVaultGroups` as seen below -
<https://github.com/Cyfrin/2024-09-stakelink/blob/main/contracts/linkStaking/base/VaultControllerStrategy.sol#L471C4-L487C1>

```solidity
 function updateVaultGroups(
        uint256[] calldata _curGroupVaultsToUnbond,
        uint256 _curGroupTotalDepositRoom,
        uint256 _nextGroup,
        uint256 _nextGroupTotalUnbonded
    ) external onlyFundFlowController {
        for (uint256 i = 0; i < _curGroupVaultsToUnbond.length; ++i) {
@>          vaults[_curGroupVaultsToUnbond[i]].unbond();
        }

        vaultGroups[globalVaultState.curUnbondedVaultGroup].totalDepositRoom = uint128(
            _curGroupTotalDepositRoom
        );
        globalVaultState.curUnbondedVaultGroup = uint64(_nextGroup);
        totalUnbonded = _nextGroupTotalUnbonded;
    }
```

The removed vaults/operators do not call the unbound function `OperatorStakingPool.sol` , so the unbound period is never started for Removed operators . So when the attempt is done to remove the vault  here -
<https://github.com/Cyfrin/2024-09-stakelink/blob/main/contracts/linkStaking/OperatorVCS.sol#L310C2-L312C1>

```solidity
       _updateStrategyRewards();
        (uint256 principalWithdrawn, uint256 rewardsWithdrawn) = IOperatorVault(vault).exitVault();
```

and thereby withdraw the principle amount from Chainlink's Staking contract here -

<https://github.com/Cyfrin/2024-09-stakelink/blob/main/contracts/linkStaking/OperatorVault.sol#L225C2-L243C8>

```Solidity
   function exitVault() external onlyVaultController returns (uint256, uint256) {
        if (!isRemoved()) revert OperatorNotRemoved();

        uint256 opRewards = getUnclaimedRewards();
        if (opRewards != 0) _withdrawRewards();

        uint256 rewards = getRewards();
        if (rewards != 0) rewardsController.claimReward();

        uint256 principal = getPrincipalDeposits();
@>      stakeController.unstakeRemovedPrincipal();

        uint256 balance = token.balanceOf(address(this));
        token.safeTransfer(vaultController, balance);

        return (principal, rewards);
    }

    /**
```

it would revert and the funds of removed operator is stuck in Chainlink's OperatorStakingPool.sol .

## Impact

Funds of removed operator is stuck in Chainlink's OperatorStakingPool.sol.

## Tools Used

Manual Review ,
Chainlink staking contracts collection - <https://ipfs.io/ipfs/QmUWDupeN4D5vHNWH6dEbNuoiZz9bnbqTHw61L27RG6tE2>

## Recommendations

Create a mechanism to call the stakeController.unbound so that Removed operators go through the unbonding period before they can withdraw.


# Low Risk Findings

## <a id='L-01'></a>L-01. Low Findings  : L01 - L04

_Submitted by [joicygiore](https://profiles.cyfrin.io/u/undefined), [rhaydden](https://profiles.cyfrin.io/u/undefined), [0xrs](https://profiles.cyfrin.io/u/undefined), [Dup1337](https://codehawks.cyfrin.io/team/cm1te5ors00079ybuhlx5k9h7), [bladesec](https://profiles.cyfrin.io/u/undefined). Selected submission by: [0xrs](https://profiles.cyfrin.io/u/undefined)._      
            


# L01 - LSTRewardsSplitterController::removeSplitter - LSTRewardSplitter cannot be removed if there are undistributed rewards

## Link: <https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/core/lstRewardsSplitter/LSTRewardsSplitterController.sol#L138>

The function evaluates the current splitter balance:

```Solidity
uint256 balance = IERC20(lst).balanceOf(address(splitter));
```

If there is a balance and the balance is different from the principalDeposits, splitRewards is called on the splitter that should be removed.

```Solidity
if (balance != principalDeposits) splitter.splitRewards();
```

And, finally, the withdraw function is called on the splitter:

```Solidity
splitter.withdraw(balance, _account);
```

The problem here is, that the initially retrieved balance value (see above) is passed to the withdraw function. However, after calling "splitRewards", the balance of the splitter will change (it will  be lower).

In the LSTRewardsSplitter::withdraw function, the following line will be executed with an \_amount value that is bigger than the principalDeposits value

```Solidity
principalDeposits -= _amount;
```

And, this will cause a panic error (arithmetic operation overflowed outside of an unchecked block)

## Proof of concept:

Add the following test to lst-rewards-splitter.test.ts:

```Solidity
it('removeSplitter should fail if there are undistributed rewards', async () => {    
  const { accounts, controller, token, splitter0 } = await loadFixture(deployFixture)

  await token.transferAndCall(controller.target, toEther(100), '0x')
  await token.transfer(splitter0.target, toEther(100)) //simulate rewards

  await expect(controller.removeSplitter(accounts[0])).to.be.reverted
})
```

## Recommendations

Before calling splitter.withdraw\... in the removeSplitter function, update the balance:

```Solidity
...
balance = IERC20(lst).balanceOf(address(splitter));
splitter.withdraw(balance, _account);
...
```

# L02 - WithdrawalPool ::updateWithdrawalBatchIdCutoff - the withdrawalBatchIdCutoff is not correctly set

## Link: <https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/core/priorityPool/WithdrawalPool.sol#L393>

The value of newWithdrawalBatchIdCutoff is set at the end of the second for-loop, but it should be set at the beginning of the loop, because, if the "break" statement is executed, the correct value of newWithdrawalBatchIdCutoff won't be set.

## Proof of concept:

Add the following test to withdrawal-pool.test.ts:

```Solidity
it('withdrawalBatchIdCutoff is not correctly set in updateWithdrawalBatchIdCutoff', async () => {
  const { signers, accounts, withdrawalPool } = await loadFixture(deployFixture)

  //we queue 3 withdrawals for accounts[0] => this will add 3 new Withdrawals (withdrawalId 1 to 3) to the queuedWithdrawals array
  await withdrawalPool.queueWithdrawal(accounts[0], toEther(100)) 
  await withdrawalPool.queueWithdrawal(accounts[0], toEther(100)) 
  await withdrawalPool.queueWithdrawal(accounts[0], toEther(100)) 
  
  //we make a first deposit of 200 => this will add a new WithdrawalBatch (withdrawalBatch 1) to the withdrawalBatches array 
  //and this will service withdrawalId 1 & 2 => indexOfNextWithdrawal = 3
  await withdrawalPool.deposit(toEther(200)) 

  //we make a second deposit of 100 => this will add a new WithdrawalBatch (withdrawalBatch 2) to the withdrawalBatches array 
  //and this will service withdrawalId 3 => indexOfNextWithdrawal = 4
  await withdrawalPool.deposit(toEther(100)) 
  
  //perform a withdraw for accounts[0] => but, only for withdrawalId 1 & 2 => both are in withdrawalBatch 1
  await withdrawalPool.connect(signers[0]).withdraw([ 1,2 ], [1,1])  

  //before calling updateWithdrawalBatchIdCutoff, the withdrawalBatchIdCutoff will be 0
  console.log("withdrawalBatchIdCutoff 1: ", await withdrawalPool.withdrawalBatchIdCutoff()) //0
  assert.equal(await withdrawalPool.withdrawalBatchIdCutoff(), 0)

  await withdrawalPool.updateWithdrawalBatchIdCutoff()

  //after calling updateWithdrawalBatchIdCutoff, the withdrawalBatchIdCutoff should be 2, but it is actually 1
  //all batches before withdrawalBatch 2 have had all withdrawal requests fully withdrawn => so, the correct value is 2 !
  console.log("withdrawalBatchIdCutoff 2: ", await withdrawalPool.withdrawalBatchIdCutoff()) //1 => should be 2 !!!
  
  //the following test fails until necessary corrections are made in updateWithdrawalBatchIdCutoff
  assert.equal(await withdrawalPool.withdrawalBatchIdCutoff(), 2)
})
```

## Recommendations

Replace the second for-loop in the updateWithdrawalBatchIdCutoff function with the following code:

```Solidity
...
for (uint256 i = newWithdrawalBatchIdCutoff; i < numBatches; ++i) {
    newWithdrawalBatchIdCutoff = i;
    
    if (withdrawalBatches[i].indexOfLastWithdrawal >= newWithdrawalIdCutoff) {
        break;
    }

    newWithdrawalBatchIdCutoff = i;
}
...
```

# L03 - StakingPool - Owner cannot change the maximum allowed value for totalFeesBasisPoints

## Links:

<https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/core/StakingPool.sol#L76>
<https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/core/StakingPool.sol#L349>
<https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/core/StakingPool.sol#L373>

The contract uses hardcoded ("magic number") values for the max allowed totalFeesBasisPoints, which prevents the contract owner from modifying this value.

## Recommendations

Add an external setter function with an onlyOwner modifer and a corresponding state variable to the contract - similar to the setUnusedDepositLimit function.

# L04 - OperatorVCS::initialize - when the contract is upgraded to version3 there is no need to add additional Vault Groups

## Links: <https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/linkStaking/OperatorVCS.sol#L85C9-L87C10>

Vault Groups only need to be added when the contract is first deployed, when the contract is upgraded to version 3 (reinitializer(3)), those vaultGroups exist already and 5 additional Vault Groups will be added.

## Recommendations

Place the code section that adds the Vault Groups within the if-block in the initialize function:

```diff
function initialize(
    address _token,
    address _stakingPool,
    address _stakeController,
    address _vaultImplementation,
    Fee[] memory _fees,
    uint256 _maxDepositSizeBP,
    uint256 _vaultMaxDeposits,
    uint256 _operatorRewardPercentage,
    address _vaultDepositController
) public reinitializer(3) {
    if (address(token) == address(0)) {
        __VaultControllerStrategy_init(
            _token,
            _stakingPool,
            _stakeController,
            _vaultImplementation,
            _fees,
            _maxDepositSizeBP,
            _vaultMaxDeposits,
            _vaultDepositController
        );

        if (_operatorRewardPercentage > 10000) revert InvalidPercentage();
        operatorRewardPercentage = _operatorRewardPercentage;
        globalVaultState = GlobalVaultState(5, 0, 0, 0);
        
+       for (uint64 i = 0; i < 5; ++i) {
+           vaultGroups.push(VaultGroup(i, 0));
+       }
    } else {
        globalVaultState = GlobalVaultState(5, 0, 0, uint64(maxDepositSizeBP + 1));
        maxDepositSizeBP = _maxDepositSizeBP;
        delete fundFlowController;
        vaultMaxDeposits = _vaultMaxDeposits;
    }

-    for (uint64 i = 0; i < 5; ++i) {
-        vaultGroups.push(VaultGroup(i, 0));
-    }
}
```

## <a id='L-02'></a>L-02.  Oversight while Updating the basis fee in staking pool without updating rewards strategy

_Submitted by [0xtheblackpanther](https://profiles.cyfrin.io/u/undefined), [pyro](https://profiles.cyfrin.io/u/undefined), [0xsurena](https://profiles.cyfrin.io/u/undefined), [Dup1337](https://codehawks.cyfrin.io/team/cm1te5ors00079ybuhlx5k9h7), [bigsam](https://profiles.cyfrin.io/u/undefined), [bladesec](https://profiles.cyfrin.io/u/undefined), [coinymous](https://profiles.cyfrin.io/u/undefined). Selected submission by: [bigsam](https://profiles.cyfrin.io/u/undefined)._      
            




## Summary

The staking pool contract allows for updating new fees, but it fails to update the rewards before  fees reduction/increase, resulting in lower/higher-than-expected fees being taken from existing rewards. This causes overcharging/undercharging of fees on pending rewards

## Vulnerability Details

The issue arises in the \`Updatefee\` function, where updates of fees can be done by the contract owner without properly updating the reward calculations. This oversight causes the updated fee to be applied retroactively to pending rewards, leading to incorrect fee deductions.

 

\### Staking Pool Implementation:

 

```Solidity
 /**
     * @notice Updates an existing fee
     * @param _index index of fee
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
@audit>>1. >>     function updateFee(
        uint256 _index,
        address _receiver,
        uint256 _feeBasisPoints
    ) external onlyOwner {

  @audit>>2. no update >> 
  
      
   require(_index < fees.length, "Fee does not exist");

        if (_feeBasisPoints == 0) {
            fees[_index] = fees[fees.length - 1];
            fees.pop();
        } else {
            fees[_index].receiver = _receiver;
            fees[_index].basisPoints = _feeBasisPoints;
        }

        require(_totalFeesBasisPoints() <= 4000, "Total fees must be <= 40%");
    }

```

In the above implementation, the contract allows for updating new fees without updating the strategy rewards. As a result, q new fee structure is used for calculations alongside old rewards without adjusting for the rewards that have already accumulated. This can lead to undercharging/overcharging and reduces the accuracy of the reward system.

 

By contrast, the \`VaultController\` strategy takes care of this by updating the strategy rewards before updating a new fee:

```Solidity
 /**
     * @notice Updates an existing fee
     * @dev stakingPool.updateStrategyRewards is called to credit all past fees at
     * the old rate before the percentage changes
     * @param _index index of fee
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function updateFee(
        uint256 _index,
        address _receiver,
        uint256 _feeBasisPoints
    ) external onlyOwner {

@audit>>2. >>         _updateStrategyRewards();

        if (_feeBasisPoints == 0) {
            fees[_index] = fees[fees.length - 1];
            fees.pop();
        } else {
            fees[_index].receiver = _receiver;
            fees[_index].basisPoints = _feeBasisPoints;
        }

        if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();
    }

```

 

Here, the \`\_updateStrategyRewards\` function ensures that any rewards accumulated up to that point are properly distributed using the current fee rates before any new fees are added. This avoids retroactive changes to previously accrued rewards.

```Solidity
  /**
     * @notice Distributes rewards/fees based on balance changes in strategies since the last update
     * @param _strategyIdxs indexes of strategies to update rewards for
     * @param _data update data passed to each strategy
     **/
    function _updateStrategyRewards(uint256[] memory _strategyIdxs, bytes memory _data) private {
        int256 totalRewards;
        uint256 totalFeeAmounts;
        uint256 totalFeeCount;
        address[][] memory receivers = new address[][]();
        uint256[][] memory feeAmounts = new uint256[][]();

        // sum up rewards and fees across strategies
        for (uint256 i = 0; i < _strategyIdxs.length; ++i) {
            IStrategy strategy = IStrategy(strategies[_strategyIdxs[i]]);

            (
                int256 depositChange,
                address[] memory strategyReceivers,
                uint256[] memory strategyFeeAmounts
            ) = strategy.updateDeposits(_data);
            totalRewards += depositChange;

            if (strategyReceivers.length != 0) {
                receivers[i] = strategyReceivers;
                feeAmounts[i] = strategyFeeAmounts;
                totalFeeCount += receivers[i].length;
                for (uint256 j = 0; j < strategyReceivers.length; ++j) {
                    totalFeeAmounts += strategyFeeAmounts[j];
                }
            }
        }

        // update totalStaked if there was a net change in deposits
        if (totalRewards != 0) {
            totalStaked = uint256(int256(totalStaked) + totalRewards);
        }

        // calulate fees if net positive rewards were earned
        if (totalRewards > 0) {
            receivers[receivers.length - 1] = new address[]();
            feeAmounts[feeAmounts.length - 1] = new uint256[]();
            totalFeeCount += fees.length;

            for (uint256 i = 0; i < fees.length; i++) {
              
@audit>>3 . >>                receivers[receivers.length - 1][i] = fees[i].receiver;
@audit>>4 . >>                feeAmounts[feeAmounts.length - 1][i] =
                    (uint256(totalRewards) * fees[i].basisPoints) /
                    10000;
              
                totalFeeAmounts += feeAmounts[feeAmounts.length - 1][i];
            }
        }

        // safety check
@audit>>5 . >>        if (totalFeeAmounts >= totalStaked) {
            totalFeeAmounts = 0;
        }

        // distribute fees to receivers if there are any
@audit>>6 . >>        if (totalFeeAmounts > 0) {
@audit>>7 . >>            uint256 sharesToMint = (totalFeeAmounts * totalShares) /
                (totalStaked - totalFeeAmounts);
            _mintShares(address(this), sharesToMint);

            uint256 feesPaidCount;
            for (uint256 i = 0; i < receivers.length; i++) {
                for (uint256 j = 0; j < receivers[i].length; j++) {
                    if (feesPaidCount == totalFeeCount - 1) {
                        transferAndCallFrom(
                            address(this),
                            receivers[i][j],
                            balanceOf(address(this)),
                            "0x"
                        );
                    } else {
                        transferAndCallFrom(address(this), receivers[i][j], feeAmounts[i][j], "0x");
                        feesPaidCount++;
                    }
                }
            }
        }
```

## Impact

\- \*\*Incorrect Fee Calculation\*\*: The staking pool will apply new fees to the total pending rewards, which may include rewards that should have been calculated using the old fee structure.

\- \*\*Overcharging/Undercharging\*\*: As a result, the protocol will charge more/less fees than intended

## Tools Used

Manual Review

## Recommendations

To mitigate this issue, the contract should update the strategy rewards before any new fees are added. This ensures that pending rewards are credited using the current fee rate, preventing the new fee from being applied retroactively.

 

\### Suggested Solution:

 

Add a call to \`\_updateStrategyRewards\` before pushing new fees in the staking pool contract:

```Solidity
   /**
     * @notice Updates an existing fee
     * @param _index index of fee
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function updateFee(
        uint256 _index,
        address _receiver,
        uint256 _feeBasisPoints
    ) external onlyOwner {

++  _updateStrategyRewards();
      
        require(_index < fees.length, "Fee does not exist");

        if (_feeBasisPoints == 0) {
            fees[_index] = fees[fees.length - 1];
            fees.pop();
        } else {
            fees[_index].receiver = _receiver;
            fees[_index].basisPoints = _feeBasisPoints;
        }

        require(_totalFeesBasisPoints() <= 4000, "Total fees must be <= 40%");
    }
```

## <a id='L-03'></a>L-03. Overestimated Vault Group Capacity Due to globalVaultState.depositIndex Misuse in CommunityVCS::deposit Function

_Submitted by [tendency](https://profiles.cyfrin.io/u/undefined), [bugHunters69](https://codehawks.cyfrin.io/team/cm1w299xw0039d6qmvziel1vc). Selected submission by: [tendency](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

During deposits in the [`CommunityVCS::deposit`](https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/linkStaking/CommunityVCS.sol#L85-L115) function, when there has been an update in the vault deposit limits, the function incorrectly assumes `globalVaultState.depositIndex` equals the total number of vaults in groups, leading to inaccurate vault count and deposit capacity estimations.

## Vulnerability Details

When the [`CommunityVCS::deposit`](https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/linkStaking/CommunityVCS.sol#L85-L115) function is called by the staking pool, and the vault deposit limit has changed in the Chainlink staking contract, the total deposit rooms for all vault groups are adjusted. To better understand the issue, consider the following values:

* new maxDeposits = 500
* current vaultMaxDeposits = 400
* difference = 500 - 400 ==> 100
* totalVaults = globalVaultState.depositIndex ==> 8
* numVaultGroups = 5
* VaultsPerGroup = totalVaults / numVaultGroups ==> 1 (since Solidity rounds down)
* remainder = totalVaults % numVaultGroups ==> 3

From the loop through `numVaultGroups`, the following values are obtained:

* Group 0: numVaults = 1 + 1 = 2
* Group 1: numVaults = 1 + 1 = 2
* Group 2: numVaults = 1 + 1 = 2
* Group 3: numVaults = 1
* Group 4: numVaults = 1

For vault group 1, with 2 vaults, the total deposit room is `400 + 400 ==> 800`, and the updated room becomes `800 + 2 * 100 ==> 1000`.

The problem lies in using `globalVaultState.depositIndex`, which represents the next non-group vault, as seen in the [`VaultDepositController::_depositToVaults`](https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/linkStaking/base/VaultControllerStrategy.sol#L172-L292) function, only vaults `< globalVaultState.depositIndex` are considered part of a group:

```solidity
// vault must be a member of a group
if (vaultIndex >= globalState.depositIndex) revert InvalidVaultIds();
```

The `depositIndex` could sometimes also point to a vault that has not yet been deployed, this occurs when all non-group vaults are filled. The index will be incremented _[here](https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/linkStaking/base/VaultControllerStrategy.sol#L286)_ and updated _[here](https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/linkStaking/base/VaultControllerStrategy.sol#L289)_.

Thus, when `depositIndex = 5`, the total number of vaults in groups should be `5 - 1 = 4`.

Note that, for clarity, this report assumes that no deposits have been made into the groups yet. Typically, the deposit rooms for these groups would decrease as deposits are made.

## Impact

Some vault groups may appear to have more deposit room than they actually do. For instance, in group 2, the room appears as `400 + 2 * 100 ==> 600`, while in reality, with only one vault, the correct new room should be ` 400 + 1 * 100 ==> 500`.

## Tools Used

Manual Review

## Recommendations

Update the faulty logic in [`CommunityVCS::deposit`](https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/linkStaking/CommunityVCS.sol#L85-L115) to:

```diff
- uint256 totalVaults = globalVaultState.depositIndex;
+ uint256 totalVaults = globalVaultState.depositIndex - 1;
```

## <a id='L-04'></a>L-04. Upgrading `OperatorVCS` Contract Will Fail

_Submitted by [inh3l](https://profiles.cyfrin.io/u/undefined), [mikebello](https://profiles.cyfrin.io/u/undefined), [bugHunters69](https://codehawks.cyfrin.io/team/cm1w299xw0039d6qmvziel1vc), [emanherawy](https://profiles.cyfrin.io/u/undefined), [0xaman](https://profiles.cyfrin.io/u/undefined), [bladesec](https://profiles.cyfrin.io/u/undefined). Selected submission by: [emanherawy](https://profiles.cyfrin.io/u/undefined)._      
            


### Summary

The upgrade process for the `OperatorVCS` contract will fail due to a versioning conflict in the `initialize(...)` function. This occurs because of passing the same version number as the previous contract in the `reinitializer(...)` modifier. As a result, the new state variables introduced in the upgraded contract will not be initialized, leading to a failure in contract functionality.

### Vulnerability Details

The `OperatorVCS` contract being audited is an upgraded version of an already deployed contract ([proxy address](https://etherscan.io/address/0x4852e48215A4785eE99B640CACED5378Cc39D2A4), [implementation deployment](https://etherscan.io/address/0x584338dabae9e5429c334fc1ad41c46ac007bc29)). This new version introduces additional state variables, such as `_vaultMaxDeposits` and `_vaultDepositController`, which need to be initialized.

However, in the new version of the contract, the `initialize(...)` function is decorated with the `reinitializer(3)` modifier from OpenZeppelin. This modifier restricts the reinitialization process by allowing the function to be called only once, and only if the contract has not already been initialized to a version greater than `3`.

The issue arises because the previously deployed version of the contract also used `reinitializer(3)`. As a result, when attempting to upgrade, the modifier detects that version `3` has already been initialized, blocking the execution of the `initialize(...)` function in the new version. This effectively prevents the initialization of new state variables introduced in the upgraded contract.
**Audited Version of `OperatorVCS` Contract:**

```solidity
// @audit the audited version of OperatorVCS contract
function initialize(
    address _token,
    address _stakingPool,
    address _stakeController,
    address _vaultImplementation,
    Fee[] memory _fees,
    uint256 _maxDepositSizeBP,
    uint256 _vaultMaxDeposits, // new state variable
    uint256 _operatorRewardPercentage,
    address _vaultDepositController // new state variable
) public reinitializer(3) { // it was 3 in the previous version, this one should be 4
    if (address(token) == address(0)) {
        __VaultControllerStrategy_init(
            _token,
            _stakingPool,
            _stakeController,
            _vaultImplementation,
            _fees,
            _maxDepositSizeBP,
            _vaultMaxDeposits,
            _vaultDepositController
        );
    }
    // ...
}
```

**Deployed Version of `OperatorVCS` Contract:**

```solidity
// The deployed version of OperatorVCS contract
function initialize(
    address _token,
    address _stakingPool,
    address _stakeController,
    address _vaultImplementation,
    Fee[] memory _fees,
    uint256 _maxDepositSizeBP,
    uint256 _operatorRewardPercentage
) public reinitializer(3) { 
    if (address(token) == address(0)) {
        __VaultControllerStrategy_init(
            _token,
            _stakingPool,
            _stakeController,
            _vaultImplementation,
            _fees,
            _maxDepositSizeBP
        );
    }
    // ...
}
```

### Impact

The failure to upgrade the contract means that the new state variables introduced in the upgraded version (`_vaultMaxDeposits` and `_vaultDepositController`) will not be initialized, resulting in a critical failure for the new contract features. This will prevent the proper functioning of any logic that relies on these variables. The contract will revert whenever the `initialize(...)` function is called.

### Tools Used

* Manual review

## POC

```typescript
// add this file to /test folder 
// update hardhat.config.ts to include the following:
/*localhost: {
    url: 'http://127.0.0.1:8545',
    forking: {
      url: "https://eth-mainnet.g.alchemy.com/v2/<key>",
      blockNumber: 19185204

    }
  },*/
// run `npx hardhat node --fork https://eth-mainnet.g.alchemy.com/v2/<key>  --fork-block-number 19185204`
// npx hardhat test test/upgrade.attack.test.ts --network localhost

import hre,{ ethers ,upgrades} from 'hardhat'

import{ impersonateAccount } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from 'chai';


describe('StakingPool', () => {


it('Should fail when upgrading OperatorVCS because of the sed contract version ', async () => {

const ownerOrDeployer = "0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D"; // https://etherscan.io/address/0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D
const proxyAddress= "0x4852e48215A4785eE99B640CACED5378Cc39D2A4"; // https://etherscan.io/address/0x4852e48215A4785eE99B640CACED5378Cc39D2A4#code
const implementationContractName = "OperatorVCS";
await impersonateAccount(ownerOrDeployer);
const impersonatedSigner = await ethers.getSigner(ownerOrDeployer);
console.log("impersonatedSigner",impersonatedSigner.address);
await fundAccount(ownerOrDeployer);
// await startPrank(ownerOrDeployer);
const Contract = (await ethers.getContractFactory(implementationContractName)).connect(impersonatedSigner);
await expect(  upgrades.upgradeProxy(proxyAddress, Contract, {  call:{fn:'initialize', args:[ 
     ethers.ZeroAddress,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    [],
    0,
    0,0,  ethers.ZeroAddress]},
  kind: 'uups',
unsafeAllow: ['delegatecall'], 
unsafeSkipStorageCheck: true,
})).to.be.rejectedWith("Initializable: contract is already initialized");
// await contract.waitForDeployment()
// await stopPrank(ownerOrDeployer);

})

})


const stopPrank = async (wallet:string) => {
    await hre.network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [wallet],
      });

}

const startPrank = async (wallet:string) => {
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [wallet],
      });
    }
    const fundAccount = async (wallet: string) => {
        await hre.network.provider.send("hardhat_setBalance", [
          wallet,
          "0x" + ethers.parseEther("100").toString(16), 
        ]);
      };


```

### Recommendations

To resolve the issue, the version number in the `reinitializer(...)` modifier should be incremented from `3` to `4` in the new version of the contract. This will allow the `initialize(...)` function to execute successfully during the upgrade process and initialize the new state variables.

```solidity
reinitializer(4) // Update to the next version number
```

## <a id='L-05'></a>L-05. Cross-function Merkle Proof Usage Vulnerability

_Submitted by [8olidity](https://profiles.cyfrin.io/u/undefined), [cryptoticky](https://profiles.cyfrin.io/u/undefined), [auditweiler](https://profiles.cyfrin.io/u/undefined), [danzero](https://profiles.cyfrin.io/u/undefined), [bladesec](https://profiles.cyfrin.io/u/undefined). Selected submission by: [8olidity](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

Cross-function Merkle Proof Usage Vulnerability

## Vulnerability Details

In the current smart contract implementation, the `claimLSDTokens` and `unqueueTokens` functions may use the same Merkle tree structure and verification logic. This could allow a Merkle proof generated for one function to be used to call the other function, potentially leading to unauthorized operations or potential fund loss.

An attacker could potentially use a valid Merkle proof generated for `unqueueTokens` to call the `claimLSDTokens` function, or vice versa. This could result in unauthorized token claims or unqueuing operations, potentially leading to fund loss or inconsistent contract state.

```Solidity
function claimLSDTokens(
    uint256 _amount,
    uint256 _sharesAmount,
    bytes32[] calldata _merkleProof
) external {
    address account = msg.sender;

    bytes32 node = keccak256(
        bytes.concat(keccak256(abi.encode(account, _amount, _sharesAmount)))
    );
    if (!MerkleProofUpgradeable.verify(_merkleProof, merkleRoot, node)) revert InvalidProof();

    // ... subsequent code ...
}
```

## Impact

poc

```JavaScript
// file: test/core/priorityPool/priority-pool.test.ts
it('unqueueTokens should work correctly', async () => {
    const { signers, accounts, adrs, pp, token, stakingPool, strategy } = await loadFixture(
      deployFixture
    )

    await pp.deposit(toEther(2000), true, ['0x'])
    await pp.connect(signers[1]).deposit(toEther(500), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(500), true, ['0x'])
    await strategy.setMaxDeposits(toEther(1500))
    await pp.depositQueuedTokens(toEther(100), toEther(1000), ['0x'])

    await expect(pp.unqueueTokens(toEther(1501), 0, 0, [])).to.be.revertedWithCustomError(
      pp,
      'InsufficientQueuedTokens()'
    )

    await pp.connect(signers[1]).unqueueTokens(toEther(100), 0, 0, [])
    assert.equal(fromEther(await pp.totalQueued()), 1400)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9600)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], 0)), 400)

    let data = [
      [ethers.ZeroAddress, toEther(0), toEther(0)],
      [accounts[0], toEther(300), toEther(300)],
      [accounts[1], toEther(150), toEther(150)],
      [accounts[2], toEther(50), toEther(50)],
    ]
    let tree = StandardMerkleTree.of(data, ['address', 'uint256', 'uint256'])

    await pp.pauseForUpdate()
    await pp.updateDistribution(
      tree.root,
      ethers.encodeBytes32String('ipfs'),
      toEther(500),
      toEther(500)
    )

    await expect(
      pp
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(151), toEther(150), tree.getProof(2))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')
    await expect(
      pp
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(150), toEther(151), tree.getProof(2))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')
    await expect(
      pp
        .connect(signers[1])
        .unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(1))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')
    await expect(
      pp.unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(1))
    ).to.be.revertedWithCustomError(pp, 'InvalidProof()')

    await pp
      .connect(signers[1])
      .unqueueTokens(toEther(50), toEther(150), toEther(150), tree.getProof(2))
    assert.equal(fromEther(await pp.totalQueued()), 1350)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9650)
    assert.equal(fromEther(await pp.getLSDTokens(accounts[1], data[2][2])), 150)
    assert.equal(fromEther(await pp.getQueuedTokens(accounts[1], data[2][1])), 200)
    console.log(await stakingPool.balanceOf(accounts[1]))
    await pp.connect(signers[1]).claimLSDTokens(toEther(150), toEther(150), tree.getProof(2))
    console.log(await stakingPool.balanceOf(accounts[1]))
  })

  // output
    PriorityPool
    ✔ deposit should work correctly (481ms)
    ✔ deposit should work correctly with queued withdrawals
    ✔ depositQueuedTokens should work correctly (78ms)
    ✔ checkUpkeep should work correctly
    ✔ performUpkeep should work corectly (73ms)
    ✔ getAccountData should work correctly
    ✔ updateDistribution should work correctly
    ✔ claimLSDTokens should work correctly (51ms)
0n
150000000000000000000n
    ✔ unqueueTokens should work correctly (41ms)
    ✔ withdraw should work correctly
    ✔ withdraw should work correctly with queued withdrawals
    ✔ withdraw should work correctly with queued tokens (40ms)
    ✔ canWithdraw should work correctly
    ✔ onTokenTransfer should work correctly
    ✔ executeQueuedWithdrawals should work correctly
```

## Tools Used

vscode

## Recommendations

Include a function identifier in the Merkle node calculation:

```Solidity
bytes32 node = keccak256(
    bytes.concat(keccak256(abi.encode("claimLSDTokens", account, _amount, _sharesAmount)))
);
```

## <a id='L-06'></a>L-06. Potential Deposit Reverts Due to Removed Operator Vaults

_Submitted by [8olidity](https://profiles.cyfrin.io/u/undefined), [aksoy](https://profiles.cyfrin.io/u/undefined). Selected submission by: [aksoy](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

The `_depositToVaults` function in the `OperatorVCS::deposit` process lacks a mechanism to prevent deposits into vaults that have been removed from Chainlink's staking contract but not yet removed from the operator strategy. Since `removeVault` can only be called after the unbonding period ends, the function may attempt to deposit into a removed vault, causing transaction reverts that halt the deposit process.

## Vulnerability Details

When a vault is removed from Chainlink's staking contract, it must also be removed from the operator strategy by calling `queueVaultRemoval` followed by `removeVault`. However, `removeVault` cannot be executed immediately until the unbonding period concludes. This creates a delay where the vault remains in the operator strategy but has already been marked for removal in the Chainlink staking contract. If `_depositToVaults` attempts to deposit into such a vault, the Chainlink contract will revert the transaction.&#x20;

The `_depositToVaults` function handles deposits into vault groups as well as vaults that do not belong to a group. When depositing to group vaults, the function checks whether the vault has been removed:

```Solidity
        if (canDeposit != 0 && vaultIndex != group.withdrawalIndex && !vault.isRemoved()) {
            if (deposits < _minDeposits && toDeposit < (_minDeposits - deposits)) {
                break;
            }
```

<https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/linkStaking/base/VaultControllerStrategy.sol#L209>

However, when the function reaches the section where it deposits into vaults that do not yet belong to a group, it does not check if the vault has been removed:

```Solidity
    while (i < numVaults) {
        IVault vault = vaults[i];
        uint256 deposits = vault.getPrincipalDeposits();
        uint256 canDeposit = _maxDeposits - deposits;

        // cannot leave a vault with less than minimum deposits
        if (deposits < _minDeposits && toDeposit < (_minDeposits - deposits)) {
            break;
        }

        if (toDeposit > canDeposit) {
            vault.deposit(canDeposit);
            toDeposit -= canDeposit;
```

<https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/linkStaking/base/VaultControllerStrategy.sol#L264>

This can lead to a scenario where, if all the group vaults are full, the contract will attempt to deposit into a removed vault, causing a revert in the Chainlink staking contract. This prevents the users from depositing in to staking pool.

## Impact

Deposit could fail due to removed operator vaults

## Tools Used

manual

## Recommendations

Modify the `_depositToVaults` function to include a check that ensures a vault has not been removed before attempting to deposit into it, similar to how the function checks for group vaults.

```Solidity
    while (i < numVaults) {
        IVault vault = vaults[i];
        uint256 deposits = vault.getPrincipalDeposits();
        uint256 canDeposit = _maxDeposits - deposits;
+      if (vault.isRemoved()){
+        continue;
+      }
```

## <a id='L-07'></a>L-07. Upgrade Initialization Logic Will Never Execute Due to Incorrect Initializer Usage in CommunityVCS

_Submitted by [tinnohofficial](https://profiles.cyfrin.io/u/undefined), [0xaman](https://profiles.cyfrin.io/u/undefined). Selected submission by: [tinnohofficial](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

The CommunityVCS contract contains upgrade initialization logic within its initialize function that's guarded by the OpenZeppelin initializer modifier. Due to how this modifier works, the upgrade logic will never execute as the modifier will revert during upgrades, leaving the contract in a potentially inconsistent state.

## Vulnerability Details

The initialize function in CommunityVCS contains two paths: one for first-time initialization and another for upgrades, determined by checking if token address is zero. However, the entire function is guarded by OpenZeppelin's initializer modifier which prevents any subsequent calls after the first initialization. This means the upgrade path in the else block becomes unreachable code as the modifier will revert before reaching it.

```solidity
function initialize(...) public initializer {
    if (address(token) == address(0)) {
        // First initialization logic ...
    } else {
        // @audit Upgrade initialization - UNREACHABLE!
        globalVaultState = GlobalVaultState(5, 0, 0, uint64(maxDepositSizeBP + 1));
        maxDepositSizeBP = _maxDepositSizeBP;
        delete fundFlowController;
        vaultMaxDeposits = _vaultMaxDeposits;
    }
    // ...
}
```

as it can be seen below OpenZeppelin's `initializer` modifier ensures the function can only be called when `_initialized < 1`. And since `_initialized` is set to 1 on the proxy when the very first CommunityVCS version is initialized, it means that any other call to the initialize function would revert essentially making the else block in the function above unreachable.

```solidity
modifier initializer() {
        bool isTopLevelCall = !_initializing;
        require(
@>            (isTopLevelCall && _initialized < 1) || (!AddressUpgradeable.isContract(address(this)) && _initialized == 1),
            "Initializable: contract is already initialized"
        );
        _initialized = 1; // @audit this will be set on the proxy when the very first version is initialized
        if (isTopLevelCall) {
            _initializing = true;
        }
        _;
        if (isTopLevelCall) {
            _initializing = false;
            emit Initialized(1);
        }
    }
```

## PoC

1. Deploy CommunityVCS contract and call initialize() - succeeds
2. Upgrade the contract implementation
3. Try to call initialize() again - reverts with "Initializable: contract is already initialized"
4. upgrade initialization logic in the else block never executes

## Impact

The upgrade initialization logic that sets critical contract parameters (`globalVaultState`, `maxDepositSizeBP`, `fundFlowController`, `vaultMaxDeposits`) will never execute during upgrades. This could leave the contract in an inconsistent state with outdated or incorrect parameters, potentially affecting core functionality like deposit limits and vault management.

## Tools Used

Manual review

## Recommendations

Separate the initialization and upgrade logic into two distinct functions using OpenZeppelin's reinitializer pattern. \
Note: only add the reinitialize function in the implementation to be upgraded to

```diff
- function initialize(...) public initializer {
-     if (address(token) == address(0)) {
-         // First initialization
-         ...
-     } else {
-         // Upgrade initialization
-         ...
-     }
- }

+ function initialize(...) public initializer {
+     // First initialization only
+     __VaultControllerStrategy_init(...);
+     vaultDeploymentThreshold = _vaultDeploymentThreshold;
+     vaultDeploymentAmount = _vaultDeploymentAmount;
+     _deployVaults(_vaultDeploymentAmount);
+     globalVaultState = GlobalVaultState(5, 0, 0, 0);
+ }
+
+ // Add this function only when you want to do the upgrade
+ function reinitialize(...) public reinitializer(version) { // version could be 2, 3, etc
+     // Upgrade initialization
+     globalVaultState = GlobalVaultState(5, 0, 0, uint64(maxDepositSizeBP + 1));
+     maxDepositSizeBP = _maxDepositSizeBP;
+     delete fundFlowController;
+     vaultMaxDeposits = _vaultMaxDeposits;
+ }
```

## <a id='L-08'></a>L-08. No way to update unbonding and claim periods

_Submitted by [0xtheblackpanther](https://profiles.cyfrin.io/u/undefined), [federodes](https://profiles.cyfrin.io/u/undefined), [krisrenzo](https://profiles.cyfrin.io/u/undefined), [trtrth](https://profiles.cyfrin.io/u/undefined), [0xaman](https://profiles.cyfrin.io/u/undefined). Selected submission by: [0xtheblackpanther](https://profiles.cyfrin.io/u/undefined)._      
            


## Github

https://github.com/Cyfrin/2024-09-stakelink/blob/f5824f9ad67058b24a2c08494e51ddd7efdbb90b/contracts/linkStaking/FundFlowController.sol#L22-L25

## Summary

The **FundFlowController** contract has hardcoded values for unbonding and claim periods, while **Chainlink** can update these periods in their contracts via setters. This mismatch leads to discrepancies in timing, potentially causing issues with fund withdrawals. As Chainlink changes its periods, **FundFlowController** fails to stay in sync, resulting in delays or incorrect processing of user withdrawals.

## Where it occurs?

This issue arises in the **FundFlowController** contract, specifically in how it handles **unbonding and claim periods**. The contract relies on static time periods, which do not update dynamically when Chainlink modifies its own periods in related contracts.

```Solidity
// duration of the unbonding period in the Chainlink staking contract
uint64 public unbondingPeriod;
// duration of the claim period in the Chainlink staking contract
uint64 public claimPeriod;
```

## Actual Cause

The problem stems from **FundFlowController** using fixed, static time periods for unbonding and claiming, while **Chainlink** contracts have the flexibility to change these periods. The **FundFlowController** records the **start time** of the unbonding process but does not account for changes to the actual **end times** of unbonding and claim periods as set by Chainlink.

## Impact

If Chainlink modifies its unbonding or claim periods, the **FundFlowController** will operate based on outdated assumptions, leading to the following potential issues:

* **Withdrawal Delays**: Users can experience delays in accessing their funds if the actual periods shorten but the controller uses outdated timings.
* **Premature or Incorrect Withdrawals**: If the unbonding or claim periods are extended by Chainlink, withdrawals might be processed too early, resulting in failed transactions or reverted operations.
* **Locked Funds**: Users' funds may remain locked for longer than necessary, reducing liquidity and causing potential dissatisfaction with the system.

## Likelihood

The likelihood of this issue occurring is **low to moderate because** it is dependent on how frequently **Chainlink** modifies its periods. Given the evolving nature of Chainlink's contracts, there is a significant risk that these timing discrepancies will occur unless actively managed.

## Recommendations

1. **Dynamic Period Updates**: Modify the **FundFlowController** to dynamically fetch and synchronize the unbonding and claim periods from Chainlink's contracts, ensuring that the controller always operates based on the current period durations.

2. or better approach is to add setters for these values.


## <a id='L-09'></a>L-09. Wrong value emitted in Withdraw event

_Submitted by [saikumar279](https://profiles.cyfrin.io/u/undefined), [0xaraj](https://profiles.cyfrin.io/u/undefined), [ro1sharkm](https://profiles.cyfrin.io/u/undefined). Selected submission by: [saikumar279](https://profiles.cyfrin.io/u/undefined)._      
            


## Vulnerability Details

Below is the event in `PriorityPool` contract where `amount` should be equal to the total amount which the user has withdrawn.

event Withdraw(address indexed account, uint256 amount);

Below is the function responsible for withdrawing the staked amount.

```javascript

function withdraw(
        uint256 _amountToWithdraw,
        uint256 _amount,
        uint256 _sharesAmount,
        bytes32[] calldata _merkleProof,
        bool _shouldUnqueue,
        bool _shouldQueueWithdrawal
    ) external {
        if (_amountToWithdraw == 0) revert InvalidAmount();

        uint256 toWithdraw = _amountToWithdraw;
        address account = msg.sender;

        // attempt to unqueue tokens before withdrawing if flag is set
        if (_shouldUnqueue == true) {
            _requireNotPaused();

            if (_merkleProof.length != 0) {
                bytes32 node = keccak256(
                    bytes.concat(keccak256(abi.encode(account, _amount, _sharesAmount)))
                );
                if (!MerkleProofUpgradeable.verify(_merkleProof, merkleRoot, node))
                    revert InvalidProof();
            } else if (accountIndexes[account] < merkleTreeSize) {
                revert InvalidProof();
            }

            uint256 queuedTokens = getQueuedTokens(account, _amount);
            uint256 canUnqueue = queuedTokens <= totalQueued ? queuedTokens : totalQueued;
            uint256 amountToUnqueue = toWithdraw <= canUnqueue ? toWithdraw : canUnqueue;

            if (amountToUnqueue != 0) {
                accountQueuedTokens[account] -= amountToUnqueue;
                totalQueued -= amountToUnqueue;
                toWithdraw -= amountToUnqueue;
                emit UnqueueTokens(account, amountToUnqueue);
            }
        }

        // attempt to withdraw if tokens remain after unqueueing
        if (toWithdraw != 0) {
            IERC20Upgradeable(address(stakingPool)).safeTransferFrom(
                account,
                address(this),
                toWithdraw
            );
            toWithdraw = _withdraw(account, toWithdraw, _shouldQueueWithdrawal);
        }

        token.safeTransfer(account, _amountToWithdraw - toWithdraw);
    }

```

```javascript

function _withdraw(
        address _account,
        uint256 _amount,
        bool _shouldQueueWithdrawal
    ) internal returns (uint256) {
        if (poolStatus == PoolStatus.CLOSED) revert WithdrawalsDisabled();

        uint256 toWithdraw = _amount;

        if (totalQueued != 0) {
            uint256 toWithdrawFromQueue = toWithdraw <= totalQueued ? toWithdraw : totalQueued;

            totalQueued -= toWithdrawFromQueue;
            depositsSinceLastUpdate += toWithdrawFromQueue;
            sharesSinceLastUpdate += stakingPool.getSharesByStake(toWithdrawFromQueue);
            toWithdraw -= toWithdrawFromQueue;
        }

        if (toWithdraw != 0) {
            if (!_shouldQueueWithdrawal) revert InsufficientLiquidity();
            withdrawalPool.queueWithdrawal(_account, toWithdraw);
        }

        emit Withdraw(_account, _amount - toWithdraw);
        return toWithdraw;
    }
```

Here the emit Withdraw event should be emited in `PriorityPool::withdraw` function rather than `PriorityPool::_withdraw` because total tokens which are being transferred to the user is in `PriorityPool::withdraw` functione through token.transfer where withdarwn amount is equal to the `_amountToWithdraw - toWithdraw`.

## Poc

Consider a user with currently 2 tokens in a queue who wants to withdraw a total of 20 tokens. If the user sets `_shouldUnqueue` and `_shouldQueueWithdrawal` to true, the following happens:

1. In the `PriorityPool::withdraw` function:

   toWithdraw is initially set to 20.
   Since \_shouldUnqueue is true, toWithdraw becomes 18 (20 - 2). As it first withdraws from the tokens which it had transferred to queue.

2. The `PriorityPool::withdraw` function then calls `PriorityPool::_withdraw` with \_amount set as 18 which inturn sets `toWithdraw` as 18 in `PriorityPool::_withdraw`:

Assuming now total queued tokens are 5, `_withdraw` function reduces toWithdraw to 13 (18 - 5).
The Withdraw event is emitted with an amount of 5 (18 - 13), even though the total withdrawn amount is actually 7 (2 + 5).Where 2     is the tokens amount withdrawn in `PriorityPool::withdraw` function

## Impact

Frontend or other off-chain services may display incorrect values, potentially misleading users.

## Tools Used

Manual

## Recommendations

Instead of emiiting the event in `PriorityPool::_withdraw` do it in `PriorityPool::withdraw` as shown.

```diff

               function withdraw(
        uint256 _amountToWithdraw,
        uint256 _amount,
        uint256 _sharesAmount,
        bytes32[] calldata _merkleProof,
        bool _shouldUnqueue,
        bool _shouldQueueWithdrawal
    ) external {
        if (_amountToWithdraw == 0) revert InvalidAmount();

        uint256 toWithdraw = _amountToWithdraw;
        address account = msg.sender;

        // attempt to unqueue tokens before withdrawing if flag is set
        if (_shouldUnqueue == true) {
            _requireNotPaused();

            if (_merkleProof.length != 0) {
                bytes32 node = keccak256(
                    bytes.concat(keccak256(abi.encode(account, _amount, _sharesAmount)))
                );
                if (!MerkleProofUpgradeable.verify(_merkleProof, merkleRoot, node))
                    revert InvalidProof();
            } else if (accountIndexes[account] < merkleTreeSize) {
                revert InvalidProof();
            }

            uint256 queuedTokens = getQueuedTokens(account, _amount);
            uint256 canUnqueue = queuedTokens <= totalQueued ? queuedTokens : totalQueued;
            uint256 amountToUnqueue = toWithdraw <= canUnqueue ? toWithdraw : canUnqueue;

            if (amountToUnqueue != 0) {
                accountQueuedTokens[account] -= amountToUnqueue;
                totalQueued -= amountToUnqueue;
                toWithdraw -= amountToUnqueue;
                emit UnqueueTokens(account, amountToUnqueue);
            }
        }

        // attempt to withdraw if tokens remain after unqueueing
        if (toWithdraw != 0) {
            IERC20Upgradeable(address(stakingPool)).safeTransferFrom(
                account,
                address(this),
                toWithdraw
            );
            toWithdraw = _withdraw(account, toWithdraw, _shouldQueueWithdrawal);
        }

        token.safeTransfer(account, _amountToWithdraw - toWithdraw);
+      emit Withdraw(_account, _amountToWithdraw - toWithdraw);
    }

    function _withdraw(
        address _account,
        uint256 _amount,
        bool _shouldQueueWithdrawal
    ) internal returns (uint256) {
        if (poolStatus == PoolStatus.CLOSED) revert WithdrawalsDisabled();

        uint256 toWithdraw = _amount;

        if (totalQueued != 0) {
            uint256 toWithdrawFromQueue = toWithdraw <= totalQueued ? toWithdraw : totalQueued;

            totalQueued -= toWithdrawFromQueue;
            depositsSinceLastUpdate += toWithdrawFromQueue;
            sharesSinceLastUpdate += stakingPool.getSharesByStake(toWithdrawFromQueue);
            toWithdraw -= toWithdrawFromQueue;
        }

        if (toWithdraw != 0) {
            if (!_shouldQueueWithdrawal) revert InsufficientLiquidity();
            withdrawalPool.queueWithdrawal(_account, toWithdraw);
        }

-      emit Withdraw(_account, _amount - toWithdraw);
        return toWithdraw;
    }
```

## <a id='L-10'></a>L-10. Due To The `minWithdrawalAmount` check Users Who Want To Withdraw Wont Be Able To Queue Their Token Withdrawals On Some Amounts 

_Submitted by [mo_](https://profiles.cyfrin.io/u/undefined), [0xaraj](https://profiles.cyfrin.io/u/undefined), [josh4324](https://profiles.cyfrin.io/u/undefined), [yaioxy](https://profiles.cyfrin.io/u/undefined), [j1v9](https://profiles.cyfrin.io/u/undefined), [0xaman](https://profiles.cyfrin.io/u/undefined), [ChatGpt](https://profiles.cyfrin.io/u/undefined), [moo888](https://profiles.cyfrin.io/u/undefined). Selected submission by: [j1v9](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

On some certain amount when users want to withdraw their tokens in the prioriyPool and queue them in the withdrawalPool wouldn't be able to due to the queued tokens in the priotityPool being used to satisfy majority of the withdrawal and the rest passed into the `queueWithdrawal` function where the `minWithdrawalAmount` in the function hits even though there is enough liquidity to satisfy majority of the withdrawal.&#x20;

The user then has to either deposit more tokens, wait for more tokens to be queued into the priorityPool, if other users empty the queued tokens, the new queued tokens would also first be used to satisfy the queued withdrawals if any before the users remaining withdrawal can be processed.

## Vulnerability Details

In the priorityPool when users want to withdraw their tokens either through the `onTransferReceived` or `withdraw` function.\
The inner `_withdraw` function is called which in turn checks if there are any queued tokens in the priority pool\
and performs an exchange of the tokens to first satisfy as much of the withdrawal it can,\
then forwards the rest of the tokens that it cannot satisfy to the withdrawal pool to queue.

This is the functionality here in the `_withdraw` in the PriorityPool

```Solidity
uint256 toWithdraw = _amount;

// checks if the queued tokens can satisy as much as the withdrawal possible
if (totalQueued != 0) {
    uint256 toWithdrawFromQueue = toWithdraw <= totalQueued ? toWithdraw : totalQueued;

    totalQueued -= toWithdrawFromQueue;
    depositsSinceLastUpdate += toWithdrawFromQueue;
    sharesSinceLastUpdate += stakingPool.getSharesByStake(toWithdrawFromQueue);
    toWithdraw -= toWithdrawFromQueue;
}

// what couldnt be satisfied would be forwarded to the withdrawal pool to be queued
if (toWithdraw != 0) {
    if (!_shouldQueueWithdrawal) revert InsufficientLiquidity();
    withdrawalPool.queueWithdrawal(_account, toWithdraw);
}
```

If you notice the `toWithdraw` takes in the users amount of LST tokens to withdraw and then uses the `totalQueued` to satisfy some of the withdrawal amount.\
So once some of the tokens can be satisfied from the `totalQueued` the `toWithdraw` is reduced by the `toWithdrawFromQueue` and is passed on to the withdrawalPool to be queued via the `queueWithdrawal` function.

```solidity
function queueWithdrawal(
  address _account,
  uint256 _amount
) external onlyPriorityPool {
  // Where the issue occurs :-> The amount passed here would most likely be trimmed down by the tokens in the priority pool
  if (_amount < minWithdrawalAmount) revert AmountTooSmall();

  lst.safeTransferFrom(msg.sender, address(this), _amount);

  uint256 sharesAmount = _getSharesByStake(_amount);
  queuedWithdrawals.push(Withdrawal(uint128(sharesAmount), 0));
  totalQueuedShareWithdrawals += sharesAmount;

  uint256 withdrawalId = queuedWithdrawals.length - 1;
  queuedWithdrawalsByAccount[_account].push(withdrawalId);
  withdrawalOwners[withdrawalId] = _account;

  emit QueueWithdrawal(_account, _amount);
}
```

Inside the `queueWithdrawal` function is where the issue arises, the **reduced** `toWithdraw` amount is passed into the function and is immediately chcecked with the `minWithdrawalAmount`.

## Impact

If a situation occurs where most of the users withdrawal from the priorityPool is satisfied by the queued tokens before being sent to the `queueWithdrawal` function, the `_amount` passed would most likely be less than the minWithdawal amount and would lead to the entire withdrawal being reverted denying the user from queueing their tokens for withdrawal or claiming any part of their withdrawable amount.

## Recommendations

If a user chooses to queue their withdrawal when there is insufficient liquidity in the priorityPool's queued tokens, after subtracting what you can take from the pool, if the withdrawal amount thats left is less than the `minWithdrawalAmount` then queue the whole withdrawal amount instead.

## <a id='L-11'></a>L-11. Handling of Empty Data Arrays in StakingPool Causes Array Out-of-Bounds Access

_Submitted by [galturok](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

The `StakingPool` contract's `_depositLiquidity` function, which fails to properly handle scenarios where the internal system logic sets the data array to be empty. This results in an array out-of-bounds access that can cause unexpected transaction reverts. This issue arises not from user error, but from the contract itself during operational scenarios where using an empty data array is valid and expected.

## Vulnerability Details

The `_depositLiquidity` function iterates over the list of strategies to distribute deposited tokens while attempting to pass elements of the `_data` array to each strategy's `deposit` method.

<https://github.com/stakedotlink/contracts/blob/5070f79cafc3604c7c6972c38453c03f69633cdb/contracts/core/StakingPool.sol#L477C1-L492C6>

```solidity
    function _depositLiquidity(bytes[] calldata _data) private {
        uint256 toDeposit = token.balanceOf(address(this));
        if (toDeposit > 0) {
@>>         for (uint256 i = 0; i < strategies.length; i++) {
                IStrategy strategy = IStrategy(strategies[i]);
                uint256 strategyCanDeposit = strategy.canDeposit();
                if (strategyCanDeposit >= toDeposit) {
@>>                 strategy.deposit(toDeposit, _data[i]);
                    break;
                } else if (strategyCanDeposit > 0) {
                    strategy.deposit(strategyCanDeposit, _data[i]);
                    toDeposit -= strategyCanDeposit;
                }
            }
        }
    }

```

However, the function mistakenly assumes that the `_data` array will always be populated with entries corresponding to each strategy. As seen in the `FundFlowController.sol`, there are specific cases where this contract sets the data array to be empty intentionally:

**`getDepositData`** from `FundFlowController.sol` may return an empty data array as valid output under certain conditions, such as when there are no vaults or when allocations do not fill up the expected slots.

The VaultControllerStrategy.\_depositToVaults allows for empty data to pass the revert ckeck, and will " deposit into additional vaults that don't yet belong to a group".

<https://github.com/stakedotlink/contracts/blob/5070f79cafc3604c7c6972c38453c03f69633cdb/contracts/linkStaking/base/VaultControllerStrategy.sol#L172C1-L292C6>

```Solidity
    function _depositToVaults(
        uint256 _toDeposit,
        uint256 _minDeposits,
        uint256 _maxDeposits,
        uint64[] memory _vaultIds
    ) private returns (uint256) {
        uint256 toDeposit = _toDeposit;
        uint256 totalRebonded;
        GlobalVaultState memory globalState = globalVaultState;
        VaultGroup[] memory groups = vaultGroups;

        // deposits must continue with the vault they left off at during the previous call
@>>     if (_vaultIds.length != 0 && _vaultIds[0] != globalState.groupDepositIndex)
            revert InvalidVaultIds();

       //......

@>>  // deposit into additional vaults that don't yet belong to a group
        uint256 numVaults = vaults.length;
        uint256 i = globalState.depositIndex;

        while (i < numVaults) {
            IVault vault = vaults[i];
            uint256 deposits = vault.getPrincipalDeposits();
            uint256 canDeposit = _maxDeposits - deposits;

            // cannot leave a vault with less than minimum deposits
            if (deposits < _minDeposits && toDeposit < (_minDeposits - deposits)) {
                break;
            }

            if (toDeposit > canDeposit) {
                vault.deposit(canDeposit);
                toDeposit -= canDeposit;
            } else {
                vault.deposit(toDeposit);
                if (toDeposit < canDeposit) {
                    toDeposit = 0;
                    break;
                }
                toDeposit = 0;
            }

            ++i;
        }

        globalVaultState.depositIndex = uint64(i);

        return _toDeposit - toDeposit;
    }

```

# Impact

When an empty data array is expected internally by the system's own functions, the `StakingPool` faces a logic disconnect that results in array out-of-bounds access and transaction reverts.

## POC

In our Proof of Concept (PoC) setup, we will focus on recreating and demonstrating the specific vulnerability associated with handling empty data arrays within the `StakingPool` contract. Although there are multiple pathways for deposits, including normal deposits, `performUpkeep`, and handling of queued tokens, each capable of leading to the `deposit` function invocation, our test will specifically target the normal deposit process. By employing a direct deposit call with an empty data array, we aim to precisely trigger the array out-of-bounds access error. This method allows us to isolate the issue within the `_depositLiquidity` function without the complexity introduced by other operational pathways.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../lib/forge-std/src/Test.sol";
import "../contracts/core/priorityPool/PriorityPool.sol";
import "../contracts/core/priorityPool/WithdrawalPool.sol";
import "../contracts/core/StakingPool.sol";
import "./MockERC20.sol";
import "./SDLPoolMock.sol";
import "./LSTMock.sol";
import "./StrategyMock.sol";



contract PriorityPoolTest is Test {
    PriorityPool public priorityPool;
    PriorityPool public logic;
    ERC1967Proxy public priorityPoolproxy;
    ERC1967Proxy public withdrawalPoolproxy;
    ERC1967Proxy public stakingPoolProxy;
    ERC1967Proxy public strategyMockProxy;
    MockERC20 public mockToken;
    LSTMock public lstMock;
    WithdrawalPool public withdrawalPool;
    StakingPool public stakingPool;
    SDLPoolMock public sdlPool;
    StrategyMock public strategyMock;

    

    address public user = address(25);

    address public feeReceiver1 = address(0xBEE1);
    address public feeReceiver2 = address(0xBEE2);
    uint256 public unusedDepositLimit = 5 ether;

    function setUp() public {

        mockToken = new MockERC20("Mock Token", "MOCK", 1000 ether);

        sdlPool = new SDLPoolMock();

        lstMock = new LSTMock("LST Mock", "LST", 1000 ether);

        logic = new PriorityPool(); // Deploy the implementation contract

        // Define the fees
        StakingPool.Fee[] memory fees = new StakingPool.Fee[]();
        fees[0] = StakingPool.Fee({receiver: feeReceiver1, basisPoints: 100});
        fees[1] = StakingPool.Fee({receiver: feeReceiver2, basisPoints: 200});

        WithdrawalPool withdrawalPoolLogic = new WithdrawalPool();
        StakingPool stakingPoolLogic = new StakingPool();
        StrategyMock strategyMockLogic = new StrategyMock();

        

        stakingPoolProxy = new ERC1967Proxy(
            address(stakingPoolLogic),
            abi.encodeWithSelector(
                StakingPool.initialize.selector,
                address(mockToken), // Mock ERC20 token address
                "stakingToken",
                "SKT",
                fees,   // _fees
                unusedDepositLimit   // _unusedDepositLimit
            )
        );

        stakingPool = StakingPool(address(stakingPoolProxy));

        strategyMockProxy = new ERC1967Proxy(
            address(strategyMockLogic),
            abi.encodeWithSelector(
                StrategyMock.initialize.selector ,
                address(mockToken),
                address(stakingPool),
                100 ether,
                5 ether
                 )
        );

        strategyMock = StrategyMock(address(strategyMockProxy));

        // Deploy proxy with initialize function
        priorityPoolproxy = new ERC1967Proxy(
            address(logic),
            abi.encodeWithSelector(
                PriorityPool.initialize.selector,
                address(mockToken), // Mock ERC20 token address
                stakingPool,
                sdlPool,
                uint128(1 ether),   // queueDepositMin
                uint128(10 ether)   // queueDepositMax
            )
        );

        // Cast the proxy to PriorityPool
        priorityPool = PriorityPool(address(priorityPoolproxy));

        withdrawalPoolproxy = new ERC1967Proxy(
            address(withdrawalPoolLogic),
            abi.encodeWithSelector(
                WithdrawalPool.initialize.selector,
                address(mockToken), // Mock ERC20 token address
                address(stakingPool),
                address(priorityPool),
                uint256(1 ether),   // min withdraw
                uint64(1000)   // time between withdrawals
            )
        );

        withdrawalPool = WithdrawalPool(address(withdrawalPoolproxy));

        // Set Withdrawal Pool
        priorityPool.setWithdrawalPool(address(withdrawalPool));

        stakingPool.addStrategy(address(strategyMock));
        stakingPool.setPriorityPool(address(priorityPool));
        
    }



    function testDepositTokensEmptyData() public {
        uint256 initialBalance = mockToken.balanceOf(user);

        // Transfer some tokens to user
        mockToken.transfer(user, 100 ether);

        // Approve PriorityPool to spend user's tokens
        vm.startPrank(user);
        mockToken.approve(address(priorityPool), 100 ether);

        // Deposit tokens into the PriorityPool to chech impact of empty data
        priorityPool.deposit(50 ether, true, new bytes[](0));

        
        vm.stopPrank();
    }

}

```

Logs

```solidity

[FAIL. Reason: panic: array out-of-bounds access (0x32)] testDepositTokensEmptyData() (gas: 200325)
Traces:
  [200325] PriorityPoolTest::testDepositTokensEmptyData()
    ├─ [2562] MockERC20::balanceOf(0x0000000000000000000000000000000000000019) [staticcall]
    │   └─ ← [Return] 0
    ├─ [27834] MockERC20::transfer(0x0000000000000000000000000000000000000019, 100000000000000000000 [1e20])
    │   ├─ emit Transfer(from: PriorityPoolTest: [0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496], to: 0x0000000000000000000000000000000000000019, value: 100000000000000000000 [1e20])
    │   └─ ← [Return] true
    ├─ [0] VM::startPrank(0x0000000000000000000000000000000000000019)
    │   └─ ← [Return] 
    ├─ [24624] MockERC20::approve(ERC1967Proxy: [0xD6BbDE9174b1CdAa358d2Cf4D57D1a9F7178FBfF], 100000000000000000000 [1e20])
    │   ├─ emit Approval(owner: 0x0000000000000000000000000000000000000019, spender: ERC1967Proxy: [0xD6BbDE9174b1CdAa358d2Cf4D57D1a9F7178FBfF], value: 100000000000000000000 [1e20])
    │   └─ ← [Return] true
    ├─ [128444] ERC1967Proxy::deposit(50000000000000000000 [5e19], true, [])
    │   ├─ [123527] PriorityPool::deposit(50000000000000000000 [5e19], true, []) [delegatecall]
    │   │   ├─ [27722] MockERC20::transferFrom(0x0000000000000000000000000000000000000019, ERC1967Proxy: [0xD6BbDE9174b1CdAa358d2Cf4D57D1a9F7178FBfF], 50000000000000000000 [5e19])
    │   │   │   ├─ emit Approval(owner: 0x0000000000000000000000000000000000000019, spender: ERC1967Proxy: [0xD6BbDE9174b1CdAa358d2Cf4D57D1a9F7178FBfF], value: 50000000000000000000 [5e19])
    │   │   │   ├─ emit Transfer(from: 0x0000000000000000000000000000000000000019, to: ERC1967Proxy: [0xD6BbDE9174b1CdAa358d2Cf4D57D1a9F7178FBfF], value: 50000000000000000000 [5e19])
    │   │   │   └─ ← [Return] true
    │   │   ├─ [19688] ERC1967Proxy::getTotalQueuedWithdrawals() [staticcall]
    │   │   │   ├─ [14793] WithdrawalPool::getTotalQueuedWithdrawals() [delegatecall]
    │   │   │   │   ├─ [7384] ERC1967Proxy::getStakeByShares(0) [staticcall]
    │   │   │   │   │   ├─ [2486] StakingPool::getStakeByShares(0) [delegatecall]
    │   │   │   │   │   │   └─ ← [Return] 0
    │   │   │   │   │   └─ ← [Return] 0
    │   │   │   │   └─ ← [Return] 0
    │   │   │   └─ ← [Return] 0
    │   │   ├─ [17977] ERC1967Proxy::canDeposit() [staticcall]
    │   │   │   ├─ [17582] StakingPool::canDeposit() [delegatecall]
    │   │   │   │   ├─ [7298] ERC1967Proxy::getMaxDeposits() [staticcall]
    │   │   │   │   │   ├─ [2403] StrategyMock::getMaxDeposits() [delegatecall]
    │   │   │   │   │   │   └─ ← [Return] 100000000000000000000 [1e20]
    │   │   │   │   │   └─ ← [Return] 100000000000000000000 [1e20]
    │   │   │   │   └─ ← [Return] 100000000000000000000 [1e20]
    │   │   │   └─ ← [Return] 100000000000000000000 [1e20]
    │   │   ├─ [40759] ERC1967Proxy::deposit(0x0000000000000000000000000000000000000019, 50000000000000000000 [5e19], [])
    │   │   │   ├─ [40342] StakingPool::deposit(0x0000000000000000000000000000000000000019, 50000000000000000000 [5e19], []) [delegatecall]
    │   │   │   │   ├─ [2562] MockERC20::balanceOf(ERC1967Proxy: [0xA4AD4f68d0b91CFD19687c881e50f3A00242828c]) [staticcall]
    │   │   │   │   │   └─ ← [Return] 0
    │   │   │   │   ├─ [25498] MockERC20::transferFrom(ERC1967Proxy: [0xD6BbDE9174b1CdAa358d2Cf4D57D1a9F7178FBfF], ERC1967Proxy: [0xA4AD4f68d0b91CFD19687c881e50f3A00242828c], 50000000000000000000 [5e19])
    │   │   │   │   │   ├─ emit Transfer(from: ERC1967Proxy: [0xD6BbDE9174b1CdAa358d2Cf4D57D1a9F7178FBfF], to: ERC1967Proxy: [0xA4AD4f68d0b91CFD19687c881e50f3A00242828c], value: 50000000000000000000 [5e19])
    │   │   │   │   │   └─ ← [Return] true
    │   │   │   │   ├─ [562] MockERC20::balanceOf(ERC1967Proxy: [0xA4AD4f68d0b91CFD19687c881e50f3A00242828c]) [staticcall]
    │   │   │   │   │   └─ ← [Return] 50000000000000000000 [5e19]
    │   │   │   │   ├─ [3150] ERC1967Proxy::canDeposit() [staticcall]
    │   │   │   │   │   ├─ [2755] StrategyMock::canDeposit() [delegatecall]
    │   │   │   │   │   │   └─ ← [Return] 100000000000000000000 [1e20]
    │   │   │   │   │   └─ ← [Return] 100000000000000000000 [1e20]
    │   │   │   │   └─ ← [Revert] panic: array out-of-bounds access (0x32)
    │   │   │   └─ ← [Revert] panic: array out-of-bounds access (0x32)
    │   │   └─ ← [Revert] panic: array out-of-bounds access (0x32)
    │   └─ ← [Revert] panic: array out-of-bounds access (0x32)
    └─ ← [Revert] panic: array out-of-bounds access (0x32)
```

## Tools Used

Foundry

## Recommendations

Further research into related contracts and interactions beyond the immediate scope may be necessary to develop a comprehensive fix for this issue. However, as a possible immediate fix, the following adjustment can be made to allow the `_depositLiquidity` function to handle empty data arrays gracefully.

```solidity
function _depositLiquidity(bytes[] calldata _data) private {
    uint256 toDeposit = token.balanceOf(address(this));
    if (toDeposit > 0) {
        for (uint256 i = 0; i < strategies.length; i++) {
            IStrategy strategy = IStrategy(strategies[i]);
            uint256 strategyCanDeposit = strategy.canDeposit();

            // Check if _data array has an entry for the current strategy, use empty data if not
            bytes memory dataForStrategy = i < _data.length ? _data[i] : new bytes(0);

            if (strategyCanDeposit >= toDeposit) {
                strategy.deposit(toDeposit, dataForStrategy);
                break;
            } else if (strategyCanDeposit > 0) {
                strategy.deposit(strategyCanDeposit, dataForStrategy);
                toDeposit -= strategyCanDeposit;
            }
        }
    }
}

```

Retest after code fix

Logs

```solidity
Ran 1 test for test/poc1emptyData.t.sol:PriorityPoolTest
[PASS] testDepositTokensEmptyData() (gas: 306378)

```

## <a id='L-12'></a>L-12. The total amount to be distributed can be manipulated

_Submitted by [meeve](https://profiles.cyfrin.io/u/undefined), [trtrth](https://profiles.cyfrin.io/u/undefined), [krisrenzo](https://profiles.cyfrin.io/u/undefined). Selected submission by: [trtrth](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

The amount of tokens to be distributed at a new batch through function `PriorityPool#updateDistribution()` can be manipulated, which is the result of manipulating state variable `depositsSinceLastUpdate`

## Vulnerability Details

The function `PriorityPool#updateDistribution()` is expected to distributes a new batch of liquid staking tokens to users that have queued tokens. The amount to be distributed is expected to be total amount of queued tokens deposited into the staking pool since the last distribution, tracking by state variable `depositsSinceLastUpdate`.

```Solidity
    function updateDistribution(
        bytes32 _merkleRoot,
        bytes32 _ipfsHash,
        uint256 _amountDistributed,
        uint256 _sharesAmountDistributed
    ) external onlyDistributionOracle {
        _unpause();

@>        depositsSinceLastUpdate -= _amountDistributed;
@>        sharesSinceLastUpdate -= _sharesAmountDistributed;
        merkleRoot = _merkleRoot;
        ipfsHash = _ipfsHash;
        merkleTreeSize = accounts.length;

        emit UpdateDistribution(
            _merkleRoot,
            _ipfsHash,
            _amountDistributed,
            _sharesAmountDistributed
        );
    }
```

As confirmation from sponsor [here](https://discord.com/channels/1127263608246636635/1285876286585180161/1295521068555046984), the distributed amount is calculated off-chain. The calculation of `_amountDistributed` and `_sharesAmountDistributed` [is dependent on the state variables `depositsSinceLastUpdate` and `sharesSinceLastUpdate`](https://github.com/stakedotlink/priority-pool-ea/blob/67a9b8ac0600c0f4d9f1f4812323a7e27c47f21f/src/endpoint/merkle.ts#L246-L344).

From the onchain side, these two state variable can be increased when queued tokens are deposited to `StakingPool` through function `PriorityPool#_depositQueuedTokens()`.

```Solidity
    function _depositQueuedTokens(
        uint256 _depositMin,
        uint256 _depositMax,
        bytes[] memory _data
    ) internal {
        if (poolStatus != PoolStatus.OPEN) revert DepositsDisabled();

        uint256 strategyDepositRoom = stakingPool.getStrategyDepositRoom();
        if (strategyDepositRoom == 0 || strategyDepositRoom < _depositMin)
            revert InsufficientDepositRoom();

        uint256 _totalQueued = totalQueued;
        uint256 unusedDeposits = stakingPool.getUnusedDeposits();
        uint256 canDeposit = _totalQueued + unusedDeposits;
        if (canDeposit == 0 || canDeposit < _depositMin) revert InsufficientQueuedTokens();

        uint256 toDepositFromStakingPool = MathUpgradeable.min(
            MathUpgradeable.min(unusedDeposits, strategyDepositRoom),
            _depositMax
        );

        uint256 toDepositFromQueue = MathUpgradeable.min(
            MathUpgradeable.min(_totalQueued, strategyDepositRoom - toDepositFromStakingPool),
            _depositMax - toDepositFromStakingPool
        );

@>        stakingPool.deposit(address(this), toDepositFromQueue, _data);
        _totalQueued -= toDepositFromQueue;

        if (_totalQueued != totalQueued) {
            uint256 diff = totalQueued - _totalQueued;
@>            depositsSinceLastUpdate += diff;
@>            sharesSinceLastUpdate += stakingPool.getSharesByStake(diff); 
            totalQueued = _totalQueued; // @info totalQueued decreases ?
        }

        emit DepositTokens(toDepositFromStakingPool, toDepositFromQueue);
    }
```

And these variables can also be increased through function `PriorityPool#_withdraw()`, which is executed when a staker withdraws underlying assets. Specifically, the variables are increased when the staker withdraws an amount **not greater** than the current `totalQueued` amount.

```Solidity
    function _withdraw(
        address _account,
        uint256 _amount,
        bool _shouldQueueWithdrawal
    ) internal returns (uint256) {
        if (poolStatus == PoolStatus.CLOSED) revert WithdrawalsDisabled();

        uint256 toWithdraw = _amount;

        if (totalQueued != 0) {
            uint256 toWithdrawFromQueue = toWithdraw <= totalQueued ? toWithdraw : totalQueued;

            totalQueued -= toWithdrawFromQueue;
@>            depositsSinceLastUpdate += toWithdrawFromQueue;
@>            sharesSinceLastUpdate += stakingPool.getSharesByStake(toWithdrawFromQueue);
            toWithdraw -= toWithdrawFromQueue;
        }

        if (toWithdraw != 0) {
            if (!_shouldQueueWithdrawal) revert InsufficientLiquidity();
            withdrawalPool.queueWithdrawal(_account, toWithdraw);
        }

        emit Withdraw(_account, _amount - toWithdraw);
        return toWithdraw;
    }
```

With the mechanism above, an attacker can manipulate `depositsSinceLastUpdate` and `sharesSinceLastUpdate` by repeatedly deposit to queue and withdraw from queue

#### PoC

Add the test below to the test file `priority-pool.test.ts`:

```javascript
  it.only('withdraw should work correctly', async () => {
    // @audit PoC Manipulate depositsSinceLastUpdate
    const { signers, accounts, adrs, pp, token, stakingPool, strategy } = await loadFixture(
      deployFixture
    )

    await stakingPool.connect(signers[1]).approve(adrs.pp, ethers.MaxUint256)
    await stakingPool.connect(signers[2]).approve(adrs.pp, ethers.MaxUint256)
    await pp.connect(signers[1]).deposit(toEther(2000), true, ['0x'])
    await token.transfer(adrs.strategy, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await pp.deposit(toEther(100), true, ['0x'])
    await pp.connect(signers[2]).deposit(toEther(100), true, ['0x'])
    await strategy.setMaxDeposits(toEther(2000))
    

    console.log(`last deposits ${await pp.depositsSinceLastUpdate()}`)
    console.log(`total queued ${await pp.totalQueued()}`)

    for(let i = 0 ; i < 13; ++i){
      
      await pp.connect(signers[1]).withdraw(toEther(100), 0, 0, [], false, false)

      await pp.connect(signers[1]).deposit(toEther(100), true, ['0x'])
      
    }

    console.log(`last deposits ${await pp.depositsSinceLastUpdate()}`)
    console.log(`total queued ${await pp.totalQueued()}`)
  })
```

Run the test and the console shows:

```bash
last deposits 0
total queued 1200000000000000001000
last deposits 1300000000000000000000
total queued 1200000000000000001000
```

The result means that the `depositsSinceLastUpdate` is manipulated by repeatedly deposit and withdraw

## Impact

* The tracked amounts `depositsSinceLastUpdate` and `sharesSinceLastUpdate` are not precise
* The distributed amount can be manipulated, depends on off-chain system logic. If the off-chain system is tricked by the manipulation, then the funds to be distributed could be much larger than expected

## Tools Used

Manual

## Recommendations

Update the mechanism to increase/decrease these two variables

## <a id='L-13'></a>L-13. Incorrect update for state variable `sharesSinceLastUpdate` in contract `PriorityPool`

_Submitted by [trtrth](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

In flow of deposit queued tokens into staking pool, the state variable `sharesSinceLastUpdate` is improperly updated due to wrong implementation

## Vulnerability Details

The internal function `PriorityPool#_depositQueuedTokens` implements logic to deposit queued tokens into staking pool. The logic also updates state variables if there is deposit from queued tokens, specifically `totalQueued` changes. If the case happens, `sharesSinceLastUpdate` is added by an amount equals to `stakingPool.getSharesByStake(diff)`. However, the amount `stakingPool.getSharesByStake(diff)` is the amount of share calculated with contract state after `stakingPool.deposit(address(this), toDepositFromQueue, _data)`, meanwhile the actual amount minted for the deposit is calculated by the contract state before `stakingPool.deposit(address(this), toDepositFromQueue, _data)` is executed

```Solidity
    function _depositQueuedTokens(
        uint256 _depositMin,
        uint256 _depositMax,
        bytes[] memory _data
    ) internal {
        if (poolStatus != PoolStatus.OPEN) revert DepositsDisabled();

        uint256 strategyDepositRoom = stakingPool.getStrategyDepositRoom();
        if (strategyDepositRoom == 0 || strategyDepositRoom < _depositMin)
            revert InsufficientDepositRoom();

        uint256 _totalQueued = totalQueued;
        uint256 unusedDeposits = stakingPool.getUnusedDeposits();
        uint256 canDeposit = _totalQueued + unusedDeposits;
        if (canDeposit == 0 || canDeposit < _depositMin) revert InsufficientQueuedTokens();

        uint256 toDepositFromStakingPool = MathUpgradeable.min(
            MathUpgradeable.min(unusedDeposits, strategyDepositRoom),
            _depositMax
        );

        uint256 toDepositFromQueue = MathUpgradeable.min(
            MathUpgradeable.min(_totalQueued, strategyDepositRoom - toDepositFromStakingPool),
            _depositMax - toDepositFromStakingPool
        );

@>        stakingPool.deposit(address(this), toDepositFromQueue, _data);
        _totalQueued -= toDepositFromQueue;

@>        if (_totalQueued != totalQueued) {
            uint256 diff = totalQueued - _totalQueued;
            depositsSinceLastUpdate += diff;
@>            sharesSinceLastUpdate += stakingPool.getSharesByStake(diff);
            totalQueued = _totalQueued;
        }

        emit DepositTokens(toDepositFromStakingPool, toDepositFromQueue);
    }
```

## Impact

Offchain calculation for the distributions can be incorrect due to the wrongly tracked amount `sharesSinceLastUpdate`. This calculation can effectively affect protocol's funds in distribution flow

## Tools Used

Manual

## Recommendations

Update the order of the contract calls

## <a id='L-14'></a>L-14. The withdrawal index can be set to an index outside of the group, resulting in incorrect totalDepositRoom accounting

_Submitted by [focusoor](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

Vaults are distributed into vault groups. Each vault group has a withdrawal index that represents the next vault in the group from which a withdrawal operation will be performed. Additionally, every group has a totalDepositRoom, representing how much can be deposited across all the vaults in the group.

```solidity
struct VaultGroup {
    // index of next vault in the group to be withdrawn from
    uint64 withdrawalIndex;
    // total deposit room across all vaults in the group
    uint128 totalDepositRoom;
}
```

Besides vault groups, there are vaults that do not need to be part of a group. The next such vault that accepts deposits is represented by the `depositIndex` inside the GlobalVaultState.

```Solidity
struct GlobalVaultState {
    // total number of groups
    uint64 numVaultGroups;
    // index of the current unbonded group
    uint64 curUnbondedVaultGroup;
    // index of next vault to receive deposits across all groups
    uint64 groupDepositIndex;
    // index of next non-group vault to receive deposits
@>  uint64 depositIndex;
}
```

When there is a new deposit, the `_depositToVaults` function will be called on the strategy, specifically the `VaultControllerStrategy`, which is inherited by both `OperatorVCS` and `CommunityVCS`. The new deposit is performed by passing a list of vaultIds. If one of the vaults is a withdrawal vault in its group and does not have any deposits, the group will be updated so that the `withdrawalIndex` points to the next vault in the group.&#x20;

```Solidity
/**
     * @notice Deposits tokens into vaults
     * @param _toDeposit amount to deposit
     * @param _minDeposits minimum amount of deposits that a vault can hold
     * @param _maxDeposits minimum amount of deposits that a vault can hold
     * @param _vaultIds list of vaults to deposit into
     */
    function _depositToVaults(
        uint256 _toDeposit,
        uint256 _minDeposits,
        uint256 _maxDeposits,
        uint64[] memory _vaultIds
    ) private returns (uint256) {
        
        ...

        // deposit into vaults in the order specified in _vaultIds
        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            uint256 vaultIndex = _vaultIds[i];
            // vault must be a member of a group
            if (vaultIndex >= globalState.depositIndex) revert InvalidVaultIds();

            IVault vault = vaults[vaultIndex];
            uint256 groupIndex = vaultIndex % globalState.numVaultGroups;
            VaultGroup memory group = groups[groupIndex];
            uint256 deposits = vault.getPrincipalDeposits();
            uint256 canDeposit = _maxDeposits - deposits;

            globalState.groupDepositIndex = uint64(vaultIndex);

            // if vault is empty and equal to withdrawal index, increment withdrawal index to the next vault in the group
 @>           if (deposits == 0 && vaultIndex == group.withdrawalIndex) {
 @>               group.withdrawalIndex += uint64(globalState.numVaultGroups);
 @>               if (group.withdrawalIndex > globalState.depositIndex) {
 @>                   group.withdrawalIndex = uint64(groupIndex);
                }
            }
          
          ...
```

However, it is possible for the withdrawalIndex to become the depositIndex, meaning the next withdrawalIndex in the group could point to a vault that is not part of that group. This occurs because the withdrawalIndex only checks if the next index is greater than the depositIndex.

```Solidity
// if vault is empty and equal to withdrawal index, increment withdrawal index to the next vault in the group
            if (deposits == 0 && vaultIndex == group.withdrawalIndex) {
                group.withdrawalIndex += uint64(globalState.numVaultGroups);
   @>           if (group.withdrawalIndex > globalState.depositIndex) {
                    group.withdrawalIndex = uint64(groupIndex);
                }
            }
```

With the group’s withdrawalIndex set to the groupIndex, it is possible for this group to become the `curUnboundedVaultGroup`, meaning withdrawals will be possible from this group.

```Solidity
function updateVaultGroups(
        uint256[] calldata _curGroupVaultsToUnbond,
        uint256 _curGroupTotalDepositRoom,
        uint256 _nextGroup,
        uint256 _nextGroupTotalUnbonded
    ) external onlyFundFlowController {
        for (uint256 i = 0; i < _curGroupVaultsToUnbond.length; ++i) {
            vaults[_curGroupVaultsToUnbond[i]].unbond();
        }

        vaultGroups[globalVaultState.curUnbondedVaultGroup].totalDepositRoom = uint128(
            _curGroupTotalDepositRoom
        );
@>      globalVaultState.curUnbondedVaultGroup = uint64(_nextGroup);
        totalUnbonded = _nextGroupTotalUnbonded;
    }
```

With this group as the unbounded group, when a withdrawal is called inside `VaultControllerStrategy`, the `depositIndex` can be passed as the first `vaultId`. This index will be valid since it was previously set as the withdrawal index during a deposit.

```Solidity
    /**
     * @notice Withdraws tokens from vaults and sends them to staking pool
     * @dev called by VaultControllerStrategy using delegatecall
     * @param _amount amount to withdraw
     * @param _data encoded vault withdrawal order
     */
    function withdraw(uint256 _amount, bytes calldata _data) external {
        if (!fundFlowController.claimPeriodActive() || _amount > totalUnbonded)
            revert InsufficientTokensUnbonded();

        GlobalVaultState memory globalState = globalVaultState;
        uint64[] memory vaultIds = abi.decode(_data, (uint64[]));
        VaultGroup memory group = vaultGroups[globalState.curUnbondedVaultGroup];

        // withdrawals must continue with the vault they left off at during the previous call
@>      if (vaultIds[0] != group.withdrawalIndex) revert InvalidVaultIds();
```

If the vault with the depositIndex has some deposits and an active claim period for withdrawal, the withdrawal will go through this vault.

```Solidity
for (uint256 i = 0; i < vaultIds.length; ++i) {
            // vault must be a member of the current unbonded group
            if (vaultIds[i] % globalState.numVaultGroups != globalState.curUnbondedVaultGroup)
                revert InvalidVaultIds();

            group.withdrawalIndex = uint64(vaultIds[i]);
            IVault vault = vaults[vaultIds[i]];
            uint256 deposits = vault.getPrincipalDeposits();

@>           if (deposits != 0 && vault.claimPeriodActive() && !vault.isRemoved()) {
                if (toWithdraw > deposits) {
                    vault.withdraw(deposits);
                    unbondedRemaining -= deposits;
                    toWithdraw -= deposits;
                } else if (deposits - toWithdraw > 0 && deposits - toWithdraw < minDeposits) {
                    // cannot leave a vault with less than minimum deposits
                    vault.withdraw(deposits);
                    unbondedRemaining -= deposits;
                    break;
                } else {
                    vault.withdraw(toWithdraw);
                    unbondedRemaining -= toWithdraw;
                    break;
                }
            }
        }
```

The end result is that the totalDepositRoom will be increased by the withdrawn amount, even though part or all of that amount was withdrawn from a vault that is not part of that group. This will lead to inaccurate accounting, as the totalDepositRoom for this group will actually be lower than reported.

```Solidity
        totalDeposits -= totalWithdrawn;
        totalPrincipalDeposits -= totalWithdrawn;
        totalUnbonded = unbondedRemaining;

@>      group.totalDepositRoom += uint128(totalWithdrawn);
        vaultGroups[globalVaultState.curUnbondedVaultGroup] = group;
```

## Vulnerability Details

Vulnerable code: <https://github.com/Cyfrin/2024-09-stakelink/blob/main/contracts/linkStaking/base/VaultControllerStrategy.sol#L204>

Consider having 17 vaults:

```diff
 __. __. __. __. __. __. __. __. __. __. __. __. __. __. __. __. __
|__||__||__||__||__||__||__||__||__||__||__||__||__||__||__||__||__|
 0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16
```

Where first  16 vaults are parth of the 4 groups like this, and last vault is not part of any group.

```diff
 _________   _________   _________   _________
 | 0  | 4  | | 1  | 5  | | 2  | 6  | | 3  | 7  |
 |____|____| |____|____| |____|____| |____|____|
 | 8  | 12 | | 9  | 13 | |10  | 14 | |11  | 15 |
 |____|____| |____|____| |____|____| |____|____|  16
```

Here, the 16th vault is the `globalState.depositIndex`.\
During a deposit, if the **12th** vault is part of the vaultIds and it is the withdrawalIndex for group 0, the withdrawal index will be set to index 16. This is a valid index for group 0 because `16 % numOfGroups = 0`, but that vault is not part of the group.

```Solidity
if (deposits == 0 && vaultIndex == group.withdrawalIndex) {
@>  group.withdrawalIndex += uint64(globalState.numVaultGroups);
    if (group.withdrawalIndex > globalState.depositIndex) {
        group.withdrawalIndex = uint64(groupIndex);
    }
}
```

Later during withdraw phase, if group 0 becomes curUnboundedVaultGroup this check will pass:

```solidity
if (vaultIds[i] % globalState.numVaultGroups != globalState.curUnbondedVaultGroup)
                revert InvalidVaultIds();
```

This means the withdrawal will be executed from the 16th vault if possible, and an incorrect amount will be added to the depositRoom of group 0.

\
Impact
------

**Likelihood: Low**

Several conditions needs to be met for this to happen, making this low likelihood:

1. The vault with the withdrawal index needs to be empty during the deposit.
2. There must be a valid groupIndex that satisfies the condition `(withdrawalIndex + vault group size) = groupIndex`.
3. The group must become the `curUnboundedVaultGroup`.
4. The `groupIndex` vault must not be empty and should be in an active claim period.

**Impact: Medium**

The total depositRoom will be inaccurately updated for the group, which will lead to false assumptions and break functionality if the withdrawal amount is greater than the actual depositRoom for that group.

## Tools Used

Manual review.

## Recommendations

When checking for withdrawal index, use `>=` instead of `>` . This will make sure that withdrawalIndex is alway part of the group.

```diff
// if vault is empty and equal to withdrawal index, increment withdrawal index to the next vault in the group
            if (deposits == 0 && vaultIndex == group.withdrawalIndex) {
                group.withdrawalIndex += uint64(globalState.numVaultGroups);
-                if (group.withdrawalIndex > globalState.depositIndex) {
+                if (group.withdrawalIndex >= globalState.depositIndex) {
                    group.withdrawalIndex = uint64(groupIndex);
                }
            }
```


## <a id='L-15'></a>L-15. DepositTokens event in  PriorityPool does not emit the correct values

_Submitted by [josh4324](https://profiles.cyfrin.io/u/undefined)._      
            


## Summary

According to the event definition, the DepositTokens event is supposed to emit unusedTokensAmount and queuedTokensAmount, but it currently emits toDepositFromStakingPool, toDepositFromQueue which is generated from the unusedTokensAmount and queuedTokensAmount and other parameters.

## Impact

**Loss of Trust and Transparency**

One of the key purposes of emitting events in smart contracts is to provide transparency and ensure all actions within the contract can be tracked and verified by external observers (like users or dApps). If the wrong event is emitted:

* **Users will be misled**, which could result in a lack of trust in the contract or the dApp.
* The emitted logs may show inaccurate or incorrect information, damaging the overall reliability of the system.

## Tools Used

Manual Review

## Recommendations

```diff
function _depositQueuedTokens(uint256 _depositMin, uint256 _depositMax, bytes[] memory _data) internal {
        if (poolStatus != PoolStatus.OPEN) revert DepositsDisabled();

        uint256 strategyDepositRoom = stakingPool.getStrategyDepositRoom();
        if (strategyDepositRoom == 0 || strategyDepositRoom < _depositMin) {
            revert InsufficientDepositRoom();
        }

        uint256 _totalQueued = totalQueued;
        uint256 unusedDeposits = stakingPool.getUnusedDeposits();

        uint256 canDeposit = _totalQueued + unusedDeposits;
        if (canDeposit == 0 || canDeposit < _depositMin) revert InsufficientQueuedTokens();

        uint256 toDepositFromStakingPool =
            MathUpgradeable.min(MathUpgradeable.min(unusedDeposits, strategyDepositRoom), _depositMax);
        uint256 toDepositFromQueue = MathUpgradeable.min(
            MathUpgradeable.min(_totalQueued, strategyDepositRoom - toDepositFromStakingPool),
            _depositMax - toDepositFromStakingPool
        );

        stakingPool.deposit(address(this), toDepositFromQueue, _data);
        _totalQueued -= toDepositFromQueue;

        if (_totalQueued != totalQueued) {
            uint256 diff = totalQueued - _totalQueued;
            depositsSinceLastUpdate += diff;
            sharesSinceLastUpdate += stakingPool.getSharesByStake(diff);
            totalQueued = _totalQueued;
        }

        //   event DepositTokens(uint256 unusedTokensAmount, uint256 queuedTokensAmount);
-        emit DepositTokens(toDepositFromStakingPool, toDepositFromQueue);
+        emit DepositTokens(unusedDeposits, _totalQueued);
    }
```

## <a id='L-16'></a>L-16. Attacker Can Reset the Unbonding Period for Vaults in `globalState.curUnbondedVaultGroup`, Preventing User Withdrawals

_Submitted by [krisrenzo](https://profiles.cyfrin.io/u/undefined)._      
            


 

## Summary

StakeLink offers an advantage over direct Chainlink staking by providing readily available tokens for withdrawals. This is achieved by keeping one of five vault groups unbonded at any time. However, a malicious user can exploit the `PriorityPool::performUpkeep` function to intentionally rebond vaults in the `globalState.curUnbondedVaultGroup`, locking tokens that are supposed to be readily available for withdrawal. This effectively prevents users from withdrawing their tokens and interrupts the protocol's operation.

 

## Vulnerability Details

In Chainlink staking, if an unbonded staker adds to their deposit, the bonding period resets, locking the tokens again. StakeLink allows any user to call `PriorityPool::performUpkeep` to process queued deposits, with the user able to specify the target vaults through the encoded `_performData`.

The vulnerability lies in the `VaultDepositController::_depositToVaults` function, which processes deposits into the vaults:

```js
    function _depositToVaults(
        uint256 _toDeposit,
        uint256 _minDeposits,
        uint256 _maxDeposits,
        uint64[] memory _vaultIds
    ) private returns (uint256) {
        uint256 toDeposit = _toDeposit;
        uint256 totalRebonded;
        GlobalVaultState memory globalState = globalVaultState;
        VaultGroup[] memory groups = vaultGroups;

        // deposits must continue with the vault they left off at during the previous call
        if (_vaultIds.length != 0 && _vaultIds[0] != globalState.groupDepositIndex)
            revert InvalidVaultIds();

        // deposit into vaults in the order specified in _vaultIds
        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            uint256 vaultIndex = _vaultIds[i];
            if (vaultIndex >= globalState.depositIndex) revert InvalidVaultIds();

            // ...
        }
    }
```

The function only validates the first vault in the `_vaultIds` array, meaning a malicious user can pass an array of vaults targeting `globalState.curUnbondedVaultGroup` without triggering any errors. This allows the user to rebond vaults that should remain unbonded, reducing the protocol's ability to process withdrawals.

Additionally, if the protocol tries to withdraw tokens from a vault that isn't part of `globalState.curUnbondedVaultGroup`, the withdrawal will revert:

```js
// vault must be a member of the current unbonded group
if (vaultIds[i] % globalState.numVaultGroups != globalState.curUnbondedVaultGroup) revert InvalidVaultIds();
```

This means no tokens will be available for withdrawal, leading to frustrated users who are unable to access their funds.

 

## Impact

An attacker can effectively disrupt the protocol by preventing users from withdrawing their tokens. This attack costs the attacker nothing but time and can be executed repeatedly. It can cause severe financial and reputational damage to StakeLink, potentially driving users away from the platform and providing an unfair advantage to competitors.

 

## Tools Used

Manual

 

## Recommendations

Implement stricter validation within the `VaultDepositController::_depositToVaults` function to ensure that only valid vaults can be targeted. Additionally, limit the ability to target vaults in `globalState.curUnbondedVaultGroup` to prevent rebonding actions from locking up tokens meant to be available for withdrawal.

## <a id='L-17'></a>L-17. Incorrect `nextGroupTotalUnbonded` Calculation in `FundFlowController::_getVaultUpdateData` Includes Non-grouped Vaults, Leading to Potential Withdrawal and Deposit Errors

_Submitted by [krisrenzo](https://profiles.cyfrin.io/u/undefined)._      
            




&nbsp;

## Summary

The calculation for `nextGroupTotalUnbonded` in `FundFlowController::_getVaultUpdateData` incorrectly includes non-grouped vaults in its computation. The purpose of this function is to return data necessary to execute a vault group update for a strategy, excluding vaults that are not in the group. However, by including all vaults, both grouped and non-grouped, in the calculation, the returned `nextGroupTotalUnbonded` value becomes inaccurate. This leads to several downstream issues in the protocol, especially in the `updateVaultGroups` function, where this value is used for further calculations affecting withdrawals and deposits.

&nbsp;

## Vulnerability Details

The `_getVaultUpdateData` function is intended to calculate and return data only for grouped vaults, but it mistakenly includes non-grouped vaults in its calculation of `nextGroupTotalUnbonded`. Here’s the relevant code section:

```js
function _getVaultUpdateData(
    IVaultControllerStrategy _vcs,
    uint256 _nextUnbondedVaultGroup
) internal view returns (uint256[] memory, uint256, uint256) {
    address[] memory vaults = _vcs.getVaults();
    (, , , uint64 depositIndex) = _vcs.globalVaultState();

    (
        uint256 curGroupTotalDepositRoom,
        uint256[] memory curGroupVaultsToUnbond
    ) = _getTotalDepositRoom(
            vaults,
            numVaultGroups,
            curUnbondedVaultGroup,
            _vcs.vaultMaxDeposits(),
            depositIndex
        );

    uint256 nextGroupTotalUnbonded = _getTotalUnbonded(
        vaults,
        numVaultGroups,
        _nextUnbondedVaultGroup
    );

    return (curGroupVaultsToUnbond, curGroupTotalDepositRoom, nextGroupTotalUnbonded);
}
```

The issue lies in the fact that `_vcs.getVaults()` returns all vaults, both grouped and non-grouped, and passes them into `_getTotalUnbonded`. This causes all vaults to be factored into the `totalUnbonded` calculation:

```js
function _getTotalUnbonded(
    address[] memory _vaults,
    uint256 _numVaultGroups,
    uint256 _vaultGroup
) internal view returns (uint256) {
    uint256 totalUnbonded;

    for (uint256 i = _vaultGroup; i < _vaults.length; i += _numVaultGroups) {
        if (!IVault(_vaults[i]).claimPeriodActive() || IVault(_vaults[i]).isRemoved()) continue;

        totalUnbonded += IVault(_vaults[i]).getPrincipalDeposits();
    }

    return totalUnbonded;
}
```

The calculation erroneously includes non-grouped vaults, which can receive deposits once grouped vaults are full. These non-group vaults are only added to a group when the group deposit index reaches the next vault in the list. As a result, the `totalUnbonded` value returned is incorrect.

In contrast, the `_getTotalDepositRoom` function, called earlier in `_getVaultUpdateData`, correctly uses the `depositIndex` to ensure that non-grouped vaults are not included in its calculation:

```js
function _getTotalDepositRoom() {
    // ...
    for (uint256 i = _vaultGroup; i < _depositIndex; i += _numVaultGroups) {
        if (IVault(_vaults[i]).isRemoved()) continue;

        uint256 principalDeposits = IVault(_vaults[i]).getPrincipalDeposits();
        totalDepositRoom += _vaultMaxDeposits - principalDeposits;
        if (principalDeposits != 0) {
            nonEmptyVaults[numNonEmptyVaults] = i;
            numNonEmptyVaults++;
        }
    }
    // ...
}
```

Because `_getVaultUpdateData` is used in the `updateVaultGroups` function, this error leads to an incorrect `nextGroupOpVaultsTotalUnbonded` value, which affects the updates to both `operatorVCS` and `communityVCS`. This miscalculation can lead to several accounting issues, ultimately causing deposit and withdrawal functions to malfunction.

If the `totalUnbonded` value is higher than it should be, withdrawals could be blocked when the requested amount exceeds the incorrect `totalUnbonded` value.

&nbsp;

## Impact

The incorrect `totalUnbonded` value returned by `_getVaultUpdateData` leads to misaligned accounting in the `updateVaultGroups` function. This can cause:

- Blocked withdrawals if the system calculates an inflated `totalUnbonded` value that exceeds the available unbonded balance.
- Potentially malfunctioning deposit and withdrawal functions due to misalignment between grouped and non-grouped vault calculations.

These issues disrupt the protocol’s core operations, negatively impacting user experience and the protocol’s financial integrity.

&nbsp;

## Tools Used

Manual

&nbsp;

## Recommendations

Modify the `_getTotalUnbonded` function to exclude non-grouped vaults from its calculation by introducing a similar mechanism as used in `_getTotalDepositRoom`, ensuring that only grouped vaults are considered. This will align the `nextGroupTotalUnbonded` value with the actual vault state and prevent future miscalculations.



# <a id='resolved'></a>Resolved Findings

### List of resolution
   - High: 1
   - Medium: 5
   - Low: 8

## High risk
[H-01. No LSTs transfer on node operator withdrawals resulting in stuck funds and loss for node operators](#H-01-fix)

## Medium risk
[M-01. Remove splitter will always revert if there are some rewards left on splitter contract](M-01-fix)

[M-02. Removed vaults still remain valid in `OperatorVCS`](M-02-fix)

[M-03. [WithdrawalPool.sol] Prevent efficient return of data in getBatchIds() by blocking updateWithdrawalBatchIdCutoff() update of newWithdrawalIdCutoff](M-03-fix)

[M-05. Griefer can permanently DOS all the deposits to the `StakingPool`](M-05-fix)

[M-07. Principal amount of removed operator get's stuck in Chainlink's Staking Contract forever](M-07-fix)

## Low risk
[L-01. Low Findings  : L01 - L04](#L-01-fix)

[L-02.  Oversight while Updating the basis fee in staking pool without updating rewards strategy](#L-02-fix)

[L-04. Upgrading `OperatorVCS` Contract Will Fail](#L-04-fix)

[L-06. Potential Deposit Reverts Due to Removed Operator Vaults](#L-06-fix)

[L-07. Upgrade Initialization Logic Will Never Execute Due to Incorrect Initializer Usage in CommunityVCS](#L-07-fix)

[L-10. Due To The `minWithdrawalAmount` check Users Who Want To Withdraw Wont Be Able To Queue Their Token Withdrawals On Some Amounts](#L-10-fix)

[L-14. The withdrawal index can be set to an index outside of the group, resulting in incorrect totalDepositRoom accounting](#L-14-fix)

[L-17. Incorrect `nextGroupTotalUnbonded` Calculation in `FundFlowController::_getVaultUpdateData` Includes Non-grouped Vaults, Leading to Potential Withdrawal and Deposit Errors](#L-17-fix)



## <a id='H-01-fix'></a>H-01. No LSTs transfer on node operator withdrawals resulting in stuck funds and loss for node operators
### Code corrected
In function `_withdraw()`, a function call to LST token contract is added `lst.transferShares(_operator, sharesAmount)`

## <a id='M-01-fix'></a> M-01. Remove splitter will always revert if there are some rewards left on splitter contract
### Code corrected
The logic is corrected to withdraw `principalDeposits` amount from splitter contract, instead of the whole balance before `splitRewards()` is executed: `splitter.withdraw(splitter.principalDeposits(), _account)`

## <a id='M-02-fix'></a>M-02. Removed vaults still remain valid in `OperatorVCS`
### Code corrected
`delete vaultMapping[vault]` is added to address the issue

## <a id='M-03-fix'></a>M-03. [WithdrawalPool.sol] Prevent efficient return of data in getBatchIds() by blocking updateWithdrawalBatchIdCutoff() update of newWithdrawalIdCutoff
### Code corrected
A new function `forceWithdraw(uint256[],uint256[])` is added to contract `WithdrawalPool` to allow `owner` to manually withdraw the fully finialized withdrawals for the users.

## <a id='M-05-fix'></a>M-05. Griefer can permanently DOS all the deposits to the `StakingPool`
### Code corrected
A check is added `if (totalStaked == 0) revert NothingStaked()` to prevent donations when pool has no staked assets

## <a id='M-07-fix'></a>M-07. Principal amount of removed operator get's stuck in Chainlink's Staking Contract forever
### Code corrected
A new function `unbondVault(uint256)` is added to contract `OperatorVCS` to allow `owner` to manually unbond for a selected vault which is already removed from Chainlink Staking contract

## <a id='L-01-fix'></a>L-01. Low Findings  : L01 - L04

### Code corrected for L01, L02
#### L01 - LSTRewardsSplitterController::removeSplitter - LSTRewardSplitter cannot be removed if there are undistributed rewards
Resolve with [M-01](#M-01-fix)

#### L02 - WithdrawalPool ::updateWithdrawalBatchIdCutoff - the withdrawalBatchIdCutoff is not correctly set
The function `updateWithdrawalBatchIdCutoff()` is corrected to update `newWithdrawalBatchIdCutoff = i` before the `break` happens


## <a id='L-02-fix'></a>L-02.  Oversight while Updating the basis fee in staking pool without updating rewards strategy
### Code corrected
All strategies rewards is updated before the fee configuration is updated

## <a id='L-04-fix'></a>L-04. Upgrading `OperatorVCS` Contract Will Fail
#### Code corrected
Updated to use modifier `reinitializer(4)` for the next deployed version, instead of `reinitializer(3)`



## <a id='L-06-fix'></a>L-06. Potential Deposit Reverts Due to Removed Operator Vaults
#### Code corrected
Updated function `_depositToVaults()` of contract `VaultDepositController` to skip removed vaults when depositing into non-grouped vaults

## <a id='L-07-fix'></a>L-07. Upgrade Initialization Logic Will Never Execute Due to Incorrect Initializer Usage in CommunityVCS
#### Code corrected
Updated to use modifier `reinitializer(2)` for the next deployed version, instead of `initializer`


## <a id='L-10-fix'></a>L-10. Due To The `minWithdrawalAmount` check Users Who Want To Withdraw Wont Be Able To Queue Their Token Withdrawals On Some Amounts
#### Code corrected
Code is updated to check if the amount is at least `minWithdrawalAmount` before calling `WithdrawalPool.queueWithdrawal()` , otherwise refund the LST tokens to the user.

## <a id='L-14-fix'></a>L-14. The withdrawal index can be set to an index outside of the group, resulting in incorrect totalDepositRoom accounting
#### Code corrected
Code is updated to use `group.withdrawalIndex >= globalState.depositIndex` instead of `group.withdrawalIndex > globalState.depositIndex` to make sure that `withdrawalIndex` is always part of the group

## <a id='L-17-fix'></a>L-17. Incorrect `nextGroupTotalUnbonded` Calculation in `FundFlowController::_getVaultUpdateData` Includes Non-grouped Vaults, Leading to Potential Withdrawal and Deposit Errors
#### Code corrected
The function `_getTotalUnbonded()` is corrected to ensure only grouped vaults are included by updating the `for` loop to `for (uint256 i = _vaultGroup; i < _depositIndex; i += _numVaultGroups)`, instead of `for (uint256 i = _vaultGroup; i < vaults.length; i += _numVaultGroups)`
