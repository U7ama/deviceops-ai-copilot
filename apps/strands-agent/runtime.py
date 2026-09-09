"""Process isolation makes cancellation stop model work rather than abandon a thread."""
from __future__ import annotations
import asyncio
import json
import logging
import os
from pathlib import Path
import signal
import sys
from typing import Any
from config import Settings


class InvocationFailure(Exception):
    def __init__(self, code: str, status_code: int = 502):
        self.code, self.status_code = code, status_code
        super().__init__(code)


def runner_environment(settings: Settings) -> dict[str, str]:
    # Provider credentials stay in the reasoning process only. No database credentials reach it.
    allowed = {"PATH", "HOME", "LANG", "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE",
               "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
               "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_WEB_IDENTITY_TOKEN_FILE",
               "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
               "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
               "AWS_EC2_METADATA_DISABLED", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "AWS_CA_BUNDLE"}
    env = {name: value for name, value in os.environ.items() if name in allowed}
    if settings.provider == "gemini":
        env = {name: value for name, value in env.items() if not name.startswith("AWS_")}
    env.update({"PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1",
                "OTEL_SDK_DISABLED": "true", "STRANDS_SERVICE_TOKEN": settings.service_token,
                "DEVICEOPS_URL": settings.deviceops_url,
                "AWS_REGION": settings.region, "BEDROCK_MODEL_ID": settings.model_id,
                "STRANDS_MODEL_PROVIDER": settings.provider,
                "GEMINI_MODEL_ID": settings.model_id if settings.provider == "gemini" else "gemini-2.5-flash",
                "GEMINI_API_KEY": settings.gemini_api_key if settings.provider == "gemini" else "",
                "GEMINI_USAGE_CONFIRMED": "true" if settings.gemini_confirmed else "false",
                "AWS_CREDITS_CONFIRMED": "true" if settings.credits_confirmed else "false",
                "BEDROCK_EMBEDDING_MODEL_ID": settings.embedding_model_id,
                "DEVICEOPS_MCP_COMMAND": settings.mcp_command,
                "DEVICEOPS_MCP_ARGS": json.dumps(settings.mcp_args),
                "AGENT_TIMEOUT_SECONDS": str(settings.timeout_seconds),
                "AGENT_MAX_MODEL_CALLS": str(settings.max_model_calls),
                "AGENT_MAX_TOOL_CALLS": str(settings.max_tool_calls),
                "AGENT_MAX_OUTPUT_PER_CALL": str(settings.max_output_per_call),
                "AGENT_MAX_INPUT_TOKENS": str(settings.max_input_tokens),
                "AGENT_MAX_OUTPUT_TOKENS": str(settings.max_output_tokens)})
    return env


async def run_isolated(operation: str, payload: dict[str, Any], settings: Settings) -> dict[str, Any]:
    if operation not in {"investigate", "embed"}:
        raise ValueError("unknown operation")
    process = await asyncio.create_subprocess_exec(
        sys.executable, str(Path(__file__).with_name("runner.py")), operation,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, env=runner_environment(settings), start_new_session=True,
    )
    try:
        async with asyncio.timeout(settings.timeout_seconds):
            stdout, _ = await process.communicate(json.dumps(payload).encode())
        if len(stdout) > 512 * 1024:
            raise InvocationFailure("invalid_provider_result")
        try:
            output = json.loads(stdout)
        except (ValueError, UnicodeDecodeError):
            raise InvocationFailure("provider_unavailable") from None
        if process.returncode != 0 or not isinstance(output, dict) or "error" in output:
            if isinstance(output, dict) and isinstance(output.get("diagnostic"), dict):
                logging.getLogger(__name__).warning("invocation_diagnostic %s", json.dumps(output["diagnostic"]))
            code = output.get("error") if isinstance(output, dict) else None
            known = {"budget_exhausted": 429, "configuration_error": 503, "provider_unavailable": 502, "provider_rate_limited": 429, "provider_model_unavailable": 503, "provider_access_denied": 503, "provider_invalid_request": 502, "invalid_provider_result": 502}
            raise InvocationFailure(code if code in known else "provider_unavailable", known.get(code, 502))
        return output
    except TimeoutError:
        raise InvocationFailure("invocation_timeout", 504) from None
    finally:
        if process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(process.wait(), 2)
            except TimeoutError:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                await process.wait()
