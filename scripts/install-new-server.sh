#!/usr/bin/env bash
# New Ubuntu/Debian server only. Restores existing testnet, never deploys contracts.
set -euo pipefail
umask 022
[ "$(id -u)" -eq 0 ] || { echo 'Run as root on the NEW server.'; exit 1; }
: "${FTI_PUBLIC_HOST:?Set FTI_PUBLIC_HOST to the new server IPv4 address or domain (no scheme).}"
[[ "$FTI_PUBLIC_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || { echo 'Invalid public host'; exit 1; }
BACKUP=${1:-/root/fti-migration.tar.gz}
[ -f "$BACKUP" ] || { echo "Missing backup: $BACKUP"; exit 1; }
APP=/opt/fti-protocol
[ ! -e "$APP" ] && [ ! -e /root/fti-migration-restore ] || { echo 'Install paths already exist; inspect the earlier installation. Nothing overwritten.'; exit 1; }
for port in 3080 3081 3090; do
 if ss -ltnH | awk '{print $4}' | grep -Eq ":${port}$"; then echo "Port $port is in use; stop and inspect before installation."; exit 1; fi
done
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx python3 xz-utils
TASK_TMP=$(mktemp -d)
trap 'rm -rf "$TASK_TMP"' EXIT
case "$(uname -m)" in x86_64) NODE_ARCH=x64;; aarch64) NODE_ARCH=arm64;; *) echo 'Unsupported architecture';exit 1;; esac
curl --fail --silent --show-error --location https://nodejs.org/dist/index.json -o "$TASK_TMP/index.json"
NODE_VERSION=$(python3 - "$TASK_TMP/index.json" <<'PY'
import json,sys,re
for item in json.load(open(sys.argv[1])):
 if re.fullmatch(r'v22\.\d+\.\d+',item['version']):print(item['version']);break
else:raise SystemExit('No Node 22 release found')
PY
)
NODE_FILE="node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
curl --fail --silent --show-error --location "https://nodejs.org/dist/$NODE_VERSION/$NODE_FILE" -o "$TASK_TMP/$NODE_FILE"
curl --fail --silent --show-error --location "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$TASK_TMP/SHASUMS256.txt"
(cd "$TASK_TMP"; awk -v file="$NODE_FILE" '$2==file {print}' SHASUMS256.txt > CHECKSUM; test -s CHECKSUM; sha256sum -c CHECKSUM)
NODE_DIR="/opt/node-$NODE_VERSION-linux-$NODE_ARCH"
[ ! -e "$NODE_DIR" ] || { echo 'Node install path already exists; inspect before retrying.';exit 1; }
tar -xJf "$TASK_TMP/$NODE_FILE" -C /opt
export PATH="$NODE_DIR/bin:/usr/sbin:/usr/bin:/sbin:/bin"
# Dedicated unprivileged web service. No wallet key is given to this service.
if ! id fti >/dev/null 2>&1; then useradd --system --create-home --home-dir /var/lib/fti --shell /usr/sbin/nologin fti; fi
install -d -o fti -g fti "$APP"
runuser -u fti -- git clone https://github.com/Rezamoradifar/fti-protocol.git "$APP"
cd "$APP"
python3 scripts/migration-restore.py "$BACKUP" /root/fti-migration-restore
python3 - <<'PY'
import json,pathlib,shutil
src=pathlib.Path('/root/fti-migration-restore/project');dst=pathlib.Path('/opt/fti-protocol')
d=json.loads((src/'deployments/testnet.json').read_text())
if d.get('chainId')!=97 or d.get('mode')!='testnet' or d.get('liquidityVersion'):
 raise SystemExit('Expected the existing legacy BNB testnet deployment; candidate migration requires separate review.')
for name in ['MockUSD','FTIToken','BinaryPlan','Council','FTITimelock']:
 f=src/'artifacts'/(name+'.json');j=json.loads(f.read_text())
 if not isinstance(j.get('abi'),list):raise SystemExit('Invalid artifact '+name)
 (dst/'artifacts').mkdir(exist_ok=True);shutil.copyfile(f,dst/'artifacts'/f.name)
(dst/'deployments').mkdir(exist_ok=True);shutil.copyfile(src/'deployments/testnet.json',dst/'deployments/testnet.json')
PY
chown -R fti:fti "$APP"
runuser -u fti -- env PATH="$PATH" npm ci
runuser -u fti -- env PATH="$PATH" npm run build:web
runuser -u fti -- env PATH="$PATH" RPC_URL="${RPC_URL:-https://bsc-testnet.bnbchain.org}" node scripts/migration-preflight.mjs
(cd landing; runuser -u fti -- env PATH="$PATH" npm ci; runuser -u fti -- env PATH="$PATH" FTI_APP_URL="/app/" npm run build)
install -d -m 0755 /etc/fti
python3 - <<'PY'
import os,pathlib
values={'NODE_ENV':'production','HOST':'127.0.0.1','PORT':'3081','DEPLOYMENT_FILE':'deployments/testnet.json','RPC_URL':os.environ.get('RPC_URL','https://bsc-testnet.bnbchain.org')}
if os.environ.get('EVENT_RPC_URL'):values['EVENT_RPC_URL']=os.environ['EVENT_RPC_URL']
for value in values.values():
 if any(c in value for c in '\r\n\x00'):raise SystemExit('Invalid environment value')
p=pathlib.Path('/etc/fti/web.env');p.write_text(''.join(k+'='+v+'\n' for k,v in values.items()));p.chmod(0o600)
PY
cat > /etc/systemd/system/fti-testnet-web.service <<UNIT
[Unit]
Description=FTI Testnet Application
After=network-online.target
Wants=network-online.target
[Service]
User=fti
Group=fti
WorkingDirectory=$APP
EnvironmentFile=/etc/fti/web.env
ExecStart=$NODE_DIR/bin/node $APP/scripts/server.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
[Install]
WantedBy=multi-user.target
UNIT
install -m 0644 ops/nginx/fti-unified.conf /etc/nginx/conf.d/fti-new-server.conf
# Nginx only needs public frontend files; secret archive stays under /root.
chmod 0755 /opt /opt/fti-protocol /opt/fti-protocol/landing /opt/fti-protocol/landing/dist
find /opt/fti-protocol/landing/dist -type d -exec chmod 0755 {} +
find /opt/fti-protocol/landing/dist -type f -exec chmod 0644 {} +
nginx -t
systemctl daemon-reload
systemctl enable --now fti-testnet-web nginx
systemctl restart fti-testnet-web
systemctl reload nginx
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then ufw allow 3080/tcp;ufw allow 3090/tcp;fi
curl --retry 8 --retry-connrefused --retry-delay 2 --fail --silent --show-error http://127.0.0.1:3080/health
curl --fail --silent --show-error http://127.0.0.1:3090/ -o /dev/null
printf '\nMember panel: http://%s:3090/app/\nWebsite: http://%s:3090\n' "$FTI_PUBLIC_HOST" "$FTI_PUBLIC_HOST"
printf 'Existing contracts reused. Private snapshot: /root/fti-migration-restore\n'
printf 'Keeper/signing services were not activated. See docs/NEW-SERVER.md before cutover.\n'
