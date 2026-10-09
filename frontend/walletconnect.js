import EthereumProvider from '@walletconnect/ethereum-provider';
let connection,initializing;
export async function walletConnectProvider(projectId,chainId){
 if(!/^[a-f0-9]{32}$/i.test(projectId)||chainId!==97)throw Error('WalletConnect requires a valid project ID and BNB Testnet.');
 if(connection)return connection;
 if(!initializing)initializing=EthereumProvider.init({
  projectId,chains:[97],showQrModal:true,
  rpcMap:{97:location.origin+'/rpc'},
  optionalMethods:['eth_requestAccounts','wallet_switchEthereumChain','wallet_addEthereumChain'],
  metadata:{name:'FTI Protocol',description:'FTI BNB Testnet membership and token workspace',url:location.origin,icons:[location.origin+'/app/favicon.svg']}
 }).then(provider=>(connection=provider)).catch(error=>{initializing=null;throw error;});
 return initializing;
}
