// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ERC1967Utils} from '@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol';
import {MerkleProof} from '@openzeppelin/contracts/utils/cryptography/MerkleProof.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {FTIProxy} from './FTIProxy.sol';
import {ContinuityGovernance} from './ContinuityGovernance.sol';

/// @dev Temporary adapters never change the production storage layout. All their
/// own mutable state is namespaced, and imported slots cannot address that range.
library FTIMigrationSlots {
    bytes32 internal constant CONTROL = keccak256('FTI_ADDRESS_MIGRATION_CONTROL_V1');
    bytes32 internal constant IMPLEMENTATION = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant ADMIN = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    bytes32 internal constant BEACON = 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;
    uint256 internal constant PAGE = 64;
    struct Book {
        uint256 phase;
        bytes32 root;
        uint256 slots;
        uint256 copied;
        bytes32 lastSlot;
        bytes32 holderRoot;
        uint256 holders;
        uint256 indexedHolders;
        uint256 indexedSupply;
        address lastHolder;
        address peer;
        bool initialized;
    }
    function book(address coordinator) internal pure returns (Book storage s) {
        bytes32 location = keccak256(abi.encode(CONTROL,coordinator));
        assembly ("memory-safe") { s.slot := location }
    }
    function initializableSlot() internal pure returns (bytes32) {
        return keccak256(abi.encode(uint256(keccak256('openzeppelin.storage.Initializable')) - 1)) & ~bytes32(uint256(255));
    }
    function permitted(bytes32 key,address coordinator) internal pure returns (bool) {
        uint256 n = uint256(key);
        uint256 control = uint256(keccak256(abi.encode(CONTROL,coordinator)));
        return key != IMPLEMENTATION && key != ADMIN && key != BEACON &&
            !(n >= control && n < control + 32);
    }
    function read(bytes32 key) internal view returns (bytes32 value) { assembly ("memory-safe") { value := sload(key) } }
    function component(uint8 kind) internal pure returns (bytes32) {
        return kind == 0 ? keccak256('FTI_BINARY_CONTINUITY_V1') : keccak256('FTI_TOKEN_CONTINUITY_V1');
    }
}

interface IFTIMigrationSource {
    function arm() external;
    function migrationPhase() external view returns (uint256);
    function migrationCoordinator() external view returns (address);
    function readOriginal(bytes calldata data) external view returns (bytes memory);
    function readMigrationSlots(bytes32[] calldata keys) external view returns (bytes32[] memory);
    function releaseCollateral(uint256 minimum) external returns (uint256);
    function abortMigration() external;
}
interface IFTIMigrationCoordinator {
    function phase() external view returns (uint256);
    function targets(uint256) external view returns (address);
}

/// @dev A STATICCALL trampoline is essential: a bare delegatecall in a staging
/// fallback would expose live transfers, approvals and upgrades before cutover.
abstract contract FTIReadOnlyAdapter {
    address public immutable ORIGINAL_LOGIC;
    bytes32 public immutable ORIGINAL_CODE_HASH;
    address internal immutable SELF;
    address public immutable migrationCoordinator;
    uint8 public immutable KIND;
    constructor(address logic, address coordinator, uint8 kind) {
        require(logic.code.length != 0 && kind < 2, 'logic/kind');
        ORIGINAL_LOGIC = logic; ORIGINAL_CODE_HASH = logic.codehash;
        SELF = address(this); migrationCoordinator = coordinator; KIND = kind;
        (bool ok, bytes memory data) = logic.staticcall(abi.encodeWithSignature('COMPONENT_ID()'));
        require(ok && abi.decode(data,(bytes32)) == FTIMigrationSlots.component(kind), 'component');
    }
    function COMPONENT_ID() external view returns (bytes32) { return FTIMigrationSlots.component(KIND); }
    function proxiableUUID() external view returns (bytes32) {
        require(address(this) == SELF, 'implementation only'); return FTIMigrationSlots.IMPLEMENTATION;
    }
    function migrationPhase() external view returns (uint256) { return FTIMigrationSlots.book(migrationCoordinator).phase; }
    function readOriginal(bytes calldata data) external view returns (bytes memory) { return _original(data); }
    function _original(bytes memory data) internal view returns (bytes memory) {
        require(ORIGINAL_LOGIC.codehash == ORIGINAL_CODE_HASH, 'logic hash');
        (bool ok, bytes memory wrapped) = address(this).staticcall(abi.encodeCall(this.delegateStatic, (data)));
        if (!ok) assembly ("memory-safe") { revert(add(wrapped,32),mload(wrapped)) }
        return abi.decode(wrapped,(bytes));
    }
    function delegateStatic(bytes calldata data) external returns (bytes memory result) {
        require(msg.sender == address(this), 'self only');
        bool ok; (ok,result) = ORIGINAL_LOGIC.delegatecall(data);
        if (!ok) assembly ("memory-safe") { revert(add(result,32),mload(result)) }
    }
    function _word(string memory signature) internal view returns (uint256) {
        return abi.decode(_original(abi.encodeWithSignature(signature)),(uint256));
    }
    function _fallbackView() internal view {
        bytes memory result = _original(msg.data);
        assembly ("memory-safe") { return(add(result,32),mload(result)) }
    }
    modifier onlyCoordinator() { require(msg.sender == migrationCoordinator,'coordinator'); _; }
}

/// @notice Installed on an EXISTING UUPS source only through its existing
/// frozen, 5-of-7 / 72-hour governed upgrade. There is NO arbitrary withdrawal.
contract FTIAddressMigrationSource is FTIReadOnlyAdapter {
    using SafeERC20 for IERC20;
    address public immutable SOURCE;
    address public immutable GOVERNANCE;
    address public immutable COLLATERAL;
    address public immutable OLD_PEER;
    event SourceRetired(address indexed destination,uint256 collateral);
    event LateCollateralForwarded(address indexed destination,uint256 amount);
    constructor(address logic,address coordinator,uint8 kind,address source,address gov,address usd,address peer)
        FTIReadOnlyAdapter(logic,coordinator,kind) {
        SOURCE=source; GOVERNANCE=gov; COLLATERAL=usd; OLD_PEER=peer;
    }
    function arm() external {
        require(address(this)==SOURCE && msg.sender==GOVERNANCE,'source/governance');
        require(ERC1967Utils.getImplementation()==SELF && FTIMigrationSlots.book(migrationCoordinator).phase==0,'adapter/state');
        require(_word('recoveryFrozen()')==1,'not frozen');
        require(address(uint160(_word('governance()')))==GOVERNANCE,'governance changed');
        require(address(uint160(_word('usd()')))==COLLATERAL,'collateral changed');
        require(address(uint160(_word(KIND==0?'token()':'binary()')))==OLD_PEER,'binding changed');
        if(KIND==0) {
            require(_word('phase()')==0 && _word('monthPhase()')==0,'unfinished settlement');
            require(_word('jobCursor()')==_word('jobCount()'),'unfinished volume');
        } else require(_word('emergencyUnwind()')==0,'emergency source');
        (uint256 actual,uint256 accounted)=abi.decode(_original(abi.encodeWithSignature('accounting()')),(uint256,uint256));
        require(actual>=accounted,'unbacked source');
        // Native coin is not this protocol's accounting collateral. Refuse to
        // retire a source with unsupported native assets instead of dropping it.
        require(address(this).balance==0,'native assets need separate recovery');
        FTIMigrationSlots.book(migrationCoordinator).phase=1;
    }
    function recoveryFrozen() external pure returns(bool){return true;}
    function readMigrationSlots(bytes32[] calldata keys) external view returns(bytes32[] memory values) {
        require(address(this)==SOURCE && FTIMigrationSlots.book(migrationCoordinator).phase!=0,'not armed');
        require(keys.length>0 && keys.length<=FTIMigrationSlots.PAGE,'page size');
        values=new bytes32[](keys.length);
        for(uint256 i;i<keys.length;i++) {
            require(FTIMigrationSlots.permitted(keys[i],migrationCoordinator),'control slot'); values[i]=FTIMigrationSlots.read(keys[i]);
        }
    }
    function releaseCollateral(uint256 minimum) external onlyCoordinator returns(uint256 amount) {
        require(FTIMigrationSlots.book(migrationCoordinator).phase==1,'already retired');
        require(address(this).balance==0,'native assets need separate recovery');
        FTIMigrationSlots.book(migrationCoordinator).phase=4;
        if(KIND==0) IERC20(COLLATERAL).forceApprove(OLD_PEER,0);
        amount=_forward(minimum);
        FTIMigrationSlots.book(migrationCoordinator).phase=2;
        emit SourceRetired(IFTIMigrationCoordinator(migrationCoordinator).targets(KIND),amount);
    }
    function _forward(uint256 minimum) private returns(uint256 amount) {
        IERC20 usd=IERC20(COLLATERAL);
        address destination=IFTIMigrationCoordinator(migrationCoordinator).targets(KIND);
        require(destination.code.length>0 && destination!=SOURCE,'destination');
        amount=usd.balanceOf(address(this)); require(amount>=minimum,'collateral decreased');
        uint256 beforeBalance=usd.balanceOf(destination);
        if(amount!=0)usd.safeTransfer(destination,amount);
        require(usd.balanceOf(address(this))==0 && usd.balanceOf(destination)==beforeBalance+amount,'non-exact transfer');
    }
    function forwardLateCollateral() external returns(uint256 amount) {
        require(FTIMigrationSlots.book(migrationCoordinator).phase==2 && IFTIMigrationCoordinator(migrationCoordinator).phase()==2,'not retired');
        FTIMigrationSlots.book(migrationCoordinator).phase=4;
        amount=_forward(0);FTIMigrationSlots.book(migrationCoordinator).phase=2;emit LateCollateralForwarded(IFTIMigrationCoordinator(migrationCoordinator).targets(KIND),amount);
    }
    function abortMigration() external onlyCoordinator {
        require(FTIMigrationSlots.book(migrationCoordinator).phase==1,'cannot restore retired source');
        FTIMigrationSlots.book(migrationCoordinator).phase=3;
        ERC1967Utils.upgradeToAndCall(ORIGINAL_LOGIC,'');
    }
    fallback() external {
        require(FTIMigrationSlots.book(migrationCoordinator).phase==1,'source retired/inactive');
        _fallbackView();
    }
}

/// @notice Locked destination. Each bounded page is read FROM the frozen source
/// and must prove membership in the council-approved manifest. Caller-supplied
/// balances are never written. No public business call can mutate staged state.
contract FTIAddressMigrationTarget is FTIReadOnlyAdapter {
    using SafeERC20 for IERC20;
    address public immutable SOURCE;
    address public immutable GOVERNANCE;
    address public immutable COLLATERAL;
    address public immutable OLD_PEER;
    bytes32 public immutable LAYOUT_HASH;
    uint256 public immutable PEER_SLOT;
    uint8 public immutable PEER_OFFSET;
    event StoragePageImported(uint256 indexed page,uint256 slots);
    event Transfer(address indexed from,address indexed to,uint256 value);
    event MigrationHolderIndexed(address indexed holder,uint256 balance);
    constructor(address logic,address coordinator,uint8 kind,address source,address gov,address usd,address oldPeer,bytes32 layout,uint256 peerSlot,uint8 peerOffset)
        FTIReadOnlyAdapter(logic,coordinator,kind) {
        require(layout!=bytes32(0) && peerOffset<=12,'layout');
        SOURCE=source;GOVERNANCE=gov;COLLATERAL=usd;OLD_PEER=oldPeer;
        LAYOUT_HASH=layout;PEER_SLOT=peerSlot;PEER_OFFSET=peerOffset;
    }
    /// @notice Atomic initialization of the locked receiver, NOT a user genesis.
    function initializeMigration() external onlyCoordinator {
        FTIMigrationSlots.Book storage s=FTIMigrationSlots.book(migrationCoordinator);
        require(address(this)!=SELF && !s.initialized && s.phase==0,'already initialized');
        s.initialized=true;
    }
    function domain() public view returns(bytes32) {
        return keccak256(abi.encode(keccak256('FTI_ADDRESS_MIGRATION_V1'),block.chainid,migrationCoordinator,SOURCE,address(this),KIND,ORIGINAL_CODE_HASH,LAYOUT_HASH));
    }
    function configure(bytes32 root,uint256 slots,bytes32 holderRoot,uint256 holders,address peer) external onlyCoordinator {
        FTIMigrationSlots.Book storage s=FTIMigrationSlots.book(migrationCoordinator);
        require(s.initialized && s.phase==0 && root!=bytes32(0) && slots>0 && peer.code.length>0,'configuration');
        require(KIND==0?(holders==0 && holderRoot==bytes32(0)):(holders>0 && holderRoot!=bytes32(0)),'holder manifest');
        s.phase=1;s.root=root;s.slots=slots;s.holderRoot=holderRoot;s.holders=holders;s.peer=peer;
    }
    function progress() external view returns(uint256 copied,uint256 slots,uint256 indexedHolders,uint256 holders) {
        FTIMigrationSlots.Book storage s=FTIMigrationSlots.book(migrationCoordinator);return(s.copied,s.slots,s.indexedHolders,s.holders);
    }
    function importPage(bytes32[] calldata keys,bytes32[] calldata proof) external {
        FTIMigrationSlots.Book storage s=FTIMigrationSlots.book(migrationCoordinator);
        require(s.phase==1 && IFTIMigrationSource(SOURCE).migrationPhase()==1,'inactive source/target');
        uint256 remaining=s.slots-s.copied; uint256 length=remaining<FTIMigrationSlots.PAGE?remaining:FTIMigrationSlots.PAGE;
        require(keys.length==length && length>0,'page size');
        bytes32[] memory values=IFTIMigrationSource(SOURCE).readMigrationSlots(keys);
        uint256 page=s.copied/FTIMigrationSlots.PAGE;
        bytes32 leaf=keccak256(bytes.concat(keccak256(abi.encode(domain(),uint8(0),page,keys,values))));
        require(MerkleProof.verifyCalldata(proof,s.root,leaf),'invalid page proof');
        for(uint256 i;i<length;i++) {
            require(FTIMigrationSlots.permitted(keys[i],migrationCoordinator),'control slot');
            require(s.copied+i==0 || uint256(keys[i])>uint256(s.lastSlot),'unordered/duplicate slot');
            require(values[i]!=bytes32(0),'zero slot');
            bytes32 key=keys[i];bytes32 value=values[i];assembly ("memory-safe"){sstore(key,value)}
            s.lastSlot=key;
        }
        s.copied+=length;emit StoragePageImported(page,length);
    }
    function indexHolderPage(address[] calldata wallets,bytes32[] calldata proof) external {
        FTIMigrationSlots.Book storage s=FTIMigrationSlots.book(migrationCoordinator);
        require(KIND==1 && s.phase==1 && s.copied==s.slots,'not indexing');
        require(IFTIMigrationSource(SOURCE).migrationPhase()==1,'source inactive');
        uint256 remaining=s.holders-s.indexedHolders;uint256 length=remaining<FTIMigrationSlots.PAGE?remaining:FTIMigrationSlots.PAGE;
        require(length>0 && wallets.length==length,'page size');
        uint256[] memory balances=new uint256[](length);
        for(uint256 i;i<length;i++) {
            require(wallets[i]>s.lastHolder,'holder order');
            bytes memory callData=abi.encodeWithSignature('balanceOf(address)',wallets[i]);
            balances[i]=abi.decode(IFTIMigrationSource(SOURCE).readOriginal(callData),(uint256));
            require(abi.decode(_original(callData),(uint256))==balances[i],'holder balance mismatch');
            s.lastHolder=wallets[i];s.indexedSupply+=balances[i];
        }
        uint256 page=s.indexedHolders/FTIMigrationSlots.PAGE;
        bytes32 leaf=keccak256(bytes.concat(keccak256(abi.encode(domain(),uint8(1),page,wallets,balances))));
        require(MerkleProof.verifyCalldata(proof,s.holderRoot,leaf),'invalid holder proof');
        s.indexedHolders+=length;
        for(uint256 i;i<length;i++) {
            // New-token genesis ledger, not a fabricated historical trade.
            emit Transfer(address(0),wallets[i],balances[i]);emit MigrationHolderIndexed(wallets[i],balances[i]);
        }
    }
    function ready() public view returns(bool) {
        FTIMigrationSlots.Book storage s=FTIMigrationSlots.book(migrationCoordinator);
        if(s.phase!=1 || s.copied!=s.slots || s.indexedHolders!=s.holders)return false;
        if(KIND==1 && s.indexedSupply!=_word('totalSupply()'))return false;
        return true;
    }
    function activateFrozen() external onlyCoordinator {
        require(ready(),'incomplete import');
        FTIMigrationSlots.Book storage s=FTIMigrationSlots.book(migrationCoordinator);
        require(_word('recoveryFrozen()')==1,'not frozen');
        require(address(uint160(_word('governance()')))==GOVERNANCE && address(uint160(_word('usd()')))==COLLATERAL,'authority/assets');
        require(address(uint160(_word(KIND==0?'token()':'binary()')))==OLD_PEER,'source binding');
        // The production initializer must remain consumed on the new proxy.
        require(uint256(FTIMigrationSlots.read(FTIMigrationSlots.initializableSlot()))==1,'initializer missing');
        bytes32 key=bytes32(PEER_SLOT);uint256 word=uint256(FTIMigrationSlots.read(key));
        uint256 shift=uint256(PEER_OFFSET)*8;uint256 mask=uint256(type(uint160).max)<<shift;
        require(address(uint160(word>>shift))==OLD_PEER,'layout/binding mismatch');
        word=(word&~mask)|(uint256(uint160(s.peer))<<shift);assembly ("memory-safe"){sstore(key,word)}
        require(address(uint160(_word(KIND==0?'token()':'binary()')))==s.peer,'wrong binding slot');
        s.phase=2;
        if(KIND==0)IERC20(COLLATERAL).forceApprove(s.peer,type(uint256).max);
        (uint256 actual,uint256 accounted)=abi.decode(_original(abi.encodeWithSignature('accounting()')),(uint256,uint256));
        require(actual>=accounted,'unfunded destination');
        ERC1967Utils.upgradeToAndCall(ORIGINAL_LOGIC,'');
        // Recovery freeze stays true. Reopening needs the existing timelock,
        // AFTER independent post-cutover verification; never this coordinator.
    }
    function disable() external onlyCoordinator {require(FTIMigrationSlots.book(migrationCoordinator).phase<2,'activated');FTIMigrationSlots.book(migrationCoordinator).phase=3;}
    fallback() external {require(FTIMigrationSlots.book(migrationCoordinator).phase==1,'inactive target');_fallbackView();}
}

/// @notice A one-use, testnet-only two-component migration. Constructor deployment
/// creates LOCKED targets, never a fresh user genesis. Start/commit/abort belong
/// to the SOURCE timelock, not the deployer. Copying valid pages is permissionless.
contract FTIAddressMigration is ReentrancyGuard {
    address public immutable governance;
    address public immutable collateral;
    address public immutable council;
    address[2] public sources;
    address[2] public targets;
    address[2] public sourceAdapters;
    address[2] public targetAdapters;
    address[2] public originalLogic;
    uint256[2] public minimumCollateral;
    uint256 public phase; // 0 staged, 1 configured, 2 committed, 3 aborted
    bytes32 public reviewedManifest;
    event MigrationCreated(address indexed binarySource,address indexed tokenSource,address binaryTarget,address tokenTarget);
    event MigrationConfigured(bytes32 indexed reviewedManifest,bytes32 binaryRoot,bytes32 tokenRoot);
    event MigrationCommitted(bytes32 indexed reviewedManifest,uint256 binaryAssets,uint256 tokenAssets);
    event MigrationAborted();
    constructor(address[2] memory src,address[2] memory logic,bytes32[2] memory layout,uint256[2] memory peerSlots,uint8[2] memory peerOffsets) {
        require(block.chainid==97 || block.chainid==31337,'testnet/local only');
        require(src[0]!=src[1] && src[0].code.length>0 && src[1].code.length>0,'source pair');
        governance=_address(src[0],'governance()');collateral=_address(src[0],'usd()');council=_address(src[0],'guardian()');
        ContinuityGovernance.validate(governance,council);
        require(_address(src[1],'governance()')==governance && _address(src[1],'usd()')==collateral && _address(src[1],'guardianCouncil()')==council,'source authority');
        require(_address(src[0],'token()')==src[1] && _address(src[1],'binary()')==src[0],'source binding');
        sources=src;originalLogic=logic;
        for(uint8 i;i<2;i++) {
            targetAdapters[i]=address(new FTIAddressMigrationTarget(logic[i],address(this),i,src[i],governance,collateral,src[1-i],layout[i],peerSlots[i],peerOffsets[i]));
            targets[i]=address(new FTIProxy(targetAdapters[i],abi.encodeCall(FTIAddressMigrationTarget.initializeMigration,())));
            sourceAdapters[i]=address(new FTIAddressMigrationSource(logic[i],address(this),i,src[i],governance,collateral,src[1-i]));
        }
        // Protocol contracts cannot silently become stranded token holders.
        for(uint8 i;i<2;i++)require(_balance(src[1],src[i])==0,'source contract holds FTI');
        emit MigrationCreated(src[0],src[1],targets[0],targets[1]);
    }
    modifier onlyGovernance(){require(msg.sender==governance,'source timelock');_;}
    function _address(address target,string memory signature) private view returns(address) {
        (bool ok,bytes memory data)=target.staticcall(abi.encodeWithSignature(signature));require(ok,'source read');return abi.decode(data,(address));
    }
    function _balance(address token,address who) private view returns(uint256) {
        (bool ok,bytes memory data)=token.staticcall(abi.encodeWithSignature('balanceOf(address)',who));require(ok,'balance read');return abi.decode(data,(uint256));
    }
    function configure(bytes32[2] calldata roots,uint256[2] calldata counts,bytes32 holderRoot,uint256 holders,bytes32 manifest) external onlyGovernance {
        require(phase==0 && manifest!=bytes32(0),'already configured');
        for(uint8 i;i<2;i++) {
            require(IFTIMigrationSource(sources[i]).migrationCoordinator()==address(this) && IFTIMigrationSource(sources[i]).migrationPhase()==1,'source not armed');
            minimumCollateral[i]=IERC20(collateral).balanceOf(sources[i]);
            FTIAddressMigrationTarget(targets[i]).configure(roots[i],counts[i],i==1?holderRoot:bytes32(0),i==1?holders:0,targets[1-i]);
        }
        reviewedManifest=manifest;phase=1;emit MigrationConfigured(manifest,roots[0],roots[1]);
    }
    function commit(bytes32 independentlyVerifiedManifest) external onlyGovernance nonReentrant {
        require(phase==1 && independentlyVerifiedManifest==reviewedManifest,'manifest/state');
        for(uint8 i;i<2;i++)require(FTIAddressMigrationTarget(targets[i]).ready(),'incomplete import');
        phase=2;
        uint256 b=IFTIMigrationSource(sources[0]).releaseCollateral(minimumCollateral[0]);
        uint256 t=IFTIMigrationSource(sources[1]).releaseCollateral(minimumCollateral[1]);
        for(uint8 i;i<2;i++)FTIAddressMigrationTarget(targets[i]).activateFrozen();
        require(_address(targets[0],'token()')==targets[1] && _address(targets[1],'binary()')==targets[0],'destination pair');
        emit MigrationCommitted(reviewedManifest,b,t);
    }
    function abort() external onlyGovernance nonReentrant {
        require(phase<2,'committed/aborted');phase=3;
        for(uint8 i;i<2;i++) {
            (bool ok,bytes memory data)=sources[i].staticcall(abi.encodeWithSignature('migrationCoordinator()'));
            if(ok && data.length==32 && abi.decode(data,(address))==address(this))IFTIMigrationSource(sources[i]).abortMigration();
            FTIAddressMigrationTarget(targets[i]).disable();
        }
        emit MigrationAborted();
    }
}
