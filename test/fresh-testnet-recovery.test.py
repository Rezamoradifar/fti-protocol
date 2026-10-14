"""Exercise recovery using real local processes and flock; no network or keys."""
import contextlib
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('recovery', Path(__file__).resolve().parents[1]
                                            / 'tools/recover-fresh-testnet-runner.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)

HOLDER = '''import fcntl, pathlib, signal, subprocess, sys, time
lock = open(sys.argv[1], 'a+b')
fcntl.flock(lock, fcntl.LOCK_EX)
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']) if sys.argv[2]=='child' else None
print(child.pid if child else 0, flush=True)
try:
    sys.stdin.readline()
except KeyboardInterrupt:
    pass
finally:
    if child:
        child.terminate()
        child.wait()
'''


@contextlib.contextmanager
def holder(base, child=False):
    p = subprocess.Popen([sys.executable, '-c', HOLDER, str(base / 'runner.lock'),
                          'child' if child else 'none'], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert p.stdout.readline().strip().isdigit()
        yield p
    finally:
        if p.poll() is None:
            p.send_signal(signal.SIGCONT)
            p.send_signal(signal.SIGINT)
        p.communicate(timeout=5)


class RecoveryTests(unittest.TestCase):
    def test_childless_predeploy_runner_stops_and_preserves_lock_inode(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            with holder(base) as p:
                inode = (base / 'runner.lock').stat().st_ino
                self.assertIn('PREDEPLOY_RUNNER_STOPPED', recovery.recover(base, p.pid))
                p.wait(timeout=1)
                self.assertEqual((base / 'runner.lock').stat().st_ino, inode)
                self.assertFalse((base / 'deployment-requested.json').exists())

    def test_marker_prevents_any_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            with holder(base) as p:
                marker = base / 'deployment-requested.json'
                marker.write_text('keep this journal')
                with patch.object(recovery.signal, 'pidfd_send_signal') as send:
                    with self.assertRaisesRegex(recovery.RecoveryError, 'marker exists'):
                        recovery.recover(base, p.pid)
                    send.assert_not_called()
                self.assertIsNone(p.poll())
                self.assertEqual(marker.read_text(), 'keep this journal')

    def test_marker_appearing_at_pause_resumes_without_interrupt(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            with holder(base) as p:
                original = signal.pidfd_send_signal
                def racing_marker(fd, sig):
                    original(fd, sig)
                    if sig == signal.SIGSTOP:
                        (base / 'deployment-requested.json').write_text('new journal')
                with patch.object(recovery.signal, 'pidfd_send_signal', side_effect=racing_marker) as send:
                    with self.assertRaisesRegex(recovery.RecoveryError, 'marker exists'):
                        recovery.recover(base, p.pid)
                    self.assertNotIn(signal.SIGINT, [c.args[1] for c in send.call_args_list])
                    self.assertIn(signal.SIGCONT, [c.args[1] for c in send.call_args_list])
                self.assertIsNone(p.poll())

    def test_active_child_stage_is_resumed_and_not_interrupted(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            with holder(base, child=True) as p:
                with self.assertRaisesRegex(recovery.RecoveryError, 'active child stage'):
                    recovery.recover(base, p.pid)
                self.assertIsNone(p.poll())
                p.stdin.write('\n')
                p.stdin.flush()
                self.assertEqual(p.wait(timeout=3), 0)

    def test_free_lock_is_unchanged_and_needs_no_process_signal(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            lock = base / 'runner.lock'
            lock.write_bytes(b'preserve')
            with patch.object(recovery.signal, 'pidfd_send_signal') as send:
                self.assertEqual(recovery.recover(base, 999999), 'NO_ACTIVE_RUNNER')
                send.assert_not_called()
            self.assertEqual(lock.read_bytes(), b'preserve')

    def test_wrong_python_pid_receives_no_signal(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            with holder(base) as original:
                other = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
                try:
                    with patch.object(recovery.signal, 'pidfd_send_signal') as send:
                        with self.assertRaisesRegex(recovery.RecoveryError, 'not the Python holder'):
                            recovery.recover(base, other.pid)
                        send.assert_not_called()
                    self.assertIsNone(original.poll())
                    self.assertIsNone(other.poll())
                finally:
                    other.terminate()
                    other.wait(timeout=3)


if __name__ == '__main__':
    unittest.main()
