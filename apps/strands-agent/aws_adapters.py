"""Optional AWS adapters. No resource creation and no automatic fallback."""
import base64, json, os, uuid
import boto3
from botocore.config import Config
CONFIG=Config(connect_timeout=5,read_timeout=190,retries={'total_max_attempts':1})

def runtime_investigate(payload, region):
    arn=os.environ.get('AGENTCORE_RUNTIME_ARN','')
    if not arn or os.environ.get('AWS_CREDITS_CONFIRMED')!='true': raise ValueError('agentcore_runtime_unavailable')
    response=boto3.client('bedrock-agentcore',region_name=region,config=CONFIG).invoke_agent_runtime(
        agentRuntimeArn=arn,runtimeSessionId=str(uuid.uuid4()),contentType='application/json',accept='application/json',payload=json.dumps(payload).encode())
    stream=response['response']
    try:
        raw=stream.read(512*1024+1)
        if len(raw)>512*1024:raise ValueError('runtime_output_limit')
        return json.loads(raw)
    finally:stream.close()

def code_interpreter(request, region):
    identifier=os.environ.get('AGENTCORE_CODE_INTERPRETER_ID','')
    if not identifier or os.environ.get('AWS_CREDITS_CONFIRMED')!='true':raise ValueError('code_interpreter_unavailable')
    control=boto3.client('bedrock-agentcore-control',region_name=region,config=CONFIG)
    config=control.get_code_interpreter(codeInterpreterId=identifier)
    if config.get('networkConfiguration',{}).get('networkMode')!='SANDBOX' or config.get('filesystemConfigurations'):
        raise ValueError('interpreter_isolation_not_verified')
    # A custom interpreter role must have no identity policies granting data access.
    role=config.get('executionRoleArn','').split('/')[-1]
    if not role:raise ValueError('interpreter_role_not_verified')
    iam=boto3.client('iam',config=CONFIG)
    attached=iam.list_attached_role_policies(RoleName=role)
    inline=iam.list_role_policies(RoleName=role)
    if attached.get('AttachedPolicies') or inline.get('PolicyNames') or attached.get('IsTruncated') or inline.get('IsTruncated'):
        raise ValueError('interpreter_role_has_permissions')
    if request.get('operation')!='analyze' or len(request.get('script',''))>20000:raise ValueError('unsupported_interpreter_operation')
    files=request['files'];total=0
    for f in files:
        if '/' in f['name'] or '\\' in f['name'] or f['name'] in {'.','..'}:raise ValueError('invalid_artifact_name')
        total+=len(base64.b64decode(f['data'],validate=True))
    if total>20*1024*1024:raise ValueError('input_limit')
    client=boto3.client('bedrock-agentcore',region_name=region,config=Config(connect_timeout=5,read_timeout=30,retries={'total_max_attempts':1}))
    session=client.start_code_interpreter_session(codeInterpreterIdentifier=identifier,name='deviceops-'+str(uuid.uuid4()),sessionTimeoutSeconds=60)
    common={'codeInterpreterIdentifier':identifier,'sessionId':session['sessionId']}
    def invoke(name,args):
        output=[];size=0
        response=client.invoke_code_interpreter(**common,name=name,arguments=args)
        for chunk in response['stream']:
            size+=len(json.dumps(chunk,default=str))
            if size>1024*1024:raise ValueError('interpreter_output_limit')
            
            if any('exception' in key.lower() for key in chunk) or chunk.get('result',{}).get('isError'):raise ValueError('interpreter_execution_failed')
            output.append(chunk)
        return output
    try:
        # Transfer through the broker; generated code receives no S3 locations or service secrets.
        invoke('writeFiles',{'content':[{'path':f['name'],'blob':base64.b64decode(f['data'])} for f in files]})
        output=invoke('executeCode',{'language':'python','code':request['script'],'clearContext':True})
        return {'exitCode':0,'stdout':json.dumps(output,default=str),'artifacts':[],
                'limits':{'sessionSeconds':60,'requestSeconds':30,'networkMode':'SANDBOX','memory':'service-managed'},'verification':'aws-response-requires-review'}
    finally:client.stop_code_interpreter_session(**common)
