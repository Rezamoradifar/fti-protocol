#!/usr/bin/env bash
set -Eeuo pipefail
umask 027
[ "$(id -u)" = 0 ] || { echo 'Run as root on the existing FTI server.'; exit 1; }
FTI_UI_REV=1eb727da1b4200afc7056f5e35af57dc95718e02
FTI_WEB_ENV=/etc/fti-v3/web.env
test -s "$FTI_WEB_ENV"
id fti-v3 >/dev/null
systemctl cat fti-v3-web.service >/dev/null
case "$(uname -m)" in x86_64) FTI_ARCH=x64;; aarch64) FTI_ARCH=arm64;; *) exit 1;; esac
FTI_NODE_DIR="/opt/fti/runtime/node-v22.23.3-$FTI_ARCH/bin"
test -x "$FTI_NODE_DIR/node"
export PATH="$FTI_NODE_DIR:$PATH"
FTI_STAMP=$(date -u +%Y%m%dT%H%M%SZ)-$$
FTI_UI_DIR="/opt/fti/releases/ui-$FTI_UI_REV-$FTI_STAMP"
FTI_UI_STATE="/var/lib/fti-v3/ui-$FTI_UI_REV-$FTI_STAMP"
FTI_BACKUP="/var/lib/fti-v3/frontend-backups/$FTI_STAMP"
FTI_DROPIN=/etc/systemd/system/fti-v3-web.service.d/90-frontend.conf
FTI_SWITCHED=0
mkdir -p "$FTI_UI_DIR" "$FTI_BACKUP"
install -d -o root -g fti-v3 -m 0750 "$FTI_UI_STATE"
if test -f "$FTI_DROPIN"; then cp -p "$FTI_DROPIN" "$FTI_BACKUP/90-frontend.conf"; fi
rollback() {
  local result=$?
  if [ "$result" -ne 0 ] && [ "$FTI_SWITCHED" = 1 ]; then
    echo 'Update failed; restoring the previous web service.'
    if test -f "$FTI_BACKUP/90-frontend.conf"; then cp -p "$FTI_BACKUP/90-frontend.conf" "$FTI_DROPIN"; else rm -f "$FTI_DROPIN"; fi
    systemctl daemon-reload
    systemctl restart fti-v3-web.service || true
  fi
  exit "$result"
}
trap rollback EXIT
curl -fSL --retry 3 --connect-timeout 15 \
  "https://codeload.github.com/Rezamoradifar/fti-protocol/tar.gz/$FTI_UI_REV" \
  -o "$FTI_BACKUP/source.tar.gz"
tar -xzf "$FTI_BACKUP/source.tar.gz" --strip-components=1 -C "$FTI_UI_DIR"
cd "$FTI_UI_DIR"
npm ci --no-fund
npm run compile
npm run build:web
(cd landing && FTI_APP_URL=/app/ node build.mjs)
export FTI_UI_DIR FTI_UI_STATE FTI_UI_REV FTI_WEB_ENV
node --input-type=module <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JsonRpcProvider,FetchRequest} from 'ethers';
const env={};
for(const line of fs.readFileSync(process.env.FTI_WEB_ENV,'utf8').split(/\r?\n/)){
 const i=line.indexOf('=');if(i<1||line.startsWith('#'))continue;
 const raw=line.slice(i+1).trim();env[line.slice(0,i)]=raw.startsWith('"')?JSON.parse(raw):raw;
}
const oldFile=env.DEPLOYMENT_FILE;
if(!oldFile||!path.isAbsolute(oldFile))throw Error('Expected an absolute existing deployment path');
const cfg=JSON.parse(fs.readFileSync(oldFile));
if(cfg.chainId!==97||cfg.tokenContract!=='FTIReserveTokenV3'||cfg.binaryContract!=='FundedBinaryPlan')throw Error('Expected the installed V3 BNB testnet deployment');
const unit=fs.readFileSync('/etc/systemd/system/fti-v3-web.service','utf8');
const drops='/etc/systemd/system/fti-v3-web.service.d';
let settings=unit;
if(fs.existsSync(drops))for(const file of fs.readdirSync(drops).filter(x=>x.endsWith('.conf')).sort())settings+='\n'+fs.readFileSync(path.join(drops,file),'utf8');
const dirs=[...settings.matchAll(/^WorkingDirectory=(.+)$/gm)];
const oldDir=dirs.at(-1)?.[1].trim();
if(!oldDir||!path.isAbsolute(oldDir))throw Error('Cannot resolve the installed web working directory');
const request=new FetchRequest(env.RPC_URL||cfg.rpcUrl);request.timeout=15000;
const provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});
try{
 process.chdir(oldDir);process.env.FTI_SOURCE_REVISION=cfg.sourceRevision;
 const old=await import(pathToFileURL(path.join(oldDir,'scripts/v3-release.mjs')));
 await old.verifyV3Deployment(cfg,provider);
 const digest=old.contractDigest();
 for(const file of ['package.json','package-lock.json'])if(!fs.readFileSync(file).equals(fs.readFileSync(path.join(process.env.FTI_UI_DIR,file))))throw Error('Dependency change requires separate review: '+file);
 process.chdir(process.env.FTI_UI_DIR);process.env.FTI_SOURCE_REVISION=process.env.FTI_UI_REV;
 const next=await import(pathToFileURL(path.join(process.env.FTI_UI_DIR,'scripts/v3-release.mjs')));
 const manifest=next.releaseManifest();
 if(next.contractDigest()!==digest||JSON.stringify(manifest.artifactHashes)!==JSON.stringify(cfg.artifactHashes))throw Error('Contract source/artifacts differ; frontend update refused');
 const nextCfg={...cfg,...manifest,contractSourceRevision:cfg.contractSourceRevision||cfg.sourceRevision,frontendUpdate:{previousSourceRevision:cfg.sourceRevision,previousSourceFingerprint:cfg.sourceFingerprint,previousDeploymentFile:oldFile,at:new Date().toISOString()}};
 await next.verifyV3Deployment(nextCfg,provider);
 const destination=path.join(process.env.FTI_UI_STATE,'deployment.json');
 fs.writeFileSync(destination,JSON.stringify(nextCfg,null,2),{mode:0o640});
 fs.writeFileSync(path.join(process.env.FTI_UI_STATE,'web-ui.env'),'DEPLOYMENT_FILE='+JSON.stringify(destination)+'\nFTI_SOURCE_REVISION='+JSON.stringify(process.env.FTI_UI_REV)+'\n',{mode:0o640});
 console.log('Verified: chain 97, unchanged contract artifacts, five live code hashes and contract bindings.');
}finally{provider.destroy();}
JS
chown -R root:fti-v3 "$FTI_UI_STATE"
chown -R root:fti-v3 "$FTI_UI_DIR"
chmod 0640 "$FTI_UI_STATE/deployment.json" "$FTI_UI_STATE/web-ui.env"
mkdir -p "$(dirname "$FTI_DROPIN")"
cat > "$FTI_BACKUP/new-frontend.conf" <<UNIT
[Service]
WorkingDirectory=$FTI_UI_DIR
EnvironmentFile=$FTI_UI_STATE/web-ui.env
ExecStart=
ExecStart=$FTI_NODE_DIR/node $FTI_UI_DIR/scripts/server.mjs
UNIT
FTI_SWITCHED=1
install -m 0644 "$FTI_BACKUP/new-frontend.conf" "$FTI_DROPIN"
systemctl daemon-reload
systemctl restart fti-v3-web.service
FTI_OK=0
for FTI_TRY in {1..30}; do
 if curl --max-time 3 -fsS http://127.0.0.1:3108/health > "$FTI_UI_STATE/health.json"; then FTI_OK=1; break; fi
 sleep 2
done
[ "$FTI_OK" = 1 ]
curl --max-time 20 -fsS http://127.0.0.1:3108/api/config -o "$FTI_UI_STATE/public-config.json"
node --input-type=module <<'JS'
import fs from 'node:fs';
const dir=process.env.FTI_UI_STATE,cfg=JSON.parse(fs.readFileSync(dir+'/deployment.json')),actual=JSON.parse(fs.readFileSync(dir+'/public-config.json')),health=JSON.parse(fs.readFileSync(dir+'/health.json'));
if(!health.ok||health.chainId!==97)throw Error('Web health/network mismatch');
for(const key of ['token','binary','usd','council','timelock','sourceRevision','sourceFingerprint'])if(actual[key]!==cfg[key])throw Error('Wrong served deployment: '+key);
for(const route of ['/','/app/','/token/','/admin/','/app.js','/app.css','/app/app.js','/token/app.js','/admin/app.js']){
 const r=await fetch('http://127.0.0.1:3108'+route,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Route failed: '+route);
 const body=Buffer.from(await r.arrayBuffer());
 const expected=route==='/'?'landing/dist/index.html':['/app/','/token/','/admin/'].includes(route)?'web/index.html':route==='/app.js'?'landing/dist/app.js':route==='/app.css'?'landing/dist/app.css':'web/app.js';
 if(!body.equals(fs.readFileSync(expected)))throw Error('Wrong frontend asset: '+route);
}
console.log('Frontend and deployment routes verified.');
JS
cat > "$FTI_BACKUP/rollback.sh" <<ROLLBACK
#!/usr/bin/env bash
set -euo pipefail
if test -f '$FTI_BACKUP/90-frontend.conf'; then
 cp -p '$FTI_BACKUP/90-frontend.conf' '$FTI_DROPIN'
else
 rm -f '$FTI_DROPIN'
fi
systemctl daemon-reload
systemctl restart fti-v3-web.service
ROLLBACK
chmod 0700 "$FTI_BACKUP/rollback.sh"
echo 'FTI frontend installed. Contracts and keeper were not redeployed.'
echo 'Local site: http://127.0.0.1:3108/ | /app/ | /token/ | /admin/'
echo "Rollback: bash $FTI_BACKUP/rollback.sh"
