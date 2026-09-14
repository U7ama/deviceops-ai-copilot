"""Linux child lifecycle guard: the MCP process cannot outlive its invocation runner."""
import ctypes
import os
import signal
import sys


def main() -> None:
    if sys.platform != "linux" or len(sys.argv) < 2 or not os.path.isabs(sys.argv[1]):
        raise SystemExit("MCP guard requires Linux and an absolute trusted command")
    parent = os.getppid()
    libc = ctypes.CDLL(None, use_errno=True)
    # PR_SET_PDEATHSIG persists across exec even though MCP owns a separate session.
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        raise SystemExit("Unable to install MCP parent-death guard")
    if os.getppid() != parent:
        raise SystemExit("Invocation runner exited during MCP startup")
    os.execve(sys.argv[1], sys.argv[1:], dict(os.environ))


if __name__ == "__main__":
    main()
