"""Exercise the actual setup heredoc with a controlling PTY, not mocked getpass."""
import errno
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import sys
import tempfile
import time
import unittest


SCRIPT = Path(__file__).with_name('setup.sh').read_text().split("<<'RPC'\n", 1)[1].split('\nRPC\n', 1)[0]


class PromptTests(unittest.TestCase):
    def run_prompt(self, value):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'rpc'
            pid, master = pty.fork()
            if pid == 0:
                os.execv(sys.executable, [sys.executable, '-c', SCRIPT, str(target)])
            output = b''
            sent = False
            status = None
            try:
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if select.select([master], [], [], 0.1)[0]:
                        try:
                            data = os.read(master, 4096)
                        except OSError as error:
                            if error.errno != errno.EIO:
                                raise
                            break
                        if not data:
                            break
                        output += data
                        if not sent and b'wallet key): ' in output:
                            os.write(master, value.encode() + b'\n')
                            sent = True
                else:
                    self.fail('Hidden RPC prompt timed out')
                _, status = os.waitpid(pid, 0)
                self.assertTrue(sent, output.decode(errors='replace'))
                if value:
                    self.assertEqual(os.waitstatus_to_exitcode(status), 0, output)
                    self.assertNotIn(value.encode(), output)
                    self.assertEqual(target.read_text(), value + '\n')
                    self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                else:
                    self.assertNotEqual(os.waitstatus_to_exitcode(status), 0)
                    self.assertFalse(target.exists())
            finally:
                os.close(master)
                if status is None:
                    os.kill(pid, signal.SIGKILL)
                    os.waitpid(pid, 0)

    def test_hidden_input_and_private_file_on_real_terminal(self):
        self.run_prompt('https://example.invalid/private-test-token')

    def test_empty_input_creates_no_file(self):
        self.run_prompt('')

    def test_no_terminal_fails_without_reading_stdin(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'rpc'
            result = subprocess.run(
                [sys.executable, '-c', SCRIPT, str(target)],
                input='must-not-be-used\n', text=True, capture_output=True,
                start_new_session=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(target.exists())
            self.assertNotIn('must-not-be-used', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
