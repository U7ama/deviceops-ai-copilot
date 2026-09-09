"""Trusted process configuration; no credentials or endpoints come from the model."""
from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]


def bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    value = int(os.getenv(name, str(default)))
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


@dataclass(frozen=True)
class Settings:
    service_token: str = field(repr=False)
    deviceops_url: str = "http://web:3000"
    region: str = "us-east-1"
    model_id: str = "us.amazon.nova-lite-v1:0"
    embedding_model_id: str = "amazon.titan-embed-text-v2:0"
    mcp_command: str = "/usr/local/bin/node"
    mcp_args: tuple[str, ...] = ("--import", "tsx", str(ROOT / "apps/mcp/src/index.ts"))
    provider: str = "bedrock"
    gemini_api_key: str = field(default="", repr=False)
    gemini_confirmed: bool = False
    credits_confirmed: bool = False
    timeout_seconds: int = 120
    max_model_calls: int = 8
    max_tool_calls: int = 12
    max_output_per_call: int = 2000
    max_input_tokens: int = 120000
    max_output_tokens: int = 8000

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.getenv("STRANDS_SERVICE_TOKEN", "")
        if len(token) < 32:
            raise ValueError("STRANDS_SERVICE_TOKEN must contain at least 32 characters")
        endpoint = os.getenv("DEVICEOPS_URL", "http://web:3000").rstrip("/")
        parsed = urlparse(endpoint)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("DEVICEOPS_URL must be a trusted HTTP(S) origin")
        if parsed.path not in {"", "/"}:
            raise ValueError("DEVICEOPS_URL must not include a path")
        command = os.getenv("DEVICEOPS_MCP_COMMAND", shutil.which("node") or "/usr/local/bin/node")
        if not Path(command).is_absolute():
            raise ValueError("DEVICEOPS_MCP_COMMAND must be absolute")
        default_args = ["--import", "tsx", str(ROOT / "apps/mcp/src/index.ts")]
        args = json.loads(os.getenv("DEVICEOPS_MCP_ARGS", json.dumps(default_args)))
        if not isinstance(args, list) or not args or not all(isinstance(arg, str) and arg for arg in args):
            raise ValueError("DEVICEOPS_MCP_ARGS must be a nonempty JSON array of strings")
        provider = os.getenv("STRANDS_MODEL_PROVIDER", "bedrock")
        if provider not in {"bedrock", "gemini"}:
            raise ValueError("STRANDS_MODEL_PROVIDER must be bedrock or gemini")
        model_id = os.getenv("GEMINI_MODEL_ID", "gemini-3.7-flash") if provider == "gemini" else os.getenv("BEDROCK_MODEL_ID", "us.amazon.nova-lite-v1:0")
        if provider == "gemini" and model_id not in {"gemini-2.5-flash", "gemini-3.7-flash"}:
            raise ValueError("Gemini model must match a validated budget configuration")
        return cls(
            provider=provider, gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
            gemini_confirmed=os.getenv("GEMINI_USAGE_CONFIRMED") == "true",
            service_token=token, deviceops_url=endpoint, mcp_command=command, mcp_args=tuple(args),
            credits_confirmed=os.getenv("AWS_CREDITS_CONFIRMED") == "true",
            region=os.getenv("AWS_REGION", "us-east-1"),
            model_id=model_id,
            embedding_model_id=os.getenv("BEDROCK_EMBEDDING_MODEL_ID", "amazon.titan-embed-text-v2:0"),
            timeout_seconds=bounded_int("AGENT_TIMEOUT_SECONDS", 120, 1, 120),
            max_model_calls=bounded_int("AGENT_MAX_MODEL_CALLS", 8, 1, 8),
            max_tool_calls=bounded_int("AGENT_MAX_TOOL_CALLS", 12, 1, 12),
            max_output_per_call=bounded_int("AGENT_MAX_OUTPUT_PER_CALL", 2000, 1, 2000),
            max_input_tokens=bounded_int("AGENT_MAX_INPUT_TOKENS", 120000, 1, 120000),
            max_output_tokens=bounded_int("AGENT_MAX_OUTPUT_TOKENS", 8000, 1, 8000),
        )

    def require_operation(self, operation: str) -> None:
        if operation == "embed":
            if self.provider != "bedrock":
                raise ValueError("embeddings_disabled_for_gemini")
            if not self.credits_confirmed:
                raise ValueError("credits_confirmation_required")
        elif self.provider == "gemini":
            if not self.gemini_confirmed or not self.gemini_api_key:
                raise ValueError("gemini_configuration_required")
            if self.model_id not in {"gemini-2.5-flash", "gemini-3.7-flash"}:
                raise ValueError("unsupported_gemini_model")
        elif self.provider == "bedrock":
            if not self.credits_confirmed:
                raise ValueError("credits_confirmation_required")
        else:
            raise ValueError("unsupported_provider")

    def mcp_environment(self, grant: str) -> dict[str, str]:
        # Override MCP's default HOME/PATH inheritance; no database, AWS or node preload secrets.
        return {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/nonexistent", "NODE_ENV": "production",
                "DEVICEOPS_URL": self.deviceops_url, "DEVICEOPS_MCP_GRANT": grant}
