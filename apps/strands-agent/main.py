"""Private, authenticated Strands service. Run exactly one ASGI worker."""
from __future__ import annotations
import asyncio
import os
from contextlib import asynccontextmanager
import hmac
import logging
from typing import Annotated
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from config import Settings
from models import EmbeddingRequest, EmbeddingResult, InvestigationRequest, InvestigationResult
from runtime import InvocationFailure, run_isolated

logger = logging.getLogger("deviceops.strands")


def create_app(settings: Settings | None = None, runner=run_isolated) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings or Settings.from_env()
        yield

    app = FastAPI(title="DeviceOps Strands", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    # Search tools may request an embedding while an investigation awaits the tool.
    # Bound each operation separately to avoid rejecting that nested retrieval.
    busy = {"investigate": asyncio.Lock(), "embed": asyncio.Lock()}

    def authorize(authorization: Annotated[str | None, Header()] = None) -> None:
        configured = app.state.settings.service_token
        supplied = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else ""
        if not supplied or not hmac.compare_digest(supplied.encode(), configured.encode()):
            raise HTTPException(status_code=401, detail="unauthorized")

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, _error):
        # Default validation errors can echo grant tokens or runbook text back to logs/clients.
        return JSONResponse(status_code=422, content={"detail": "invalid_request"})

    @app.get("/healthz")
    async def health():
        return {"status": "ok", "provider": f"strands-{app.state.settings.provider}", "modelReady": "unverified", "busy": any(lock.locked() for lock in busy.values())}

    async def dispatch(operation: str, payload: dict):
        try:
            app.state.settings.require_operation(operation)
        except ValueError as error:
            raise HTTPException(status_code=503, detail=str(error)) from None
        lock = busy[operation]
        if lock.locked():
            raise HTTPException(status_code=429, detail="service_busy", headers={"Retry-After": "5"})
        async with lock:
            try:
                return await runner(operation, payload, app.state.settings)
            except InvocationFailure as error:
                logger.warning("invocation_failed operation=%s code=%s", operation, error.code)
                raise HTTPException(status_code=error.status_code, detail=error.code) from None
            except Exception:
                logger.warning("invocation_failed operation=%s code=provider_unavailable", operation)
                raise HTTPException(status_code=502, detail="provider_unavailable") from None

    @app.post("/investigate", response_model=InvestigationResult, dependencies=[Depends(authorize)])
    async def investigate(request: InvestigationRequest):
        if os.getenv('STRANDS_TRANSPORT', 'http') == 'agentcore':
            from aws_adapters import runtime_investigate
            result = await asyncio.to_thread(runtime_investigate, request.model_dump(), app.state.settings.region)
        else:
            result = await dispatch("investigate", request.model_dump())
        try:
            response = InvestigationResult.model_validate(result)
            if response.provider != f"strands-{app.state.settings.provider}" or response.modelId != app.state.settings.model_id:
                raise HTTPException(status_code=502, detail="unexpected_provider_result")
            return response
        except ValidationError:
            raise HTTPException(status_code=502, detail="invalid_provider_result") from None

    @app.post("/embed", response_model=EmbeddingResult, dependencies=[Depends(authorize)])
    async def embed(request: EmbeddingRequest):
        result = await dispatch("embed", request.model_dump())
        try:
            response = EmbeddingResult.model_validate(result)
            import math
            if len(response.vectors) != len(request.texts) or any(len(vector) != 1024 or not all(math.isfinite(value) for value in vector) for vector in response.vectors):
                raise ValueError("invalid embedding dimensions")
            return response
        except (ValidationError, ValueError):
            raise HTTPException(status_code=502, detail="invalid_provider_result") from None

    @app.post('/sandbox', dependencies=[Depends(authorize)])
    async def sandbox(payload: dict):
        from aws_adapters import code_interpreter
        try: return await asyncio.to_thread(code_interpreter,payload,app.state.settings.region)
        except Exception: raise HTTPException(503,'code_interpreter_unavailable') from None

    return app


app = create_app()
