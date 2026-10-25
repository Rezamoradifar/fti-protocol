// A chain-scoped EIP-1193 bridge around the official WalletConnect transport.
// This module never signs, authorizes an account or starts a pairing on import.
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const REQUIRED_METHODS=['eth_sendTransaction','personal_sign'];
const OPTIONAL_METHODS=['eth_requestAccounts','wallet_switchEthereumChain','wallet_addEthereumChain','wallet_watchAsset','eth_signTypedData','eth_signTypedData_v3','eth_signTypedData_v4','wallet_getPermissions','wallet_requestPermissions','wallet_getCapabilities','wallet_sendCalls','wallet_getCallsStatus'];
const WALLET_METHODS=new Set([...REQUIRED_METHODS,...OPTIONAL_METHODS,'eth_sign','eth_signTransaction']);
const READ_METHODS=new Set(['eth_blockNumber','eth_call','eth_estimateGas','eth_gasPrice','eth_feeHistory','eth_maxPriorityFeePerGas','eth_getBalance','eth_getCode','eth_getTransactionCount','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getTransactionByBlockHashAndIndex','eth_getTransactionByBlockNumberAndIndex','eth_getBlockByNumber','eth_getBlockByHash','eth_getBlockTransactionCountByHash','eth_getBlockTransactionCountByNumber','eth_getLogs','eth_getStorageAt','eth_getProof','net_version','web3_clientVersion']);
const failure=(message,code)=>Object.assign(Error(message),{code});
const chainNumber=value=>{
 const raw=typeof value==='string'&&value.startsWith('eip155:')?value.slice(7):value;
 if(typeof raw!=='number'&&typeof raw!=='string')return null;
 if(typeof raw==='string'&&!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(raw))return null;
 const number=Number(raw);return Number.isSafeInteger(number)&&number>0?number:null;
};
function accountsFor(session,chainId){
 const prefix='eip155:'+chainId+':',accounts=[];
 for(const [key,namespace]of Object.entries(session?.namespaces||{})){
  if(key!=='eip155'&&key!=='eip155:'+chainId)continue;
  for(const value of namespace.accounts||[])if(typeof value==='string'&&value.startsWith(prefix)){
   const address=value.slice(prefix.length);if(ADDRESS.test(address)&&!accounts.some(a=>a.toLowerCase()===address.toLowerCase()))accounts.push(address);
  }
 }
 return accounts;
}
function eventAccounts(payload,chainId){
 if(!Array.isArray(payload))return [];
 return accountsFor({namespaces:{eip155:{accounts:payload.map(a=>typeof a==='string'&&ADDRESS.test(a)?'eip155:'+chainId+':'+a:a)}}},chainId);
}
export function createWalletConnectAdapter(client,options,{showPairing,timeoutMs=300000,now=()=>Date.now()}={}){
 const target=options?.chains?.[0];
 if(![56,97].includes(target)||options.chains.length!==1||typeof client?.request!=='function'||typeof client?.connect!=='function'||typeof showPairing!=='function')throw Error('Invalid WalletConnect bridge configuration.');
 const caip='eip155:'+target,hex='0x'+target.toString(16),listeners=new Map(),cancelledPairings=new Set();
 let chainId=target,accounts=accountsFor(client.session,target),pending=null,underlying=null,cancelPending=null,disconnected=false,revoked=false;
 const emit=(name,value)=>{for(const listener of [...(listeners.get(name)||[])])listener(value);};
 const validSession=()=>!revoked&&!!client.session&&!cancelledPairings.has(client.session.pairingTopic)&&Number.isFinite(client.session.expiry)&&client.session.expiry*1000>now()&&accountsFor(client.session,target).length>0&&REQUIRED_METHODS.every(method=>Object.entries(client.session.namespaces||{}).some(([key,ns])=>(key==='eip155'||key===caip)&&(ns.methods||[]).includes(method)));
 const reset=reason=>{accounts=[];chainId=target;revoked=true;if(!disconnected){disconnected=true;emit('accountsChanged',[]);emit('disconnect',reason||failure('WalletConnect session disconnected.',4900));}};
 client.on('accountsChanged',payload=>{const approved=accountsFor(client.session,chainId);accounts=eventAccounts(payload,chainId).filter(a=>approved.some(b=>a.toLowerCase()===b.toLowerCase()));revoked=!Array.isArray(payload)||payload.length===0||(chainId===target&&accounts.length===0);emit('accountsChanged',[...accounts]);});
 client.on('chainChanged',value=>{const next=chainNumber(value);if(next===null){reset(failure('Wallet returned an invalid network.',4901));return;}chainId=next;accounts=accountsFor(client.session,chainId);emit('chainChanged','0x'+next.toString(16));});
 client.on('session_update',()=>{accounts=accountsFor(client.session,chainId);revoked=accountsFor(client.session,target).length===0;emit('accountsChanged',[...accounts]);});
 // UniversalProvider 2.26 filters empty account arrays. Preserve an explicit
 // account revocation from the authenticated SignClient session event.
 client.client?.on?.('session_event',event=>{if(event?.topic===client.session?.topic&&event.params?.event?.name==='accountsChanged'&&Array.isArray(event.params.event.data)&&event.params.event.data.length===0){accounts=[];revoked=true;emit('accountsChanged',[]);}});
 client.on('disconnect',reset);
 const approvedMethod=method=>Object.entries(client.session?.namespaces||{}).some(([key,ns])=>(key==='eip155'||key===caip)&&(ns.methods||[]).includes(method));
 const activeAccount=value=>{if(typeof value!=='string'||!ADDRESS.test(value)||!accounts.some(a=>a.toLowerCase()===value.toLowerCase())||!accountsFor(client.session,target).some(a=>a.toLowerCase()===value.toLowerCase()))throw failure('The requested account is not active in this wallet session.',4100);};
 const payloadChain=(value,required=false)=>{if((required||value!==undefined)&&chainNumber(value)!==target)throw failure('The request payload network does not match this deployment.',4901);};
 const validateWalletRequest=args=>{
  if(!WALLET_METHODS.has(args.method))throw failure('This wallet method is not supported by this workspace.',4200);
  if(!approvedMethod(args.method))throw failure('The wallet session did not approve this method.',4100);
  if(['eth_sendTransaction','eth_signTransaction'].includes(args.method)){
   const tx=Array.isArray(args.params)&&args.params.length===1&&args.params[0];if(!tx||typeof tx!=='object'||Array.isArray(tx))throw failure('Invalid wallet transaction.',-32602);
   activeAccount(tx.from);payloadChain(tx.chainId);
  }else if(args.method==='wallet_sendCalls'){
   const batch=Array.isArray(args.params)&&args.params.length===1&&args.params[0];if(!batch||typeof batch!=='object'||Array.isArray(batch))throw failure('Invalid wallet batch.',-32602);
   activeAccount(batch.from);payloadChain(batch.chainId,true);
  }else if(args.method==='personal_sign'||args.method==='eth_sign'){
   if(!Array.isArray(args.params)||args.params.length!==2)throw failure('Invalid signing parameters.',-32602);
   const address=args.method==='eth_sign'?args.params[0]:ADDRESS.test(args.params[1])?args.params[1]:args.params[0];activeAccount(address);
  }else if(args.method.startsWith('eth_signTypedData')){
   if(!Array.isArray(args.params)||args.params.length!==2)throw failure('Invalid typed-data parameters.',-32602);
   const addressFirst=typeof args.params[0]==='string'&&ADDRESS.test(args.params[0]);activeAccount(args.params[addressFirst?0:1]);let data=args.params[addressFirst?1:0];
   if(typeof data==='string'){if(data.length>262144)throw failure('Typed-data request is too large.',-32602);try{data=JSON.parse(data);}catch{throw failure('Invalid typed-data JSON.',-32602);}}
   if(!data||typeof data!=='object'||Array.isArray(data)||!data.domain||typeof data.domain!=='object'||Array.isArray(data.domain))throw failure('Invalid typed-data domain.',-32602);
   payloadChain(data.domain.chainId);
  }else if(args.method==='wallet_getCapabilities')activeAccount(args.params?.[0]);
  else if(args.method==='wallet_watchAsset'){
   // This workspace imports only its ERC20 FTI asset. Do not forward arbitrary
   // URLs, extra metadata, other token standards or price claims to the wallet.
   const params=args.params,asset=params?.options;
   if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(key=>!['type','options'].includes(key))||params.type!=='ERC20'||!asset||typeof asset!=='object'||Array.isArray(asset)||Object.keys(asset).some(key=>!['address','symbol','decimals'].includes(key))||!ADDRESS.test(asset.address||'')||/^0x0{40}$/i.test(asset.address)||asset.symbol!=='FTI'||asset.decimals!==18)throw failure('Invalid FTI token metadata.',-32602);
   activeAccount(accounts[0]);
  }
 };
 const adapter={
  get isWalletConnect(){return true;},
  get session(){return validSession()?client.session:undefined;},
  get connected(){return validSession()&&chainId===target;},
  get connecting(){return !!pending||!!underlying;},
  get accounts(){return validSession()?[...accounts]:[];},
  get chainId(){return chainId;},
  on(name,listener){if(typeof listener!=='function')throw TypeError('Wallet listener must be a function.');if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(listener);return adapter;},
  once(name,listener){const once=value=>{adapter.removeListener(name,once);listener(value);};return adapter.on(name,once);},
  removeListener(name,listener){listeners.get(name)?.delete(listener);return adapter;},
  off(name,listener){return adapter.removeListener(name,listener);},
  async connect(){await adapter.enable();},
  async enable(){
   if(pending)return pending;
   if(underlying)throw failure('The previous wallet connection is closing. Please retry shortly.',4001);
   if(validSession()){
    client.setDefaultChain(caip,options.rpcMap[target]);chainId=target;accounts=accountsFor(client.session,target);disconnected=false;return [...accounts];
   }
   let close=()=>{},timer,cancelled=false,rejectCancellation,pairingTopic;
   const cancellation=new Promise((_,reject)=>{rejectCancellation=reject;});
   const expirePairing=()=>{
    if(!pairingTopic)return;
    cancelledPairings.add(pairingTopic);
    // Expiring this exact proposal settles SignClient's approval promise. Do
    // not let another Universal connect mutate its shared session meanwhile.
    try{for(const proposal of client.client?.proposal?.getAll?.()||[])if(proposal.pairingTopic===pairingTopic)client.client.core.expirer.set(proposal.id,0);}catch{}
    try{Promise.resolve(client.client?.core?.pairing?.disconnect({topic:pairingTopic})).catch(()=>{});}catch{}
   };
   const cancel=error=>{
    if(cancelled)return;cancelled=true;
    // UniversalProvider.abortPairingAttempt() is a no-op in 2.26. Use the
    // supported Core pairing disconnect API for this one proposal instead.
    expirePairing();
    rejectCancellation(error||failure('Wallet connection cancelled.',4001));
   };
   cancelPending=cancel;
   const display=uri=>{try{const topic=typeof uri==='string'&&/^wc:([0-9a-f]{64})@2\?/i.exec(uri)?.[1];if(!topic)throw Error('Invalid pairing.');pairingTopic=topic;if(cancelled){expirePairing();return;}close();close=showPairing({uri,chainId:target,onCancel:()=>cancel()})||(()=>{});}catch{cancel(failure('Wallet QR code could not be displayed.',-32603));}};
   client.on('display_uri',display);
   timer=setTimeout(()=>cancel(failure('Wallet connection expired. Please try again.',4001)),timeoutMs);timer.unref?.();
   const operation=(async()=>{
    // A stored session on another chain must not authorize this deployment.
    if(client.session)await client.disconnect();
    if(cancelled)throw failure('Wallet connection cancelled.',4001);
    const connected=await client.connect({
     namespaces:{eip155:{chains:[caip],methods:REQUIRED_METHODS,events:['accountsChanged','chainChanged'],rpcMap:{[target]:options.rpcMap[target]}}},
     optionalNamespaces:{eip155:{chains:[caip],methods:OPTIONAL_METHODS,events:['accountsChanged','chainChanged'],rpcMap:{[target]:options.rpcMap[target]}}}
    });
    if(cancelled){
     if(connected?.topic&&client.session?.topic===connected.topic)await client.disconnect();
     else if(connected?.topic)await client.client?.disconnect({topic:connected.topic,reason:{code:6000,message:'User disconnected.'}});
     throw failure('Wallet connection cancelled.',4001);
    }
    accounts=accountsFor(client.session,target);revoked=false;
    if(!connected||!validSession()){
     if(client.session)await client.disconnect();throw failure('Wallet did not authorize this BNB network.',4901);
    }
    client.setDefaultChain(caip,options.rpcMap[target]);chainId=target;accounts=accountsFor(client.session,target);disconnected=false;
    emit('connect',{chainId:hex});emit('accountsChanged',[...accounts]);return [...accounts];
   })();
   underlying=operation;const settle=()=>{client.removeListener('display_uri',display);if(underlying===operation)underlying=null;};operation.then(settle,settle);
   pending=Promise.race([operation,cancellation]).finally(()=>{clearTimeout(timer);close();pending=null;cancelPending=null;});
   return pending;
  },
  async request(args){
   if(!args||typeof args.method!=='string')throw failure('Invalid wallet request.',-32600);
   if(args.method==='eth_requestAccounts')return adapter.enable();
   if(args.method==='eth_accounts')return validSession()&&chainId===target?[...accounts]:[];
   if(args.method==='eth_chainId')return '0x'+chainId.toString(16);
   if(!validSession())throw failure('Connect your wallet first.',4900);
   if(args.method==='wallet_switchEthereumChain'||args.method==='wallet_addEthereumChain'){
    validateWalletRequest(args);
    if(chainNumber(args.params?.[0]?.chainId)!==target)throw failure('This workspace supports only its configured BNB network.',4901);
    const result=await client.request(args,caip);
    if(args.method==='wallet_switchEthereumChain'){client.setDefaultChain(caip,options.rpcMap[target]);chainId=target;accounts=accountsFor(client.session,target);emit('chainChanged',hex);}
    return result;
   }
   if(chainId!==target)throw failure('Wallet network does not match this deployment.',4901);
   if(!READ_METHODS.has(args.method))validateWalletRequest(args);
   return client.request(args,caip);
  },
  async disconnect(){cancelPending?.();try{if(client.session)await client.disconnect();}finally{reset();}}
 };
 return adapter;
}
