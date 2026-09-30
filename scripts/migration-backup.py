#!/usr/bin/env python3
"""Private FTI migration snapshot; never upload the archive to GitHub."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tarfile, tempfile
p=argparse.ArgumentParser();p.add_argument('--project',default='.');p.add_argument('--output',required=True);p.add_argument('--home',default=str(pathlib.Path.home()));a=p.parse_args()
project=pathlib.Path(a.project).resolve();home=pathlib.Path(a.home).resolve();out=pathlib.Path(a.output).resolve()
if not (project/'deployments/testnet.json').is_file():raise SystemExit('Missing deployments/testnet.json; run from the deployed project.')
if out.exists():raise SystemExit('Backup already exists; choose a new output name.')
if project==out or project in out.parents:raise SystemExit('Write the private backup outside the project directory.')
# A running writer could create an inconsistent wallet journal. Never kill it automatically.
for proc in pathlib.Path('/proc').glob('[0-9]*/cmdline'):
 try:args=proc.read_bytes().split(b'\0')
 except (OSError,PermissionError):continue
 if b'--write' in args and any(pathlib.PurePath(x.decode(errors='ignore')).name in ('testnet-100.mjs','testnet-journey.mjs') for x in args):
  raise SystemExit('A test writer is still running. Stop it gracefully before taking this backup.')
os.umask(0o077)
with tempfile.TemporaryDirectory(prefix='fti-migration-') as tmp:
 stage=pathlib.Path(tmp)
 def ignore(directory,names):
  return [n for n in names if n in ('.git','node_modules','qa','.sites-runtime') or (pathlib.Path(directory)/n).is_symlink()]
 shutil.copytree(project,stage/'project',ignore=ignore)
 private=stage/'private';private.mkdir()
 for name in ('.fti-testnet-100','.fti-testnet-journey'):
  src=home/name
  if src.is_dir():shutil.copytree(src,private/'home'/name,ignore=ignore)
 # Preserve service/config files for review, never auto-execute or enable signing services.
 for src in pathlib.Path('/etc/systemd/system').glob('fti*'):
  if src.is_symlink():continue
  dst=private/'systemd'/src.name;dst.parent.mkdir(parents=True,exist_ok=True)
  if src.is_dir():shutil.copytree(src,dst,ignore=ignore)
  elif src.is_file():shutil.copy2(src,dst)
 if pathlib.Path('/etc/fti').is_dir():shutil.copytree('/etc/fti',private/'etc-fti',ignore=ignore)
 try:revision=subprocess.check_output(['git','-C',str(project),'rev-parse','HEAD'],stderr=subprocess.DEVNULL,text=True).strip()
 except subprocess.CalledProcessError:revision='unknown'
 (stage/'BACKUP-NOTES.txt').write_text('PRIVATE: may contain wallet keys and RPC credentials. Do not publish.\nSource revision: '+revision+'\nSource snapshot preserved under project/. Signing services are not enabled on restore.\nManually preserve any custom external secrets, cron jobs, domains and certificates.\n')
 manifest={str(f.relative_to(stage)):hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(stage.rglob('*')) if f.is_file()}
 (stage/'MANIFEST.json').write_text(json.dumps(manifest,indent=2))
 with out.open('xb') as file:
  with tarfile.open(fileobj=file,mode='w:gz') as tar:
   for child in stage.iterdir():tar.add(child,arcname=child.name,recursive=True)
 digest=hashlib.sha256(out.read_bytes()).hexdigest()
 out.with_suffix(out.suffix+'.sha256').write_text(digest+'  '+out.name+'\n')
 print('Private backup created:',out);print('SHA256:',digest)
