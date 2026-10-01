// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {FTIReserveToken} from './FTIReserveToken.sol';
// TEST ONLY: simulates a monotonically advancing registration clock without thousands of transactions.
contract ClockReserveToken is FTIReserveToken {
    constructor(address stable,address gov,address emergency) FTIReserveToken(stable,gov,emergency) {}
    function advanceTestClock(uint256 value) external {require(value>=walletClock,'monotone');walletClock=value;}
}
