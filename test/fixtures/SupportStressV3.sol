// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {FTIReserveTokenV3} from "../../contracts/FTIReserveTokenV3.sol";
/// @notice TEST ONLY. Models reserve loss; these entry points are NOT in production ABI.
contract SupportStressV3 is FTIReserveTokenV3 {
    constructor(address stable,address gov,address council) FTIReserveTokenV3(stable,gov,council) {}
    function stressReserve(uint256 assets) external {
        require(msg.sender == deployer, "test deployer");
        reserve -= assets;
        require(usd.transfer(msg.sender, assets), "test transfer");
    }
    function repair() external { _supportPrice(); }
}
