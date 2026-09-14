"""IAM-protected AgentCore endpoint with clean Option B investigation execution."""
import asyncio
import logging
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from config import Settings
from models import InvestigationRequest, InvestigationResult
from budget import BudgetExceeded
from agent import investigate

logger = logging.getLogger(__name__)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_busy = asyncio.Lock()

@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _error):
    return JSONResponse(status_code=422, content={'detail': 'invalid_request'})

@app.get('/ping')
async def ping():
    return {'status': 'Healthy'}

@app.post('/invocations', response_model=InvestigationResult)
async def invoke(request: InvestigationRequest):
    if _busy.locked():
        raise HTTPException(429, 'service_busy')
    async with _busy:
        try:
            settings = Settings.from_env()
            settings.require_operation('investigate')
        except Exception:
            raise HTTPException(503, 'configuration_error') from None
        try:
            # Option B: Run in thread to eliminate child-process startup latency and pipe stalls
            return await asyncio.to_thread(investigate, request, settings)
        except BudgetExceeded:
            raise HTTPException(429, 'budget_exhausted') from None
        except HTTPException:
            raise
        except Exception as error:
            # Never return provider text, tracebacks, or grant-bearing validation input
            from strands.types.exceptions import ModelThrottledException
            code = getattr(error, 'status_code', None) or getattr(error, 'code', None)
            if isinstance(error, ModelThrottledException) or code == 429:
                raise HTTPException(429, 'provider_rate_limited') from None
            elif code == 404:
                raise HTTPException(503, 'provider_model_unavailable') from None
            elif code in {401, 403}:
                raise HTTPException(503, 'provider_access_denied') from None
            elif code == 400:
                raise HTTPException(502, 'provider_invalid_request') from None
            elif type(error).__name__ == 'ValidationError':
                raise HTTPException(502, 'invalid_provider_result') from None
            else:
                logger.error('invocation_failed: %s', type(error).__name__)
                raise HTTPException(502, 'provider_unavailable') from None

