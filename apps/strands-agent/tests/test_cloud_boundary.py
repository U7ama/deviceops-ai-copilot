import asyncio
import httpx
import pytest
import agentcore_app as cloud

@pytest.mark.parametrize('payload,expected', [({'grantToken':'private-secret'},422), ({'invocationId':'i','incidentId':'i','grantToken':'x'*20},502)])
def test_errors_are_sanitized(payload, expected, settings, monkeypatch):
    monkeypatch.setattr(cloud.Settings,'from_env',lambda:settings)
    def fail(*args, **kwargs): raise RuntimeError('private-secret')
    monkeypatch.setattr(cloud,'investigate',fail)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=cloud.app),base_url='http://test') as c:
            return await c.post('/invocations',json=payload)
    result=asyncio.run(run())
    assert result.status_code==expected
    assert 'private-secret' not in result.text


def test_sdk_cleanup_bounded_join(monkeypatch):
    import bounded_mcp
    join_calls = []
    class MockThread:
        def is_alive(self): return True
        def join(self, timeout=None): join_calls.append(timeout)
    client = object.__new__(bounded_mcp.BoundedMCPClient)
    client._background_thread = MockThread()
    client._background_thread_event_loop = None
    client._background_thread_session = None
    client.stop()
    assert join_calls == [2.0]
    assert client._background_thread is None


def test_completed_envelope_reaps_lingering_runner(settings, monkeypatch):
    import runtime
    kills=[]
    class Process:
        pid=123456; returncode=None
        @property
        def stdin(self): return self
        @property
        def stdout(self): return self
        def write(self, value): pass
        async def drain(self): pass
        def close(self): pass
        async def readline(self): return b'{"summary":"completed"}\n'
        async def wait(self): self.returncode=-15; return self.returncode
    async def start(*args, **kwargs): return Process()
    monkeypatch.setattr(runtime.asyncio,'create_subprocess_exec',start)
    monkeypatch.setattr(runtime.os,'killpg',lambda pid,sig:kills.append((pid,sig)))
    assert asyncio.run(runtime.run_isolated('investigate',{},settings)) == {'summary':'completed'}
    assert kills and kills[0][0] == 123456
