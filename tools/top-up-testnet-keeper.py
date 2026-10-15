#!/usr/bin/env python3
"""One bounded gas top-up for the already-running testnet Keeper."""
import argparse
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path
import sys

LAUNCHER_HASH = 'a58bece4d9948d014c561cf4230d6bba421488feab81c6aaaa535c9a4418a90a'
RUNNER_HASH = 'b4b16feaee80d655668660919368a14ced9023f02d4d02765f4c8fbd73e8a698'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--journey-dir', required=True)
    parser.add_argument('--rpc-file', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run as root on the existing FTI server')
    launcher = Path(args.journey_dir) / 'run-fresh-testnet-journey.py'
    script = Path(__file__).resolve().with_suffix('.mjs')
    if hashlib.sha256(launcher.read_bytes()).hexdigest() != LAUNCHER_HASH:
        raise RuntimeError('Journey launcher hash mismatch')
    if hashlib.sha256(script.read_bytes()).hexdigest() != RUNNER_HASH:
        raise RuntimeError('Top-up runner hash mismatch')
    spec = importlib.util.spec_from_file_location('fti_reviewed_journey', launcher)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _, source, node, env, _ = module.prepare(args.rpc_file)
    fd = os.open(module.STATE / 'keeper-topup.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    os.set_inheritable(fd, True)
    print('Keeper gas only: top up to 0.005 tBNB; maximum additional transfer gas 0.0000021 tBNB. Separate from journey budget.', flush=True)
    os.chdir(source)
    os.execve(str(node), [str(node), str(script)], env)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('FTI_KEEPER_TOPUP_STOPPED: ' + (str(exc) if isinstance(exc, RuntimeError) else 'Local preflight failed; no secret output displayed.'), file=sys.stderr)
        sys.exit(1)
