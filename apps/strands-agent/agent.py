"""Strands reasoning with explicit Bedrock or Gemini selection; no provider fallback."""
from __future__ import annotations
import json
import base64
import math
import sys
from pathlib import Path
import boto3
from botocore.config import Config
from mcp import StdioServerParameters
from mcp.client.stdio import stdio_client
from strands import Agent
from strands.hooks import AfterToolCallEvent, BeforeToolCallEvent, HookProvider, HookRegistry
from strands.models import BedrockModel
from strands.tools.executors import SequentialToolExecutor
from strands.tools.mcp import MCPClient
from budget import Budget, BudgetExceeded
from config import ROOT, Settings
from models import EmbeddingRequest, EmbeddingResult, Investigation, InvestigationRequest, InvestigationResult, Usage
from prompts import SYSTEM_PROMPT

TOOL_NAMES = frozenset({"get_incident_context", "get_device_health", "query_telemetry_logs", "get_topology",
                       "search_manual", "correlate_changes", "get_action_capabilities"})
CLIENT_CONFIG = Config(connect_timeout=5, read_timeout=45, retries={"total_max_attempts": 1})


class BoundedModelMixin:
    def __init__(self, budget: Budget, **kwargs):
        self.budget = budget
        super().__init__(**kwargs)

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        # Text-only tool results and schemas: UTF-8 bytes plus framing reserve is a
        # conservative reservation. Reconcile with measured provider usage after streaming.
        input_bound = len(json.dumps({"messages": messages, "tools": tool_specs, "system": system_prompt,
                                      "system_content": kwargs.get("system_prompt_content"),
                                      "choice": kwargs.get("tool_choice")}, ensure_ascii=False, default=lambda value: base64.b64encode(value).decode() if isinstance(value, bytes) else str(value)).encode()) + 4096
        output_cap = self.budget.before_model(input_bound)
        self.set_output_cap(output_cap)
        usage_recorded = False
        async for event in super().stream(messages, tool_specs, system_prompt, **kwargs):
            usage = event.get("metadata", {}).get("usage")
            if usage is not None:
                if usage_recorded:
                    raise BudgetExceeded("duplicate provider usage")
                self.budget.record_usage(int(usage["inputTokens"]), int(usage["outputTokens"]), input_bound, output_cap)
                usage_recorded = True
            yield event
        if not usage_recorded:
            self.budget.blocked = True
            raise BudgetExceeded("provider usage unavailable")


class BoundedBedrockModel(BoundedModelMixin, BedrockModel):
    def set_output_cap(self, cap):
        self.update_config(max_tokens=cap)


def create_model(settings: Settings, budget: Budget):
    if settings.provider == "gemini":
        from strands.models.gemini import GeminiModel
        class BoundedGeminiModel(BoundedModelMixin, GeminiModel):
            def set_output_cap(self, cap):
                self.update_config(params={**self.config.get("params", {}), "max_output_tokens": cap})
        return BoundedGeminiModel(
            budget, model_id=settings.model_id,
            client_args={"api_key": settings.gemini_api_key,
                         "http_options": {"timeout": 45000, "retry_options": {"attempts": 1}}},
            params={"temperature": 0.1, "max_output_tokens": settings.max_output_per_call,
                    "thinking_config": ({"thinking_level": "low"} if settings.model_id == "gemini-3.7-flash" else {"thinking_budget": 0})},
        )
    if settings.provider != "bedrock":
        raise ValueError("unsupported provider")
    return BoundedBedrockModel(budget, model_id=settings.model_id, region_name=settings.region,
                              max_tokens=settings.max_output_per_call, temperature=0.1,
                              boto_client_config=CLIENT_CONFIG)


class InvestigationHooks(HookProvider):
    def __init__(self, budget: Budget):
        self.budget = budget
        self.successful_tools: set[str] = set()
        self.capability_targets: set[str] = set()

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeToolCallEvent, self.before_tool)
        registry.add_callback(AfterToolCallEvent, self.after_tool)

    def before_tool(self, event: BeforeToolCallEvent) -> None:
        if self.budget.blocked:
            event.cancel_tool = "Invocation budget exhausted"
            return
        if getattr(event.selected_tool, "tool_type", "") == "structured_output":
            return
        if event.tool_use["name"] not in TOOL_NAMES:
            event.cancel_tool = "Tool is outside this investigation's allowed capabilities"
            return
        try:
            self.budget.before_tool()
        except BudgetExceeded:
            event.cancel_tool = "Invocation tool budget exhausted"

    def after_tool(self, event: AfterToolCallEvent) -> None:
        if event.result.get("status") == "success" and event.tool_use["name"] in TOOL_NAMES:
            self.successful_tools.add(event.tool_use["name"])
            if event.tool_use["name"] == "get_action_capabilities":
                device_id = event.tool_use.get("input", {}).get("deviceId")
                if not isinstance(device_id, str):
                    for content in event.result.get("content", []):
                        try:
                            payload = content.get("json") or json.loads(content.get("text", "{}"))
                            if isinstance(payload, dict) and isinstance(payload.get("deviceId"), str):
                                device_id = payload["deviceId"]
                                break
                        except (ValueError, TypeError):
                            continue
                if isinstance(device_id, str):
                    self.capability_targets.add(device_id)


def investigate(request: InvestigationRequest, settings: Settings) -> InvestigationResult:
    if request.workflow == 'specialists':
        from dataclasses import replace
        settings = replace(settings, max_model_calls=12, max_tool_calls=24, max_output_tokens=12000, timeout_seconds=180)
    budget = Budget(settings)
    if settings.backend_control_checks or request.workflow == 'specialists':
        from urllib.request import Request, urlopen
        def report(stage=None, status=None, result=None):
            payload = {} if stage is None else {'stage':stage,'status':status, **({'result':result} if result is not None else {})}
            req = Request(settings.deviceops_url + '/api/v2/internal/invocation-status', data=json.dumps(payload).encode(),
                          headers={'Authorization':'Bearer '+request.grantToken, 'Content-Type':'application/json'})
            with urlopen(req, timeout=5) as response:
                if not json.loads(response.read(1024)).get('active'):
                    budget.blocked = True
                    raise BudgetExceeded('investigation cancelled or grant expired')
        budget.check_active = report
        budget.progress = report
    hooks = InvestigationHooks(budget)
    params = StdioServerParameters(command=sys.executable,
                                   args=[str(Path(__file__).with_name("mcp_guard.py")), settings.mcp_command, *settings.mcp_args],
                                   cwd=str(ROOT), env={**settings.mcp_environment(request.grantToken), "DEVICEOPS_MCP_WORKFLOW": request.workflow})
    client = MCPClient(lambda: stdio_client(params), startup_timeout=15,
                       tool_filters={"allowed": sorted(TOOL_NAMES | ({"run_sandboxed_analysis"} if request.workflow == "specialists" else set()))})
    try:
        with client:
            tools = client.list_tools_sync()
            if not TOOL_NAMES.issubset({tool.tool_name for tool in tools}):
                raise ValueError("required investigation tools unavailable")
            if request.workflow == 'specialists':
                from specialists import run_specialists
                return run_specialists(request, settings, budget, client, create_model)
            model = create_model(settings, budget)
            agent = Agent(model=model, tools=list(tools), system_prompt=SYSTEM_PROMPT,
                          structured_output_model=Investigation, hooks=[hooks], callback_handler=None,
                          tool_executor=SequentialToolExecutor(), retry_strategy=None,
                          load_tools_from_directory=False)
            result = agent(f"Investigate incident {request.incidentId}. Invocation {request.invocationId}. "
                           "Use the authorized tools to collect evidence before answering.")
            if budget.blocked:
                raise BudgetExceeded("invocation budget exhausted")
            diagnosis = Investigation.model_validate(result.structured_output)
            if "get_incident_context" not in hooks.successful_tools:
                raise ValueError("investigation did not obtain incident evidence")
            if diagnosis.action and diagnosis.action.targetDeviceId not in hooks.capability_targets:
                raise ValueError("proposed action has no capability lookup for its target")
            return InvestigationResult(**diagnosis.model_dump(), provider=f"strands-{settings.provider}", modelId=settings.model_id,
                                       usage=Usage(inputTokens=budget.input_tokens, outputTokens=budget.output_tokens,
                                                   modelCalls=budget.model_calls), toolCalls=budget.tool_calls)
    except Exception:
        if budget.blocked:
            raise BudgetExceeded("invocation budget exhausted") from None
        raise


def embed(request: EmbeddingRequest, settings: Settings) -> EmbeddingResult:
    client = boto3.client("bedrock-runtime", region_name=settings.region, config=CLIENT_CONFIG)
    vectors: list[list[float]] = []
    input_tokens = 0
    for text in request.texts:
        response = client.invoke_model(modelId=settings.embedding_model_id, contentType="application/json",
                                       accept="application/json", body=json.dumps({"inputText": text,
                                                                                  "dimensions": 1024, "normalize": True}))
        body = response["body"]
        try:
            payload = json.loads(body.read())
            vector = payload["embedding"]
            token_count = payload.get("inputTextTokenCount")
            if type(token_count) is not int or token_count < 0:
                raise ValueError("Titan usage unavailable")
            input_tokens += token_count
        finally:
            body.close()
        if not isinstance(vector, list) or len(vector) != 1024 or not all(type(value) in {int, float} and math.isfinite(value) for value in vector):
            raise ValueError("invalid Titan embedding")
        vectors.append(vector)
    return EmbeddingResult(vectors=vectors, modelId=settings.embedding_model_id, inputTokens=input_tokens)
