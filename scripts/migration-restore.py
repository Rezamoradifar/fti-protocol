#!/usr/bin/env python3
"""Extract into a NEW private directory and verify every regular file."""
import argparse, hashlib, json, os, pathlib, shutil, tarfile
p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('destination');a=p.parse_args()
archive=pathlib.Path(a.archive).resolve();dest=pathlib.Path(a.destination).resolve()
if dest.exists():raise SystemExit('Destination already exists; choose a new private directory.')
os.umask(0o077)
with tarfile.open(archive,'r:gz') as tar:
 members=tar.getmembers();names=set();size=0
 for m in members:
  path=pathlib.PurePosixPath(m.name)
  if path.is_absolute() or '..' in path.parts or m.name in names or not(m.isdir() or m.isfile()):raise SystemExit('Unsafe or duplicate archive entry.')
  names.add(m.name);size+=m.size
 if size>2*1024**3:raise SystemExit('Unexpected backup size (over 2 GiB).')
 dest.mkdir(mode=0o700)
 for m in members:
  target=dest/m.name
  if m.isdir():target.mkdir(parents=True,exist_ok=True,mode=0o700)
  else:
   target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
   with tar.extractfile(m) as src,target.open('xb') as dst:shutil.copyfileobj(src,dst)
 manifest=json.loads((dest/'MANIFEST.json').read_text())
 actual={str(f.relative_to(dest)):hashlib.sha256(f.read_bytes()).hexdigest() for f in dest.rglob('*') if f.is_file() and f!=dest/'MANIFEST.json'}
 if actual!=manifest:raise SystemExit('Backup checksum verification failed. Do not install this snapshot.')
print('Verified private snapshot:',dest)
