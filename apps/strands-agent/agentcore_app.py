"""AgentCore HTTP entrypoint. Expose only behind AgentCore IAM authorization, never as a public standalone server."""
from fastapi import FastAPI, HTTPException
from config import Settings
from models import InvestigationRequest, InvestigationResult
from runtime import run_isolated, InvocationFailure
app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
@app.get('/ping')
async def ping():return {'status':'Healthy'}
@app.post('/invocations',response_model=InvestigationResult)
async def invoke(request:InvestigationRequest):
    settings=Settings.from_env();settings.require_operation('investigate')
    try:return await run_isolated('investigate',request.model_dump(),settings)
    except InvocationFailure as e:raise HTTPException(e.status_code,e.code) from None
