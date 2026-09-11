import json
from dataclasses import replace
from strands.models import BedrockModel
import pytest
from agent import create_model
from specialists import run_specialists
from models import InvestigationRequest
from budget import Budget, BudgetExceeded

ROOT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
class Client:
    def call_tool_sync(self, identifier, name, args):
        data={'observations':[{'id':'obs-1','health':'error'}]}
        if name=='get_incident_context': data={'incident':{'rootDeviceId':ROOT,'summary':'Telemetry service error'},'memory':{'results':[]}}
        if name=='get_action_capabilities': data={'deviceId':ROOT,'actions':[{'name':'restart_service','arguments':{}}]}
        return {'status':'success','content':[{'text':json.dumps(data)}]}

@pytest.mark.parametrize('block',[False,True])
def test_real_strands_supervisor_specialist_critic_loop(settings,monkeypatch,block):
    settings=replace(settings,max_model_calls=12,max_tool_calls=24,max_output_tokens=12000)
    budget=Budget(settings)
    def init(self,**kwargs):self.config={'model_id':kwargs['model_id'],'max_tokens':kwargs['max_tokens']}
    async def stream(self,messages,tool_specs=None,system_prompt=None,**kwargs):
        name=tool_specs[0]['name']
        finding={'specialist':'system','status':'complete','hypothesis':'Hung service','evidenceIds':['obs-1'],'conflicts':[],'gaps':[],'uncertainty':'Synthetic test'}
        answers={'Routing':{'specialists':['system']},'SpecialistFinding':finding,
                 'Critic':{'requiresEscalation':block,'finding':{**finding,'specialist':'critic'}},
                 'Investigation':{'summary':'Service hung','cause':'Application health error','evidenceIds':['obs-1'],'alternatives':[],
                    'uncertainty':'Synthetic test','action':{'name':'restart_service','targetDeviceId':ROOT,'arguments':{}}}}
        yield {'messageStart':{'role':'assistant'}}
        yield {'contentBlockStart':{'start':{'toolUse':{'toolUseId':'call-'+str(budget.model_calls),'name':name}},'contentBlockIndex':0}}
        yield {'contentBlockDelta':{'delta':{'toolUse':{'input':json.dumps(answers[name])}},'contentBlockIndex':0}}
        yield {'contentBlockStop':{'contentBlockIndex':0}}
        yield {'messageStop':{'stopReason':'tool_use'}}
        yield {'metadata':{'usage':{'inputTokens':100,'outputTokens':50,'totalTokens':150},'metrics':{'latencyMs':1}}}
    monkeypatch.setattr(BedrockModel,'__init__',init);monkeypatch.setattr(BedrockModel,'stream',stream)
    result=run_specialists(InvestigationRequest(invocationId='inv-1',incidentId='incident-1',grantToken='g'*40,workflow='specialists'),settings,budget,Client(),create_model)
    assert result.usage.modelCalls==4 and result.toolCalls==7
    assert [f.specialist for f in result.enterprise.findings]==['system','critic']
    assert (result.action is None)==block
    assert result.enterprise.criticRequiresEscalation==block

def test_cancellation_checked_before_model_reservation(settings):
    budget=Budget(settings)
    def cancelled():raise BudgetExceeded('cancelled')
    budget.check_active=cancelled
    with pytest.raises(BudgetExceeded):budget.before_model(10)
    assert budget.model_calls==0


def test_selected_page_images_have_exact_citations_and_no_duplicate_bytes():
    from specialists import visual_inputs
    artifacts=[{'id':'manual','preview':'old','pagePreviews':[{'page':30,'preview':'eA=='},{'page':4,'preview':'eQ=='}]}, {'id':'photo','preview':'eg=='}]
    cleaned,images,refs=visual_inputs(artifacts)
    assert images==['eA==','eQ==']
    assert refs[0]['citation']=='manual:page:30'
    assert all('preview' not in a and 'pagePreviews' not in a for a in cleaned)
    assert artifacts[0]['preview']=='old'
