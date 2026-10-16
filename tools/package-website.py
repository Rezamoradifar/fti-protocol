#!/usr/bin/env python3
"""Build a clean website handoff without tests, secrets or chain operators."""
from pathlib import Path
import hashlib,json,shutil,subprocess,sys,zipfile
root=Path(__file__).resolve().parent.parent
out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=False)
for name in ('frontend','core','web','landing/src','landing/public','landing/dist'):
    shutil.copytree(root/name,out/name,ignore=shutil.ignore_patterns('node_modules','__pycache__'))
for name in ('config/social-links.json','landing/build.mjs','landing/package.json','landing/package-lock.json','landing/install_dist.py','scripts/build-web.mjs','tools/install-delivery.py'):
    (out/name).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/name,out/name)
shutil.copy2(root/'delivery/README.fa.md',out/'README.md')
pkg=json.loads((root/'package.json').read_text())
pkg['scripts']={'build:web':'node scripts/build-web.mjs','build:landing':'npm --prefix landing run build'}
pkg['description']='FTI website source handoff; uses the existing mainnet backend'
pkg['dependencies']={k:v for k,v in pkg['dependencies'].items() if k in ('react','react-dom','ethers','@walletconnect/ethereum-provider')}
pkg['devDependencies']={'esbuild':pkg['devDependencies']['esbuild']}
(out/'package.json').write_text(json.dumps(pkg,indent=2)+'\n')
shutil.copy2(root/'package-lock.json',out/'package-lock.json')
lpkg=json.loads((out/'landing/package.json').read_text());lpkg['scripts']={'build':'node build.mjs'};lpkg['devDependencies'].pop('@playwright/test',None)
(out/'landing/package.json').write_text(json.dumps(lpkg,indent=2)+'\n')
for cwd in (out,out/'landing'):
    subprocess.run(['npm','install','--package-lock-only','--ignore-scripts','--offline','--no-audit','--no-fund'],cwd=cwd,check=True)
# Production dependencies remain locked; no dependency folder is distributed.
files={p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file()}
assert not any('/tests/' in '/'+n or '/test/' in '/'+n or n.endswith('.env') for n in files)
(out/'CHECKSUMS.json').write_text(json.dumps(files,indent=2)+'\n')
archive=out.with_suffix('.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in out.rglob('*'):
        if p.is_file():z.write(p,p.relative_to(out.parent))
print(archive)
