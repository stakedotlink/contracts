// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {LinkStakingHandler as Handler} from "./handlers/LinkStakingHandler.sol";
import {Utils} from "./utils/Utils.sol";
import {ERC677} from "../../contracts/core/tokens/base/ERC677.sol";
import {Multicall3} from "../../contracts/core/test/Multicall3.sol";
import {PoolOwnersV1} from "../../contracts/core/test/v1/PoolOwnersV1.sol";
import {OwnersRewardsPoolV1} from "../../contracts/core/test/v1/OwnersRewardsPoolV1.sol";
import {PoolAllowanceV1} from "../../contracts/core/test/v1/PoolAllowanceV1.sol";
import {StakingAllowance} from "../../contracts/core/tokens/StakingAllowance.sol";
import {LPLMigration} from "../../contracts/core/tokens/LPLMigration.sol";
import {DelegatorPool} from "../../contracts/core/DelegatorPool.sol";
import {UUPSProxy} from "./proxy/UUPSProxy.sol";
import {StakingPool} from "../../contracts/core/StakingPool.sol";
import {RewardsPoolWSD} from "../../contracts/core/RewardsPoolWSD.sol";
import {WrappedSDToken} from "../../contracts/core/tokens/WrappedSDToken.sol";
import {PoolRouter} from "../../contracts/core/PoolRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TestContract is Test {
    address public admin;
    Handler public handler;
    ERC677 public lplToken;
    ERC677 public linkToken;
    Multicall3 public multicall;
    PoolOwnersV1 public poolOwners;
    OwnersRewardsPoolV1 public ownersRewardsPool;
    PoolAllowanceV1 public poolAllowance;
    StakingAllowance public sdlToken;
    LPLMigration public migration;
    DelegatorPool public delegatorPool;
    PoolRouter public poolRouter;
    StakingPool public stakingPool;
    RewardsPoolWSD public stLinkDelegatorRewardsPool;
    WrappedSDToken public wrappedSDToken;
    UUPSProxy public stakingPoolProxy;
    UUPSProxy public poolRouterProxy;
    UUPSProxy public delegatorPoolProxy;

    function setUp() public {
        admin = makeAddr("admin");
        _initSetUp();
        handler = new Handler(admin, delegatorPool);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = Handler.stakeSDL.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function test_stakeSDL() external {
        assertTrue(1 + 1 == 2);
    }

    function _initSetUp() internal {
        vm.startPrank(admin);
        lplToken = new ERC677("LinkPool", "LPL", 100000000);

        linkToken = new ERC677("Chainlink", "LINK", 1000000000);

        multicall = new Multicall3();

        poolOwners = new PoolOwnersV1(address(lplToken));

        ownersRewardsPool =
            new OwnersRewardsPoolV1(address(poolOwners), address(linkToken), "LinkPool Owners LINK", "lpoLINK");

        poolAllowance = new PoolAllowanceV1("LINK LinkPool Allowance", "linkLPLA", address(poolOwners));

        poolOwners.addRewardToken(address(linkToken), address(poolAllowance), address(ownersRewardsPool));

        sdlToken = new StakingAllowance("stake.link", "SDL");
        IERC20(address(sdlToken)).balanceOf(admin);
        migration = new LPLMigration(
            address(lplToken),
            address(sdlToken)
        );
        _deployDelegatorPoolProxy();
        _deployPoolRouterProxy();
        _deployStakingPoolProxy();

        wrappedSDToken = new WrappedSDToken(
            address(stakingPoolProxy),
            "Wrapped stLINK",
            "wstLINK"
        );
        stLinkDelegatorRewardsPool = new RewardsPoolWSD(
            address(delegatorPool),
            address(stakingPoolProxy),
            address(wrappedSDToken)
        );
        PoolRouter(payable(address(poolRouterProxy))).addPool(
            address(stakingPoolProxy), PoolRouter.PoolStatus.OPEN, true
        );

        delegatorPool.addToken(address(stakingPoolProxy), address(stLinkDelegatorRewardsPool));

        delegatorPool.setPoolRouter(address(poolRouterProxy));

        vm.stopPrank();
    }

    function _deployDelegatorPoolProxy() internal {
        DelegatorPool impl = new DelegatorPool();
        delegatorPoolProxy = new UUPSProxy(
            address(impl),
            abi.encodeWithSignature(
                "initialize(address,string,string,address[])",
                address(sdlToken),
                "Staked SDL",
                "stSDL",
                new address[](0)
            )
        );
        delegatorPool = DelegatorPool(address(delegatorPoolProxy));
    }

    function _deployPoolRouterProxy() internal {
        PoolRouter impl = new PoolRouter();
        poolRouterProxy = new UUPSProxy(
            address(impl),
            abi.encodeWithSignature(
                "initialize(address,address)",
                address(sdlToken),
                address(delegatorPool)
            )
        );
        poolRouter = PoolRouter(payable(address(poolRouterProxy)));
    }

    function _deployStakingPoolProxy() internal {
        StakingPool impl = new StakingPool();
        StakingPool.Fee[] memory fees = new StakingPool.Fee[](1);
        fees[0] = StakingPool.Fee(0x6879826450e576B401c4dDeff2B7755B1e85d97c, 300);
        stakingPoolProxy = new UUPSProxy(
            address(impl),
            abi.encodeWithSignature(
                "initialize(address,string,string,(address,uint256)[],address,address)",
                address(linkToken),
                "Staked LINK",
                "stLINK",
                fees,
                address(poolRouterProxy),
                address(delegatorPool)

            )
        );
        stakingPool = StakingPool(address(stakingPoolProxy));
    }
}
