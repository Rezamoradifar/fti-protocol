// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
interface IContinuityTimelock {
    function getMinDelay() external view returns(uint256);
    function PROPOSER_ROLE() external view returns(bytes32);
    function hasRole(bytes32,address) external view returns(bool);
}
interface IContinuityCouncil {function THRESHOLD() external view returns(uint8);}
library ContinuityGovernance {
    error InvalidGovernance();
    function validate(address gov,address council) internal view {
        if(gov.code.length==0||council.code.length==0)revert InvalidGovernance();
        if(IContinuityTimelock(gov).getMinDelay()!=72 hours||IContinuityCouncil(council).THRESHOLD()!=5)revert InvalidGovernance();
        if(!IContinuityTimelock(gov).hasRole(IContinuityTimelock(gov).PROPOSER_ROLE(),council))revert InvalidGovernance();
    }
}
