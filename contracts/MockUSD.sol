// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
/// @notice Testnet only. Public faucet. Never use as real collateral.
contract MockUSD is ERC20 {
    constructor() ERC20('TEST ONLY USD','tUSD') {require(block.chainid!=56,'not mainnet');}
    mapping(address=>bool) public blocked;
    function setBlocked(address who,bool value) external {blocked[who]=value;}
    function _update(address from,address to,uint256 amount) internal override {require(!blocked[to],'mock recipient blocked');super._update(from,to,amount);}
    function faucet() external {_mint(msg.sender,1000000e18);}
}
