#!/usr/bin/env bash
# Deploy the tested FTI V3 release to BNB testnet and start its services.
set +x
set -euo pipefail
umask 077
FTI_SHA=9dac27d3893571be5812a61aa92aa6fac20e4bf5
FTI_DIR=/opt/fti/releases/$FTI_SHA
FTI_STATE=/var/lib/fti-v3/$FTI_SHA
FTI_CONFIG=/etc/fti-v3
FTI_DEPLOYMENT=$FTI_STATE/deployment.json
FTI_PORT=3108
fail(){ printf '%s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || fail 'Run this script as root.'
[[ -d "$FTI_DIR/.git" ]] || fail 'The previous FTI installation has not completed. Run the installation command first.'
case "$(uname -m)" in
 x86_64) FTI_ARCH=x64 ;;
 aarch64) FTI_ARCH=arm64 ;;
 *) fail 'Unsupported server architecture.' ;;
esac
FTI_NODE_DIR=/opt/fti/runtime/node-v22.23.3-$FTI_ARCH
[[ -x "$FTI_NODE_DIR/bin/node" ]] || fail 'The isolated Node 22 installation is missing.'
export PATH="$FTI_NODE_DIR/bin:$PATH"
cd "$FTI_DIR"
[[ "$(git rev-parse HEAD)" == "$FTI_SHA" ]] || fail 'Wrong checkout revision.'
git diff --quiet || fail 'Tracked source has local changes. Preserve and review them before deployment.'
git diff --cached --quiet || fail 'Staged source changes exist.'
command -v systemctl >/dev/null || fail 'systemd is required.'
command -v curl >/dev/null || fail 'curl is required.'
[[ -d /run/systemd/system ]] || fail 'This server is not running systemd.'
[[ -d "$FTI_STATE" ]] || install -d -m 700 "$FTI_STATE"
install -d -m 700 "$FTI_CONFIG"
export FTI_STATE FTI_CONFIG FTI_DEPLOYMENT FTI_SHA
export FTI_SOURCE_REVISION="$FTI_SHA"
export DEPLOYMENT_FILE="$FTI_DEPLOYMENT"
export V3_DEPLOYMENT_FILE="$FTI_DEPLOYMENT"
export V3_TESTNET_SECRETS="$FTI_STATE/genesis-secrets.json"
export DAO_CONFIG="$FTI_STATE/dao.json"

if [[ -e "$FTI_STATE/deployment-started" && ! -f "$FTI_DEPLOYMENT" ]]; then
 fail "A previous deployment attempt is incomplete. Do not redeploy blindly. Its private log is $FTI_STATE/deploy-private.log"
fi

read -r -s -p 'BNB TESTNET RPC URL (hidden): ' RPC_URL </dev/tty
printf '\n'
read -r -s -p 'KEEPER private key, gas-only TESTNET wallet (hidden): ' KEEPER_PRIVATE_KEY </dev/tty
printf '\n'
export RPC_URL KEEPER_PRIVATE_KEY
if [[ ! -f "$FTI_DEPLOYMENT" ]]; then
 read -r -s -p 'DEPLOYER private key for TESTNET (hidden): ' DEPLOYER_PRIVATE_KEY </dev/tty
 printf '\n'
 read -r -p 'Seven council wallet ADDRESSES separated by commas: ' FTI_PARTNERS </dev/tty
 export DEPLOYER_PRIVATE_KEY FTI_PARTNERS
fi

# No private keys or RPC URL are printed by preflight.
node --input-type=module <<'JS'
import fs from 'node:fs';
import {JsonRpcProvider,Wallet,isAddress,ZeroAddress} from 'ethers';
let p;
try {
 const url=new URL(process.env.RPC_URL);
 if(!['https:','http:'].includes(url.protocol))throw Error('RPC must be an HTTP(S) URL.');
 p=new JsonRpcProvider(process.env.RPC_URL);
 const n=await p.getNetwork();
 if(n.chainId!==97n)throw Error('This launcher accepts BNB TESTNET chain 97 only.');
 const keeper=new Wallet(process.env.KEEPER_PRIVATE_KEY,p);
 if(await p.getBalance(keeper.address)===0n)throw Error('Keeper wallet needs test BNB for gas.');
 console.log('Keeper address:',keeper.address);
 if(!fs.existsSync(process.env.FTI_DEPLOYMENT)){
  const deployer=new Wallet(process.env.DEPLOYER_PRIVATE_KEY,p);
  if(await p.getBalance(deployer.address)===0n)throw Error('Deployer wallet needs test BNB for gas.');
  const partners=(process.env.FTI_PARTNERS||'').split(',').map(x=>x.trim());
  if(partners.length!==7||partners.some(a=>!isAddress(a)||a.toLowerCase()===ZeroAddress)||new Set(partners.map(a=>a.toLowerCase())).size!==7)throw Error('Enter seven distinct nonzero council addresses.');
  fs.writeFileSync(process.env.DAO_CONFIG,JSON.stringify({threshold:5,partners},null,2),{mode:0o600});
  console.log('Deployer/development/genesis-root address:',deployer.address);
  console.log('Council addresses:',partners.join(', '));
 }
 console.log('Network preflight passed: chain 97.');
} catch(e) {
 console.error('Preflight failed:',e.code||'CONFIGURATION',e.code?'Check the RPC, wallet keys and test BNB balances.':e.message);
 process.exitCode=1;
} finally {p?.destroy();}
JS

# Rebuild the same pinned source so ABI and web bundle match deployment metadata.
npm run build:web
npm run compile
if [[ ! -f "$FTI_DEPLOYMENT" ]]; then
 date -u +%FT%TZ > "$FTI_STATE/deployment-started"
 if ! node scripts/deploy-v3-testnet.mjs > "$FTI_STATE/deploy-private.log" 2>&1; then
  unset DEPLOYER_PRIVATE_KEY
  fail "Deployment stopped. Keep $FTI_STATE/deploy-private.log private; transactions may already exist."
 fi
fi
unset DEPLOYER_PRIVATE_KEY FTI_PARTNERS

# Validate existing or newly created deployment before touching running services.
node --input-type=module <<'JS'
import fs from 'node:fs';
import {JsonRpcProvider} from 'ethers';
import {verifyV3Deployment} from './scripts/v3-release.mjs';
const p=new JsonRpcProvider(process.env.RPC_URL);
try{
 const d=JSON.parse(fs.readFileSync(process.env.FTI_DEPLOYMENT));
 if(d.chainId!==97||d.sourceRevision!==process.env.FTI_SHA)throw Error('Wrong deployment network or revision.');
 await verifyV3Deployment(d,p);
 console.log('Verified token:',d.token);
 console.log('Verified binary:',d.binary);
}catch{console.error('Deployment verification failed. Services were not changed.');process.exitCode=1;}
finally{p.destroy();}
JS

getent group fti-v3 >/dev/null || groupadd --system fti-v3
id -u fti-v3 >/dev/null 2>&1 || useradd --system --gid fti-v3 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin fti-v3
chgrp -R fti-v3 "$FTI_DIR" "$FTI_NODE_DIR"
chmod -R g+rX "$FTI_DIR" "$FTI_NODE_DIR"
chmod 755 /opt/fti /opt/fti/releases /opt/fti/runtime
chgrp fti-v3 /var/lib/fti-v3 "$FTI_STATE" "$FTI_DEPLOYMENT"
chmod 750 /var/lib/fti-v3 "$FTI_STATE"
chmod 640 "$FTI_DEPLOYMENT"

node --input-type=module <<'JS'
import fs from 'node:fs';
const quote=v=>'"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r')+'"';
const common={RPC_URL:process.env.RPC_URL,DEPLOYMENT_FILE:process.env.FTI_DEPLOYMENT,FTI_SOURCE_REVISION:process.env.FTI_SHA};
for(const [name,env] of Object.entries({web:{...common,HOST:'127.0.0.1',PORT:'3108'},keeper:{...common,KEEPER_PRIVATE_KEY:process.env.KEEPER_PRIVATE_KEY}})){
 const file=process.env.FTI_CONFIG+'/'+name+'.env';
 fs.writeFileSync(file,Object.entries(env).map(([k,v])=>k+'='+quote(v)).join('\n')+'\n',{mode:0o600});fs.chmodSync(file,0o600);
}
JS
unset KEEPER_PRIVATE_KEY RPC_URL

for FTI_SERVICE in web keeper; do
 FTI_ENTRY=server
 [[ "$FTI_SERVICE" != keeper ]] || FTI_ENTRY=keeper
 cat > "/etc/systemd/system/fti-v3-$FTI_SERVICE.service" <<UNIT
[Unit]
Description=FTI V3 testnet $FTI_SERVICE
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=fti-v3
Group=fti-v3
WorkingDirectory=$FTI_DIR
EnvironmentFile=$FTI_CONFIG/$FTI_SERVICE.env
ExecStart=$FTI_NODE_DIR/bin/node $FTI_DIR/scripts/$FTI_ENTRY.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict

[Install]
WantedBy=multi-user.target
UNIT
done
systemctl daemon-reload
systemctl enable fti-v3-web fti-v3-keeper
systemctl restart fti-v3-web fti-v3-keeper
FTI_HEALTHY=0
for FTI_TRY in {1..30}; do
 if curl --max-time 3 -fsS "http://127.0.0.1:$FTI_PORT/health" > "$FTI_STATE/health.json"; then
  FTI_HEALTHY=1
  break
 fi
 sleep 2
done
[[ "$FTI_HEALTHY" == 1 ]] || fail 'Web health check failed. Inspect: systemctl status fti-v3-web --no-pager'
systemctl is-active --quiet fti-v3-web || fail 'Web service is not active. Check for a port conflict.'
systemctl is-active --quiet fti-v3-keeper || fail 'Keeper is not active. Inspect its service status.'
node --input-type=module <<'JS'
import fs from 'node:fs';
const expected=JSON.parse(fs.readFileSync(process.env.FTI_DEPLOYMENT));
const response=await fetch('http://127.0.0.1:3108/api/config',{signal:AbortSignal.timeout(10000)});
if(!response.ok)throw Error('Web configuration request failed.');
const actual=await response.json();
for(const key of ['chainId','sourceRevision','sourceFingerprint','token','binary','council','timelock']){
 if(actual[key]!==expected[key])throw Error('The web service is serving a different deployment: '+key);
}
console.log('Web deployment configuration verified.');
JS
printf '\nFTI testnet deployed and services started.\nLocal panel: http://127.0.0.1:%s/app/\n' "$FTI_PORT"
printf 'Token panel: /token/ | Governance: /admin/\nDeployment record: %s\n' "$FTI_DEPLOYMENT"
