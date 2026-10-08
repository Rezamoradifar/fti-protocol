// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
contract HostileUSD is ERC20 {
    uint256 public feeMode;
    address public callback;
    bytes public payload;
    bool public attempted;
    bool public succeeded;
    constructor() ERC20('Hostile test collateral', 'BAD') {}
    function mint(address who, uint256 amount) external { _mint(who, amount); }
    function burn(address who, uint256 amount) external { _burn(who, amount); }
    function setFeeMode(uint256 mode) external { feeMode = mode; }
    function setCallback(address target, bytes calldata data) external { callback=target; payload=data; }
    function transfer(address to, uint256 amount) public override returns(bool) {
        if(callback!=address(0)){attempted=true;(succeeded,)=callback.call(payload);}
        return super.transfer(to,amount);
    }
    function transferFrom(address from, address to, uint256 amount) public override returns(bool) {
        if(callback!=address(0)){attempted=true;(succeeded,)=callback.call(payload);}
        return super.transferFrom(from,to,amount);
    }
    function _update(address from,address to,uint256 amount) internal override {
        super._update(from,to,amount);
        if(from!=address(0)&&to!=address(0)&&amount>=100){
            if(feeMode==1)super._update(to,address(0),amount/100);
            if(feeMode==2)super._update(from,address(0),amount/100);
        }
    }
}
