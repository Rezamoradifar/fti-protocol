#!/usr/bin/env python3
"""Interrupt only the selected, childless, pre-deployment testnet runner.

Linux pidfds prevent PID reuse from signalling a different process. Pause the
verified lock holder while checking the journal, then always resume it. Never
remove locks/journals, read keys, access RPC, or send blockchain transactions.
"""
import argparse
import fcntl
import os
from pathlib import Path
import re
import select
import signal
import stat
import sys
import time

BASE = Path('/root/fti-fresh-testnet-runner/bc2163070a6e79bcc129a6a788e61c4ace402bdf')


class RecoveryError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise RecoveryError(message)


def no_marker(base):
    require(not os.path.lexists(base / 'deployment-requested.json'),
            'Deployment marker exists. Preserve the journal; no stop or repeat.')


def owns_lock(pid, info):
    expected = (os.major(info.st_dev), os.minor(info.st_dev), info.st_ino)
    for row in Path('/proc/locks').read_text().splitlines():
        fields = row.split()
        if len(fields) < 6 or fields[1:4] != ['FLOCK', 'ADVISORY', 'WRITE']:
            continue
        if fields[4] != str(pid):
            continue
        major, minor, inode = fields[5].split(':')
        if (int(major, 16), int(minor, 16), int(inode)) == expected:
            return True
    return False


def has_children(proc):
    try:
        return bool((proc / 'task' / proc.name / 'children').read_text().strip())
    except FileNotFoundError:
        # Some kernels omit the optional procfs children file.
        for entry in Path('/proc').iterdir():
            if not entry.name.isdigit():
                continue
            try:
                fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            except FileNotFoundError:
                continue
            if fields[1] == proc.name:
                return True
        return False


def recover(base, pid):
    require(pid > 1 and pid != os.getpid(), 'Invalid runner PID.')
    require(base.is_absolute() and all(not p.is_symlink() for p in [base, *base.parents]),
            'Runner directory must not contain symlinks.')
    info = base.stat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and info.st_mode & 0o077 == 0, 'Runner directory is not private or owned by this user.')
    no_marker(base)
    lock = os.open(base / 'runner.lock', os.O_RDWR | os.O_NOFOLLOW)
    try:
        lock_info = os.fstat(lock)
        require(stat.S_ISREG(lock_info.st_mode) and lock_info.st_nlink == 1
                and lock_info.st_uid == os.geteuid(), 'Unexpected lock file.')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass
        else:
            no_marker(base)
            return 'NO_ACTIVE_RUNNER'
        require(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'),
                'Recovery requires Python 3.9+ and Linux pidfd support.')
        target = os.pidfd_open(pid)
        try:
            # procfs may be mounted from an outer PID namespace. The pidfd's
            # fdinfo supplies the matching procfs identity without a PID search.
            proc_pid = next(int(line.split()[1]) for line in
                            Path('/proc/self/fdinfo', str(target)).read_text().splitlines()
                            if line.startswith('Pid:'))
            require(proc_pid > 1, 'Selected runner has already exited.')
            proc = Path('/proc') / str(proc_pid)
            require(proc.stat().st_uid == os.geteuid()
                    and re.fullmatch(r'python3(?:\.\d+)?', (proc / 'comm').read_text().strip())
                    and owns_lock(proc_pid, lock_info),
                    'Selected PID is not the Python holder of this runner lock. Nothing stopped.')
            paused = False
            try:
                paused = True
                signal.pidfd_send_signal(target, signal.SIGSTOP)
                deadline = time.monotonic() + 3
                while True:
                    state = next(line.split()[1] for line in (proc / 'status').read_text().splitlines()
                                 if line.startswith('State:'))
                    if state in ('T', 't'):
                        break
                    require(time.monotonic() < deadline, 'Could not pause the runner; no interrupt sent.')
                    time.sleep(0.02)
                # No new deployment can cross the marker boundary while paused.
                no_marker(base)
                require(not has_children(proc),
                        'Runner has an active child stage. Original run resumed; no restart.')
                require(owns_lock(proc_pid, lock_info), 'Runner lock changed; no interrupt sent.')
                signal.pidfd_send_signal(target, signal.SIGINT)
            finally:
                if paused:
                    try:
                        signal.pidfd_send_signal(target, signal.SIGCONT)
                    except ProcessLookupError:
                        pass
            require(bool(select.select([target], [], [], 10)[0]),
                    'Runner did not exit after interrupt. No forced kill or restart.')
        finally:
            os.close(target)
        no_marker(base)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RecoveryError('Runner lock remains active. No restart.') from None
        return 'PREDEPLOY_RUNNER_STOPPED PID=' + str(pid)
    finally:
        os.close(lock)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', type=int, required=True, help='Previously observed runner lock holder.')
    args = parser.parse_args()
    try:
        require(os.geteuid() == 0, 'Run in the root VPS terminal.')
        print(recover(BASE, args.pid), flush=True)
    except RecoveryError as error:
        sys.exit('FTI_RECOVERY_STOPPED: ' + str(error))
    except OSError as error:
        sys.exit('FTI_RECOVERY_STOPPED: local process/file error, errno=' + str(error.errno)
                 + '. Preserve the lock and journal; do not blindly retry.')
