import {MAINNET_RELEASE,deploymentNetwork} from '../core/deployment-network.mjs';
import {RELEASE,verifyV3Deployment} from './v3-release.mjs';
import {RELEASE as CONTINUITY_RELEASE,verifyV3Deployment as verifyContinuity} from './continuity-release.mjs';
export function assertOperationalConfig(cfg){
 if(cfg.chainId===56||cfg.release===MAINNET_RELEASE){
  deploymentNetwork(cfg);
  return;
 }
 if(cfg.tokenContract==='FTIReserveTokenUpgradeable'&&cfg.release!==CONTINUITY_RELEASE)throw Error('Continuity release mismatch');
 if(cfg.tokenContract==='FTIReserveTokenV3'&&cfg.release!==RELEASE)throw Error('V3 release mismatch');
 if(![97,31337].includes(cfg.chainId))throw Error('Unsupported deployment network');
}
export async function verifyOperationalDeployment(cfg,provider){
 assertOperationalConfig(cfg);
 if(cfg.tokenContract==='FTIReserveTokenUpgradeable')return verifyContinuity(cfg,provider);
 if(cfg.tokenContract==='FTIReserveTokenV3')return verifyV3Deployment(cfg,provider);
 // Preserve the legacy read-only server path; mainnet cannot reach this branch.
 // The legacy Keeper still checks its RPC network before creating a signer.
}
