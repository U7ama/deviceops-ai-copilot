"""One invocation per process; stdout carries only the validated result envelope."""
from __future__ import annotations
import json
import logging
from pathlib import Path
import signal
import sys
from config import Settings
from budget import BudgetExceeded
from models import EmbeddingRequest, InvestigationRequest


def underlying_error(error: Exception) -> Exception:
    from strands.types.exceptions import EventLoopException
    seen = set()
    while isinstance(error, EventLoopException) and id(error) not in seen:
        seen.add(id(error))
        inner = error.original_exception
        if not isinstance(inner, Exception):
            break
        error = inner
    return error


def safe_diagnostic(error: Exception) -> dict:
    """No exception messages, source text, locals, paths or request payloads."""
    frames = []
    tb = error.__traceback__
    while tb is not None:
        frames.append({"file": Path(tb.tb_frame.f_code.co_filename).name,
                       "line": tb.tb_lineno, "function": tb.tb_frame.f_code.co_name})
        tb = tb.tb_next
    code = getattr(error, "status_code", None) or getattr(error, "code", None)
    return {"type": type(error).__name__, "status": code if type(code) is int else None,
            "frames": frames[-8:]}


def _cancel(_signal, _frame):
    # SystemExit unwinds the MCP context so its child session can be shut down too.
    raise SystemExit(143)


def main() -> int:
    logging.disable(logging.CRITICAL)
    signal.signal(signal.SIGTERM, _cancel)
    try:
        settings = Settings.from_env()
        settings.require_operation(sys.argv[1] if len(sys.argv) == 2 else "invalid")
        payload = json.loads(sys.stdin.buffer.read(128 * 1024))
        if sys.argv[1:] == ["investigate"]:
            from agent import investigate
            result = investigate(InvestigationRequest.model_validate(payload), settings)
        elif sys.argv[1:] == ["embed"]:
            from agent import embed
            result = embed(EmbeddingRequest.model_validate(payload), settings)
        else:
            raise ValueError("unsupported operation")
        print(result.model_dump_json())
        return 0
    except BudgetExceeded as err:
        print(json.dumps({"error": "budget_exhausted", "diagnostic": {"message": str(err), **safe_diagnostic(err)}}))
    except Exception as error:
        # Emit allowlisted categories only; never provider text, headers or payloads.
        from strands.types.exceptions import ModelThrottledException
        error = underlying_error(error)
        code = getattr(error, "status_code", None) or getattr(error, "code", None)
        if isinstance(error, ModelThrottledException) or code == 429:
            category = "provider_rate_limited"
        elif code == 404:
            category = "provider_model_unavailable"
        elif code in {401, 403}:
            category = "provider_access_denied"
        elif code == 400:
            category = "provider_invalid_request"
        elif type(error).__name__ == "ValidationError":
            category = "invalid_provider_result"
        else:
            category = "provider_unavailable"
        print(json.dumps({"error": category, "diagnostic": safe_diagnostic(error)}))
    return 1


if __name__ == "__main__":
    sys.exit(main())
