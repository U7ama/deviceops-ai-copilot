import asyncio
from dataclasses import replace
from fastapi.testclient import TestClient
import pytest
from main import create_app
from models import Action, InvestigationResult
from runtime import InvocationFailure, run_isolated, runner_environment

REQUEST = {"invocationId": "inv-1", "incidentId": "incident-1", "grantToken": "g" * 40}
DIAGNOSIS = {"summary": "Upstream failure", "cause": "Likely switch fault", "evidenceIds": ["obs-1"],
             "alternatives": [], "uncertainty": "No hardware verified", "action": None,
             "provider": "strands-bedrock", "modelId": "us.amazon.nova-lite-v1:0",
             "usage": {"inputTokens": 50, "outputTokens": 20, "modelCalls": 2}, "toolCalls": 1}


def test_private_routes_and_health(settings):
    calls = []
    async def runner(op, payload, config):
        calls.append(op)
        return DIAGNOSIS
    with TestClient(create_app(settings, runner)) as client:
        assert client.get('/healthz').json()['modelReady'] == 'unverified'
        for endpoint, body in [("/investigate", REQUEST), ("/embed", {"texts": ["runbook"]})]:
            assert client.post(endpoint, json=body).status_code == 401
            assert client.post(endpoint, json=body, headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert calls == []
        result = client.post('/investigate', json=REQUEST, headers={"Authorization": "Bearer " + settings.service_token})
        assert result.status_code == 200
        assert result.json() == DIAGNOSIS


@pytest.mark.parametrize('change', [{"tenantId": "foreign"}, {"incidentId": "x\nsecret"}, {"grantToken": "short"}])
def test_validation_does_not_echo_secrets(settings, change):
    with TestClient(create_app(settings)) as client:
        result = client.post('/investigate', json={**REQUEST, **change}, headers={"Authorization": "Bearer " + settings.service_token})
        assert result.status_code == 422
        assert result.json() == {"detail": "invalid_request"}


@pytest.mark.parametrize('failure,status', [(InvocationFailure("budget_exhausted", 429), 429),
                                          (InvocationFailure("invocation_timeout", 504), 504),
                                          (RuntimeError("SECRET credentials"), 502)])
def test_failure_has_no_mock_fallback(settings, failure, status):
    calls = []
    async def runner(*args):
        calls.append(1)
        raise failure
    with TestClient(create_app(settings, runner)) as client:
        response = client.post('/investigate', json=REQUEST, headers={"Authorization": "Bearer " + settings.service_token})
        assert response.status_code == status
        assert "SECRET" not in response.text
        assert "fixture" not in response.text
        assert calls == [1]


def test_result_contract_rejects_authority_and_arbitrary_commands():
    with pytest.raises(ValueError):
        InvestigationResult.model_validate({**DIAGNOSIS, "approved": True})
    with pytest.raises(ValueError):
        Action(name='restart_service', targetDeviceId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', arguments={"command": "reboot"})
    with pytest.raises(ValueError):
        InvestigationResult.model_validate({**DIAGNOSIS, "summary": "a" * 1201})


def test_embed_is_authenticated_and_dimension_checked(settings):
    async def good_runner(*args):
        return {"vectors": [[0.1] * 1024], "modelId": settings.embedding_model_id, "inputTokens": 3}
    async def bad_runner(*args):
        return {"vectors": [[0.1]], "modelId": settings.embedding_model_id, "inputTokens": 3}
    for runner, status in [(good_runner, 200), (bad_runner, 502)]:
        with TestClient(create_app(settings, runner)) as client:
            response = client.post('/embed', json={"texts": ["test"]}, headers={"Authorization": "Bearer " + settings.service_token})
            assert response.status_code == status


def test_runtime_removes_db_and_preload_environment(settings, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "do-not-inherit")
    monkeypatch.setenv("NODE_OPTIONS", "--require /malicious")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "only-python")
    env = runner_environment(settings)
    assert "DATABASE_URL" not in env and "NODE_OPTIONS" not in env
    assert env["AWS_SESSION_TOKEN"] == "only-python"
    mcp_env = settings.mcp_environment("scoped-grant")
    assert "AWS_SESSION_TOKEN" not in mcp_env and "DATABASE_URL" not in mcp_env
    assert mcp_env["HOME"] == "/nonexistent"


def test_timeout_terminates_process(settings, monkeypatch):
    import runtime
    kills = []
    class Process:
        pid = 123456
        returncode = None
        async def communicate(self, _input):
            await asyncio.sleep(10)
        async def wait(self):
            self.returncode = -15
            return self.returncode
    async def start(*args, **kwargs):
        assert kwargs['start_new_session'] is True
        return Process()
    monkeypatch.setattr(runtime.asyncio, 'create_subprocess_exec', start)
    monkeypatch.setattr(runtime.os, 'killpg', lambda pid, sig: kills.append((pid, sig)))
    with pytest.raises(InvocationFailure) as error:
        asyncio.run(run_isolated('investigate', REQUEST, replace(settings, timeout_seconds=0.01)))
    assert error.value.status_code == 504 and kills


def test_concurrent_paid_operation_is_rejected(settings):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    entered = threading.Event()
    release = threading.Event()
    async def runner(*args):
        entered.set()
        while not release.is_set():
            await asyncio.sleep(0.01)
        return DIAGNOSIS
    with TestClient(create_app(settings, runner)) as client, ThreadPoolExecutor(max_workers=1) as pool:
        headers = {"Authorization": "Bearer " + settings.service_token}
        first = pool.submit(client.post, '/investigate', json=REQUEST, headers=headers)
        assert entered.wait(2)
        try:
            second = client.post('/investigate', json=REQUEST, headers=headers)
            assert second.status_code == 429 and second.json()['detail'] == 'service_busy'
        finally:
            release.set()
        assert first.result(timeout=2).status_code == 200


def test_paid_routes_require_credit_confirmation(settings):
    async def runner(*args):
        pytest.fail('Paid work must not start before credit confirmation')
    with TestClient(create_app(replace(settings, credits_confirmed=False), runner)) as client:
        for path, body in [('/investigate', REQUEST), ('/embed', {'texts':['runbook']})]:
            response = client.post(path, json=body, headers={'Authorization': 'Bearer ' + settings.service_token})
            assert response.status_code == 503
            assert response.json()['detail'] == 'credits_confirmation_required'


def test_investigation_can_embed_its_search_query(settings):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    entered, embedded = threading.Event(), threading.Event()
    async def runner(operation, *_args):
        if operation == 'embed':
            embedded.set()
            return {'vectors': [[0.1] * 1024], 'modelId': settings.embedding_model_id, 'inputTokens': 3}
        entered.set()
        for _ in range(200):
            if embedded.is_set():
                return DIAGNOSIS
            await asyncio.sleep(0.01)
        raise RuntimeError('Nested search was blocked')
    with TestClient(create_app(settings, runner)) as client, ThreadPoolExecutor(max_workers=1) as pool:
        headers = {'Authorization': 'Bearer ' + settings.service_token}
        first = pool.submit(client.post, '/investigate', json=REQUEST, headers=headers)
        assert entered.wait(2)
        assert client.post('/embed', json={'texts': ['query']}, headers=headers).status_code == 200
        assert first.result(timeout=3).status_code == 200
