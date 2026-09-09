import asyncio
from dataclasses import replace
import json
import pytest
from fastapi.testclient import TestClient
from google.genai import types
from strands.models.gemini import GeminiModel
import agent as implementation
from budget import Budget, BudgetExceeded
from config import Settings
from main import create_app
from models import InvestigationRequest
from runtime import runner_environment
from test_agent import DIAGNOSIS, FixtureClient
from test_api import REQUEST, DIAGNOSIS as RESULT


def gemini(settings):
    return replace(settings, provider='gemini', model_id='gemini-2.5-flash',
                   gemini_api_key='local-test-key', gemini_confirmed=True, credits_confirmed=False)


def test_real_strands_gemini_loop_and_caps(settings, monkeypatch):
    seen = []
    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        seen.append(self.config['params']['max_output_tokens'])
        first = self.budget.model_calls == 1
        name, content = ('get_incident_context', {}) if first else ('Investigation', DIAGNOSIS)
        yield {'messageStart': {'role': 'assistant'}}
        yield {'contentBlockStart': {'start': {'toolUse': {'toolUseId': str(len(seen)), 'name': name}}, 'contentBlockIndex': 0}}
        yield {'contentBlockDelta': {'delta': {'toolUse': {'input': json.dumps(content)}}, 'contentBlockIndex': 0}}
        yield {'contentBlockStop': {'contentBlockIndex': 0}}
        yield {'messageStop': {'stopReason': 'tool_use'}}
        yield {'metadata': {'usage': {'inputTokens': 100, 'outputTokens': 30, 'totalTokens': 130}, 'metrics': {'latencyMs': 1}}}
    monkeypatch.setattr(GeminiModel, 'stream', stream)
    monkeypatch.setattr(implementation, 'MCPClient', FixtureClient)
    config = replace(gemini(settings), max_output_tokens=80)
    result = implementation.investigate(InvestigationRequest(**REQUEST), config)
    assert result.provider == 'strands-gemini' and result.toolCalls == 1
    assert result.usage.modelCalls == 2
    assert seen == [80, 50]
    assert result.usage.outputTokens == 60


def test_google_usage_includes_thinking_tokens(settings):
    model = implementation.create_model(gemini(settings), Budget(settings))
    event = model._format_chunk({'chunk_type': 'metadata', 'data': types.GenerateContentResponseUsageMetadata(
        prompt_token_count=20, candidates_token_count=5, thoughts_token_count=7, total_token_count=32)})
    assert event['metadata']['usage']['outputTokens'] == 12
    assert model.client_args['http_options']['retry_options']['attempts'] == 1
    assert model.config['params']['thinking_config']['thinking_budget'] == 0


def test_gemini_missing_usage_does_not_fallback(settings, monkeypatch):
    async def stream(*args, **kwargs):
        yield {'messageStart': {'role': 'assistant'}}
    monkeypatch.setattr(GeminiModel, 'stream', stream)
    model = implementation.create_model(gemini(settings), Budget(settings))
    async def run():
        return [event async for event in model.stream([])]
    with pytest.raises(BudgetExceeded, match='usage unavailable'):
        asyncio.run(run())


def test_gemini_gate_independent_of_aws_and_embed_disabled(settings):
    calls = []
    async def runner(op, *_):
        calls.append(op)
        return {**RESULT, 'provider': 'strands-gemini', 'modelId': 'gemini-2.5-flash'}
    config = gemini(settings)
    with TestClient(create_app(config, runner)) as client:
        headers = {'Authorization':'Bearer '+config.service_token}
        assert client.get('/healthz').json()['provider'] == 'strands-gemini'
        assert client.post('/investigate', json=REQUEST, headers=headers).status_code == 200
        assert client.post('/embed', json={'texts':['test']}, headers=headers).status_code == 503
    assert calls == ['investigate']
    for blocked in [replace(config, gemini_confirmed=False), replace(config, gemini_api_key='')]:
        with TestClient(create_app(blocked, runner)) as client:
            assert client.post('/investigate', json=REQUEST, headers=headers).status_code == 503
    assert calls == ['investigate']


def test_mismatched_provider_rejected(settings):
    async def runner(*_):
        return RESULT
    config = gemini(settings)
    with TestClient(create_app(config, runner)) as client:
        response = client.post('/investigate', json=REQUEST, headers={'Authorization':'Bearer '+config.service_token})
        assert response.status_code == 502


def test_gemini_secret_only_reaches_reasoning_process(settings, monkeypatch):
    config = gemini(settings)
    monkeypatch.setenv('AWS_SECRET_ACCESS_KEY','aws-secret')
    env = runner_environment(config)
    assert env['GEMINI_API_KEY'] == 'local-test-key'
    assert 'AWS_SECRET_ACCESS_KEY' not in env
    assert 'GEMINI_API_KEY' not in config.mcp_environment('grant')
    assert 'local-test-key' not in repr(config)


def test_config_rejects_unknown_provider_and_unbudgeted_model(monkeypatch):
    monkeypatch.setenv('STRANDS_SERVICE_TOKEN','s'*40)
    monkeypatch.setenv('STRANDS_MODEL_PROVIDER','typo')
    with pytest.raises(ValueError, match='STRANDS_MODEL_PROVIDER'):
        Settings.from_env()
    monkeypatch.setenv('STRANDS_MODEL_PROVIDER','gemini')
    monkeypatch.setenv('GEMINI_MODEL_ID','unbudgeted-model')
    with pytest.raises(ValueError, match='budget configuration'):
        Settings.from_env()


def test_37_uses_thinking_level_and_preserves_usage_ceiling(settings):
    config=replace(gemini(settings),model_id='gemini-3.7-flash')
    config.require_operation('investigate')
    model=implementation.create_model(config,Budget(config))
    assert model.config['params']['thinking_config']=={'thinking_level':'low'}
    assert model.config['params']['max_output_tokens']==2000
    assert 'thinking_budget' not in model.config['params']['thinking_config']


@pytest.mark.parametrize('wrapped', [False, True])
@pytest.mark.parametrize('code,expected', [(429,'provider_rate_limited'),(404,'provider_model_unavailable'),(403,'provider_access_denied'),(400,'provider_invalid_request')])
def test_runner_redacts_provider_errors(settings, monkeypatch, capsys, code, expected, wrapped):
    import io
    import runner
    class ProviderFailure(Exception):
        pass
    failure=ProviderFailure('private-key-and-payload-must-not-escape')
    failure.code=code
    monkeypatch.setattr(runner.Settings,'from_env',lambda:settings)
    monkeypatch.setattr(runner.signal,'signal',lambda *_:None)
    monkeypatch.setattr(runner.sys,'argv',['runner.py','investigate'])
    class Input:
        buffer=io.BytesIO(json.dumps(REQUEST).encode())
    monkeypatch.setattr(runner.sys,'stdin',Input())
    def fail(*_):
        if wrapped:
            from strands.types.exceptions import EventLoopException
            raise EventLoopException(failure) from failure
        raise failure
    monkeypatch.setattr(implementation,'investigate',fail)
    assert runner.main()==1
    captured = capsys.readouterr().out
    output = json.loads(captured)
    assert output['error'] == expected
    assert output['diagnostic']['status'] == code
    assert 'private-key-and-payload-must-not-escape' not in captured
