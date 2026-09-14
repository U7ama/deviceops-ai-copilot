import asyncio
from dataclasses import replace
import json
import pytest
from fastapi.testclient import TestClient
from strands.models.openai import OpenAIModel
import agent as implementation
from budget import Budget, BudgetExceeded
from config import Settings
from main import create_app
from models import InvestigationRequest
from runtime import runner_environment
from test_agent import DIAGNOSIS, FixtureClient
from test_api import REQUEST, DIAGNOSIS as RESULT


def qwen(settings):
    return replace(settings, provider='qwen', model_id='qwen3.7-flash',
                   qwen_api_key='local-test-key', qwen_confirmed=True, credits_confirmed=False)


def test_real_strands_qwen_loop_and_caps(settings, monkeypatch):
    seen = []
    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        seen.append(self.config['params']['max_tokens'])
        first = self.budget.model_calls == 1
        name, content = ('get_incident_context', {}) if first else ('Investigation', DIAGNOSIS)
        yield {'messageStart': {'role': 'assistant'}}
        yield {'contentBlockStart': {'start': {'toolUse': {'toolUseId': str(len(seen)), 'name': name}}, 'contentBlockIndex': 0}}
        yield {'contentBlockDelta': {'delta': {'toolUse': {'input': json.dumps(content)}}, 'contentBlockIndex': 0}}
        yield {'contentBlockStop': {'contentBlockIndex': 0}}
        yield {'messageStop': {'stopReason': 'tool_use'}}
        yield {'metadata': {'usage': {'inputTokens': 100, 'outputTokens': 30, 'totalTokens': 130}, 'metrics': {'latencyMs': 1}}}
    monkeypatch.setattr(OpenAIModel, 'stream', stream)
    monkeypatch.setattr(implementation, 'MCPClient', FixtureClient)
    config = replace(qwen(settings), max_output_tokens=80)
    result = implementation.investigate(InvestigationRequest(**REQUEST), config)
    assert result.provider == 'strands-qwen' and result.toolCalls == 1
    assert result.usage.modelCalls == 2
    assert seen == [80, 50]
    assert result.usage.outputTokens == 60


def test_qwen_client_is_bounded(settings):
    model = implementation.create_model(qwen(settings), Budget(settings))
    assert model.client_args['max_retries'] == 0
    assert model.config['params']['extra_body'] == {'enable_thinking': False}
    assert model.config['params']['max_tokens'] == 2000


def test_qwen_missing_usage_does_not_fallback(settings, monkeypatch):
    async def stream(*args, **kwargs):
        yield {'messageStart': {'role': 'assistant'}}
    monkeypatch.setattr(OpenAIModel, 'stream', stream)
    model = implementation.create_model(qwen(settings), Budget(settings))
    async def run():
        return [event async for event in model.stream([])]
    with pytest.raises(BudgetExceeded, match='usage unavailable'):
        asyncio.run(run())


def test_qwen_gate_independent_of_aws_and_embed_disabled(settings):
    calls = []
    async def runner(op, *_):
        calls.append(op)
        return {**RESULT, 'provider': 'strands-qwen', 'modelId': 'qwen3.7-flash'}
    config = qwen(settings)
    with TestClient(create_app(config, runner)) as client:
        headers = {'Authorization':'Bearer '+config.service_token}
        assert client.get('/healthz').json()['provider'] == 'strands-qwen'
        assert client.post('/investigate', json=REQUEST, headers=headers).status_code == 200
        assert client.post('/embed', json={'texts':['test']}, headers=headers).status_code == 503
    assert calls == ['investigate']
    for blocked in [replace(config, qwen_confirmed=False), replace(config, qwen_api_key='')]:
        with TestClient(create_app(blocked, runner)) as client:
            assert client.post('/investigate', json=REQUEST, headers=headers).status_code == 503
    assert calls == ['investigate']


def test_mismatched_provider_rejected(settings):
    async def runner(*_):
        return RESULT
    config = qwen(settings)
    with TestClient(create_app(config, runner)) as client:
        response = client.post('/investigate', json=REQUEST, headers={'Authorization':'Bearer '+config.service_token})
        assert response.status_code == 502


def test_qwen_secret_only_reaches_reasoning_process(settings, monkeypatch):
    config = qwen(settings)
    monkeypatch.setenv('AWS_SECRET_ACCESS_KEY','aws-secret')
    env = runner_environment(config)
    assert env['ABQWEN_API_KEY'] == 'local-test-key'
    assert 'AWS_SECRET_ACCESS_KEY' not in env
    assert 'ABQWEN_API_KEY' not in config.mcp_environment('grant')
    assert 'local-test-key' not in repr(config)


def test_config_rejects_unknown_provider_and_unbudgeted_model(monkeypatch):
    monkeypatch.setenv('STRANDS_SERVICE_TOKEN','s'*40)
    monkeypatch.setenv('STRANDS_MODEL_PROVIDER','typo')
    with pytest.raises(ValueError, match='STRANDS_MODEL_PROVIDER'):
        Settings.from_env()
    monkeypatch.setenv('STRANDS_MODEL_PROVIDER','qwen')
    monkeypatch.setenv('QWEN_MODEL_ID','unbudgeted-model')
    with pytest.raises(ValueError, match='budget configuration'):
        Settings.from_env()



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

def test_budget_retains_specific_limit(settings):
    budget = Budget(replace(settings, max_input_tokens=10))
    with pytest.raises(BudgetExceeded, match='reserved_input'):
        budget.before_model(11)
    assert '11 > 10' in budget.exhausted_reason
    assert budget.model_calls == 0

def test_failed_model_call_keeps_reservation_and_does_not_rotate(settings, monkeypatch):
    async def failed_stream(*args, **kwargs):
        raise RuntimeError('quota exhausted')
        yield
    monkeypatch.setattr(OpenAIModel, 'stream', failed_stream)
    config = qwen(settings)
    budget = Budget(config)
    model = implementation.create_model(config, budget)
    async def run():
        return [event async for event in model.stream([])]
    with pytest.raises(RuntimeError, match='quota exhausted'):
        asyncio.run(run())
    assert budget.model_calls == 1
    assert budget.reserved_input > 0 and budget.reserved_output > 0
    assert model.config['model_id'] == config.model_id


def test_invalid_routing_is_not_replaced_with_network():
    from specialists import Routing
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Routing.model_validate({'specialists': ['invented-role']})
