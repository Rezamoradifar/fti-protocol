#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
[ "$(id -u)" = 0 ]
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
pid=$(systemctl show fti-continuity-web.service --property=MainPID --value)
[[ "$pid" =~ ^[0-9]+$ ]] && [ "$pid" -gt 1 ]
node=$(readlink -f "/proc/$pid/exe")
[[ "$node" == /opt/fti/runtime/node-v22.*/bin/node ]]
export PATH="$(dirname "$node"):$PATH"
cd "$source_dir"
npm --prefix landing ci
npm --prefix landing run build
python3 - "$source_dir" <<'PY'
import fcntl,importlib.util,sys,subprocess
from pathlib import Path
root=Path(sys.argv[1])
spec=importlib.util.spec_from_file_location('mainnet',root/'tools/activate-mainnet-web.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
with open('/run/lock/fti-service-cutover.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 saved=w.h.capture('web')
 cfg=w.h.http_json('http://127.0.0.1:3110/api/config');w.check_target(cfg)
 w.check_web(cfg,'https://ftiprotocol.com')
 release=Path(saved['properties']['WorkingDirectory'])
 w.h.require(release.parent==Path('/opt/fti/releases') and release.resolve()==release,'Unexpected release path')
 target=release/'landing/dist'
 w.h.require(target.is_dir() and target.resolve()==target,'Unexpected landing directory')
 w.h.require(w.h.properties('web')==saved['properties'],'Service changed during build')
 subprocess.run(['bash',str(root/'landing/install-dist.sh'),'--source',str(root/'landing/dist'),'--target',str(target),'--origin','https://ftiprotocol.com','--resolve','ftiprotocol.com:443:127.0.0.1'],check=True)
 print('FTI_MAINNET_LANDING_UPDATED; browser verification still required')
PY
