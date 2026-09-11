"""Exercise the installed Strands agent loop with deterministic provider streams, without AWS."""
import asyncio
from dataclasses import replace
from io import BytesIO
import json
from pathlib import Path
import sys
import pytest
from strands import tool
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from mcp import StdioServerParameters
from mcp.client.stdio import stdio_client
import agent as implementation
from budget import Budget, BudgetExceeded
from models import EmbeddingRequest, InvestigationRequest

DIAGNOSIS = {"summary": "Likely upstream switch failure", "cause": "Unreachable switch with dependent devices",
             "evidenceIds": ["obs-1"], "alternatives": [], "uncertainty": "Simulated evidence", "action": None}


@tool
def get_incident_context() -> dict:
    """Get incident evidence."""
    return {"incident": {"id": "incident-1"}, "observations": [{"id": "obs-1", "health": "error"}]}


@tool
def get_device_health(deviceId: str = "") -> dict:
    """Get device health."""
    return {"observations": [{"id": "obs-1", "health": "error"}]}


@tool
def get_action_capabilities(deviceId: str = "") -> dict:
    """Get device capabilities."""
    return {"actions": []}


@tool
def get_topology() -> dict:
    """Get incident topology."""
    return {"edges": []}


@tool
def query_telemetry_logs() -> dict:
    """Get incident telemetry."""
    return {"observations": [{"id": "obs-1"}]}


@tool
def search_manual(query: str = "") -> dict:
    """Search approved runbooks."""
    return {"runbooks": []}


@tool
def correlate_changes() -> dict:
    """Get recent changes."""
    return {"changes": []}


TOOLS = [get_incident_context, get_device_health, get_action_capabilities, get_topology,
         query_telemetry_logs, search_manual, correlate_changes]


class FixtureClient:
    closed = False
    def __init__(self, *args, **kwargs):
        pass
    def __enter__(self):
        return self
    def __exit__(self, *args):
        type(self).closed = True
    def list_tools_sync(self):
        return TOOLS


def configure_provider(monkeypatch, answer=DIAGNOSIS):
    def init(self, **kwargs):
        self.config = {"model_id": kwargs["model_id"], "max_tokens": kwargs["max_tokens"]}
    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        first = self.budget.model_calls == 1
        name, content = ("get_incident_context", {}) if first else ("Investigation", answer)
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockStart": {"start": {"toolUse": {"toolUseId": f"call-{self.budget.model_calls}", "name": name}}, "contentBlockIndex": 0}}
        yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(content)}}, "contentBlockIndex": 0}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "tool_use"}}
        yield {"metadata": {"usage": {"inputTokens": 100, "outputTokens": 50, "totalTokens": 150}, "metrics": {"latencyMs": 1}}}
    monkeypatch.setattr(BedrockModel, '__init__', init)
    monkeypatch.setattr(BedrockModel, 'stream', stream)
    monkeypatch.setattr(implementation, 'MCPClient', FixtureClient)


def test_installed_strands_loop_calls_tool_then_structured_output(settings, monkeypatch):
    configure_provider(monkeypatch)
    result = implementation.investigate(InvestigationRequest(invocationId='inv-1', incidentId='incident-1', grantToken='g' * 40), settings)
    assert result.provider == 'strands-bedrock'
    assert result.evidenceIds == ['obs-1']
    assert result.usage.modelCalls == 2
    assert result.usage.inputTokens == 200 and result.usage.outputTokens == 100
    assert result.toolCalls == 1
    assert FixtureClient.closed


def test_action_requires_capability_lookup_for_exact_target(settings, monkeypatch):
    answer = {**DIAGNOSIS, 'action': {'name': 'restart_service', 'targetDeviceId': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'arguments': {}}}
    configure_provider(monkeypatch, answer)
    with pytest.raises(ValueError, match='capability lookup'):
        implementation.investigate(InvestigationRequest(invocationId='inv-1', incidentId='incident-1', grantToken='g' * 40), settings)


def test_actual_loop_stops_at_model_call_budget(settings, monkeypatch):
    configure_provider(monkeypatch)
    with pytest.raises(BudgetExceeded):
        implementation.investigate(InvestigationRequest(invocationId='inv-1', incidentId='incident-1', grantToken='g' * 40), replace(settings, max_model_calls=1))


def test_missing_usage_fails_closed(settings, monkeypatch):
    configure_provider(monkeypatch)
    async def empty_stream(*args, **kwargs):
        yield {"messageStart": {"role": "assistant"}}
    monkeypatch.setattr(BedrockModel, 'stream', empty_stream)
    model = implementation.BoundedBedrockModel(Budget(settings), model_id=settings.model_id, max_tokens=2000)
    async def run():
        return [event async for event in model.stream([])]
    with pytest.raises(BudgetExceeded, match='usage unavailable'):
        asyncio.run(run())


def test_titan_request_dimensions_and_usage(settings, monkeypatch):
    calls = []
    class Client:
        def invoke_model(self, **kwargs):
            calls.append(kwargs)
            return {'body': BytesIO(json.dumps({'embedding': [0.1] * 1024, 'inputTextTokenCount': 5}).encode())}
    monkeypatch.setattr(implementation.boto3, 'client', lambda *args, **kwargs: Client())
    result = implementation.embed(EmbeddingRequest(texts=['first', 'second']), settings)
    assert result.inputTokens == 10 and len(result.vectors) == 2
    assert json.loads(calls[0]['body']) == {'inputText': 'first', 'dimensions': 1024, 'normalize': True}


def test_real_stdio_mcp_keeps_scoped_environment(settings):
    fixture = str(Path(__file__).with_name('fixtures') / 'mcp_server.py')
    guard = str(Path(__file__).resolve().parents[1] / "mcp_guard.py")
    params = StdioServerParameters(command=sys.executable, args=[guard, sys.executable, fixture], env=settings.mcp_environment('scoped-grant'))
    with MCPClient(lambda: stdio_client(params), startup_timeout=10) as client:
        names = [t.tool_name for t in client.list_tools_sync()]
        assert names == ['get_incident_context']
        result = client.call_tool_sync('test-1', 'get_incident_context', {})
        assert result['status'] == 'success'
        payload = json.loads(result['content'][0]['text'])
        assert payload == {'grantPresent': True, 'databasePresent': False, 'awsPresent': False}
