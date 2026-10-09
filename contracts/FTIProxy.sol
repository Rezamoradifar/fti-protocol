// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC1967Proxy} from '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol';
/// @notice Initialize atomically at deployment; administration lives in UUPS governance.
contract FTIProxy is ERC1967Proxy {
    constructor(address implementation,bytes memory initialization) ERC1967Proxy(implementation,initialization){require(initialization.length>0,"initialization required");}
}
