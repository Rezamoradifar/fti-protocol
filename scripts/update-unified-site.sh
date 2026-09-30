#!/usr/bin/env bash
# Update a server installed by install-new-server.sh. No deployment or signing keys.
set -eEuo pipefail
umask 022
[ "$(id -u)" -eq 0 ] || { echo 'Run as root on the new FTI server.'; exit 1; }
APP=/opt/fti-protocol
CONF=/etc/nginx/conf.d/fti-new-server.conf
cd "$APP"
[ -f deployments/testnet.json ] && [ -f /etc/fti/web.env ] && [ -f "$CONF" ] || { echo 'Existing FTI installation not found. Use the migration installer for a new server.'; exit 1; }
grep -q '127.0.0.1:3081' "$CONF" && grep -Eq 'listen +3090;' "$CONF" || { echo 'Custom Nginx configuration found. Review ops/nginx/fti-unified.conf before applying it.'; exit 1; }
FTI_NODE=$(systemctl show -p ExecStart --value fti-testnet-web.service | sed -n 's/.*path=\([^ ;]*\).*/\1/p')
[ -x "$FTI_NODE" ] || { echo 'Cannot locate the Node runtime used by the FTI service.'; exit 1; }
export PATH="$(dirname "$FTI_NODE"):/usr/sbin:/usr/bin:/sbin:/bin"
node --input-type=module <<'NODE'
import fs from 'node:fs';
const d=JSON.parse(fs.readFileSync('deployments/testnet.json'));
if(d.chainId!==97||d.mode!=='testnet'||d.liquidityVersion)throw Error('Expected the existing BNB testnet deployment.');
for(const name of ['MockUSD','FTIToken','BinaryPlan','Council','FTITimelock']){
 const a=JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
 if(!Array.isArray(a.abi))throw Error('Missing deployed ABI: '+name);
}
if(Number(process.versions.node.split('.')[0])<22)throw Error('Node 22 or later is required.');
console.log('Existing deployment and artifacts found.');
NODE
FTI_BACKUP=$(mktemp -d /var/tmp/fti-site-rollback.XXXXXXXX)
chmod 0700 "$FTI_BACKUP"
cp -a web "$FTI_BACKUP/web"
if [ -d landing/dist ]; then cp -a landing/dist "$FTI_BACKUP/dist"; fi
cp -a "$CONF" "$FTI_BACKUP/nginx.conf"
rollback() {
 trap - ERR
 echo "Update failed. Restoring frontend files and Nginx config from $FTI_BACKUP."
 cp -a "$FTI_BACKUP/web/." web/
 if [ -d "$FTI_BACKUP/dist" ]; then mkdir -p landing/dist; cp -a "$FTI_BACKUP/dist/." landing/dist/; fi
 cp -a "$FTI_BACKUP/nginx.conf" "$CONF"
 systemctl restart fti-testnet-web.service || true
 if nginx -t; then systemctl reload nginx || true; fi
 exit 1
}
trap rollback ERR
runuser -u fti -- env PATH="$PATH" npm ci
runuser -u fti -- env PATH="$PATH" npm run build:web
(cd landing; runuser -u fti -- env PATH="$PATH" npm ci; runuser -u fti -- env PATH="$PATH" FTI_APP_URL=/app/ npm run build)
install -m 0644 ops/nginx/fti-unified.conf "$CONF"
nginx -t
systemctl restart fti-testnet-web.service
systemctl reload nginx
curl --retry 8 --retry-connrefused --retry-all-errors --retry-delay 2 --fail --silent --show-error http://127.0.0.1:3090/health -o "$FTI_BACKUP/health.json"
node --input-type=module - "$FTI_BACKUP/health.json" <<'NODE'
import fs from 'node:fs';
const h=JSON.parse(fs.readFileSync(process.argv[2]));
if(!h.ok||h.chainId!==97||h.mode!=='testnet')throw Error('Unexpected backend network or mode.');
console.log('PASS testnet health');
NODE
for route in / /app/ /app/app.js /app/style.css /api/config /abi/FTIToken /vendor/ethers.js; do
 curl --fail --silent --show-error "http://127.0.0.1:3090$route" -o /dev/null
 printf 'PASS %s\n' "$route"
done
trap - ERR
printf '\nUnified website is ready on port 3090. Member panel: /app/\n'
printf 'Existing port 3080 remains available. No contracts were deployed.\n'
printf 'Frontend rollback files: %s\n' "$FTI_BACKUP"
