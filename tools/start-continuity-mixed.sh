#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
FTI_RUNNER_REV="${1:?Pass the reviewed runner revision}"
[[ "$FTI_RUNNER_REV" =~ ^[a-f0-9]{40}$ ]]
test "$(id -u)" = 0
if systemctl is-active --quiet fti-continuity-mixed.service; then
 echo 'Already running: tail -f /root/fti-mixed.log'; exit 0
fi
for unit in fti-continuity-load-100 fti-continuity-load-1000 fti-continuity-sell-transfer fti-v3-load-1000; do
 if systemctl is-active --quiet "$unit.service"; then
  systemctl stop "$unit.service"
  if systemctl is-active --quiet "$unit.service"; then echo "Could not stop $unit"; exit 1; fi
 fi
done
FTI_RELEASE=$(systemctl show fti-continuity-web.service -p WorkingDirectory --value)
test -s "$FTI_RELEASE/artifacts/FTIReserveTokenUpgradeable.json"
systemctl is-active --quiet fti-continuity-keeper.service
case "$(uname -m)" in x86_64) FTI_ARCH=x64;; aarch64) FTI_ARCH=arm64;; *) exit 1;; esac
FTI_NODE="/opt/fti/runtime/node-v22.23.3-$FTI_ARCH/bin/node"
FTI_STATE="/var/lib/fti-continuity/a09b3f23a6ea3e7e82a6117e9a000aa82f0091ed"
FTI_MODULE="$FTI_RELEASE/tools/fti-continuity-mixed.mjs"
curl -fsSL --retry 3 "https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/$FTI_RUNNER_REV/tools/testnet-continuity-mixed.mjs" -o "$FTI_MODULE"
echo "becde21670115358cdcd1f4709b8e7be31baea9fc5a257ec7a3f8389d4852b49  $FTI_MODULE" | sha256sum -c -
export V3_SERVER_CONFIG="$FTI_STATE/web.env" V3_DEPLOYMENT_FILE="$FTI_STATE/deployment.json" V3_ARTIFACT_DIR="$FTI_RELEASE/artifacts"
"$FTI_NODE" "$FTI_MODULE"
FTI_KEY_FILE=/root/.fti-continuity-1000-funder.key
if ! test -s "$FTI_KEY_FILE"; then
 FTI_OLD_STATUS=$(systemctl show fti-v3-load-1000.service -p ActiveState --value 2>/dev/null || true)
 if [[ "$FTI_OLD_STATUS" = inactive || "$FTI_OLD_STATUS" = failed ]] && test -s /root/.fti-v3-1000-funder.key; then
  install -m 0600 /root/.fti-v3-1000-funder.key "$FTI_KEY_FILE"
 else
  (cd "$FTI_RELEASE" && FTI_KEY_FILE="$FTI_KEY_FILE" "$FTI_NODE" --input-type=module <<'JS'
import fs from 'node:fs';import {Wallet} from 'ethers';
fs.writeFileSync(process.env.FTI_KEY_FILE,Wallet.createRandom().privateKey,{mode:0o600,flag:'wx'});
JS
  )
 fi
fi
chmod 0600 "$FTI_KEY_FILE"
if test -s /root/.fti-v3-1000-funder.key && systemctl is-active --quiet fti-v3-load-1000.service && cmp -s "$FTI_KEY_FILE" /root/.fti-v3-1000-funder.key; then
 echo 'Old test is using the same gas wallet. Stop here to prevent nonce conflicts.'; exit 1
fi
(cd "$FTI_RELEASE" && TEST_FUNDER_KEY_FILE="$FTI_KEY_FILE" TEST_KEEPER_CONFIG="$FTI_STATE/keeper.env" "$FTI_NODE" --input-type=module <<'JS'
import fs from 'node:fs';import {Wallet,JsonRpcProvider,formatEther,parseEther} from 'ethers';
const parse=p=>Object.fromEntries(fs.readFileSync(p,'utf8').split(/\r?\n/).filter(x=>/^(RPC_URL|KEEPER_PRIVATE_KEY)=/.test(x)).map(x=>{const at=x.indexOf('=');return [x.slice(0,at),JSON.parse(x.slice(at+1))];}));
const env=parse(process.env.V3_SERVER_CONFIG),keeper=parse(process.env.TEST_KEEPER_CONFIG);
const w=new Wallet(fs.readFileSync(process.env.TEST_FUNDER_KEY_FILE,'utf8').trim()),p=new JsonRpcProvider(env.RPC_URL,undefined,{batchMaxCount:1});
try{
 if((await p.getNetwork()).chainId!==97n)throw Error('Expected TESTNET 97');
 if(w.address===new Wallet(keeper.KEEPER_PRIVATE_KEY).address)throw Error('Dedicated test wallet required');
 const b=await p.getBalance(w.address);console.log('TEST GAS WALLET:',w.address,'balance:',formatEther(b),'tBNB');
 console.log('Gas required depends on fees and balances; test stops safely if insufficient. Same wallet and journal are reused on resume.');
 if(b<parseEther('0.002')){console.log('NEEDS_TEST_GAS: fund this address on BNB TESTNET, then rerun the same command.');process.exitCode=2;}
}finally{p.destroy();}
JS
)
systemd-run --unit=fti-continuity-mixed --collect \
 --property="WorkingDirectory=$FTI_RELEASE" \
 --property=TimeoutStopSec=240s \
 --property=StandardOutput=append:/root/fti-mixed.log \
 --property=StandardError=append:/root/fti-mixed.log \
 --setenv="V3_SERVER_CONFIG=$V3_SERVER_CONFIG" \
 --setenv="V3_DEPLOYMENT_FILE=$V3_DEPLOYMENT_FILE" \
 --setenv="V3_ARTIFACT_DIR=$V3_ARTIFACT_DIR" \
 --setenv="TEST_FUNDER_KEY_FILE=$FTI_KEY_FILE" \
 --setenv="TEST_KEEPER_CONFIG=$FTI_STATE/keeper.env" \
 --setenv=TEST_BUDGET_TBNB=1 --setenv=TEST_WAIT_HOURLY=1 \
 --setenv=TEST_STATE_DIR=/root/.fti-continuity-mixed-100k \
 "$FTI_NODE" "$FTI_MODULE" --write
echo 'STARTED: independent of SSH. Follow: tail -f /root/fti-mixed.log'
echo 'Private keys and reports: /root/.fti-continuity-mixed-100k/ (do not share key journals).'
