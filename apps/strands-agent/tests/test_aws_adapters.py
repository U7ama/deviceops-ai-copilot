from io import BytesIO
import pytest
import aws_adapters

def test_runtime_transport_uses_unique_session_and_preserves_payload(monkeypatch):
    calls=[]
    class Client:
        def invoke_agent_runtime(self,**kwargs): calls.append(kwargs);return {'response':BytesIO(b'{"summary":"test"}')}
    monkeypatch.setenv('AGENTCORE_RUNTIME_ARN','arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test')
    monkeypatch.setenv('AWS_CREDITS_CONFIRMED','true')
    monkeypatch.setattr(aws_adapters.boto3,'client',lambda *a,**k:Client())
    assert aws_adapters.runtime_investigate({'incidentId':'incident-1'},'us-east-1')['summary']=='test'
    assert len(calls[0]['runtimeSessionId'])>=33
    assert b'incident-1' in calls[0]['payload']

def test_code_interpreter_refuses_unverified_network(monkeypatch):
    class Client:
        def get_code_interpreter(self,**kwargs):return {'networkConfiguration':{'networkMode':'PUBLIC'}}
    monkeypatch.setenv('AGENTCORE_CODE_INTERPRETER_ID','custom-test')
    monkeypatch.setenv('AWS_CREDITS_CONFIRMED','true')
    monkeypatch.setattr(aws_adapters.boto3,'client',lambda *a,**k:Client())
    with pytest.raises(ValueError,match='isolation'):aws_adapters.code_interpreter({'operation':'analyze'},'us-east-1')
