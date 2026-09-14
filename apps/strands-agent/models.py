"""Strict request/result boundaries shared with the DeviceOps worker."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

Identifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")]
EvidenceId = Annotated[str, Field(min_length=1, max_length=256)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InvestigationRequest(Contract):
    invocationId: Identifier
    incidentId: Identifier
    workflow: Literal["single", "specialists"] = "single"
    grantToken: str = Field(min_length=16, max_length=8192, repr=False)


class EmptyArguments(Contract):
    pass


class Action(Contract):
    name: Literal["restart_service", "restart_switch"]
    targetDeviceId: Annotated[str, Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")]
    arguments: EmptyArguments


class Investigation(Contract):
    """Evidence-supported diagnosis and optional proposal; never an authorization decision."""
    summary: str = Field(min_length=1, max_length=1200)
    cause: str = Field(min_length=1, max_length=1000)
    evidenceIds: list[EvidenceId] = Field(min_length=1, max_length=40)
    alternatives: list[Annotated[str, Field(max_length=400)]] = Field(max_length=5)
    uncertainty: str = Field(max_length=1000)
    action: Action | None = None

    @field_validator("action", mode="before")
    @classmethod
    def parse_action(cls, v):
        if isinstance(v, str):
            try:
                import json
                return json.loads(v)
            except Exception:
                pass
        return v


class SpecialistFinding(Contract):
    specialist: Literal['network', 'system', 'power', 'critic']
    status: Literal['complete', 'incomplete']
    hypothesis: str = Field(max_length=1200)
    evidenceIds: list[Annotated[str, Field(max_length=256)]] = Field(max_length=40)
    conflicts: list[Annotated[str, Field(max_length=400)]] = Field(max_length=8)
    gaps: list[Annotated[str, Field(max_length=400)]] = Field(max_length=8)
    uncertainty: str = Field(max_length=1000)

    @field_validator("specialist", mode="before")
    @classmethod
    def clamp_specialist(cls, v):
        s = str(v).lower() if v is not None else ""
        for role in ['network', 'system', 'power', 'critic']:
            if role in s:
                return role
        return "system"

    @field_validator("status", mode="before")
    @classmethod
    def clamp_status(cls, v):
        s = str(v).lower() if v is not None else ""
        if "incomplet" in s or "fail" in s or "pend" in s:
            return "incomplete"
        return "complete"

    @field_validator("hypothesis", mode="before")
    @classmethod
    def clamp_hyp(cls, v):
        return str(v)[:1200] if v is not None else ""

    @field_validator("uncertainty", mode="before")
    @classmethod
    def clamp_unc(cls, v):
        return str(v)[:1000] if v is not None else ""

    @field_validator("evidenceIds", mode="before")
    @classmethod
    def clamp_evidence(cls, v):
        if isinstance(v, str):
            try:
                import json
                v = json.loads(v)
            except Exception:
                v = [v]
        if isinstance(v, list):
            return [str(x)[:256] for x in v[:40]]
        return []

    @field_validator("conflicts", "gaps", mode="before")
    @classmethod
    def clamp_lists(cls, v):
        if isinstance(v, str):
            try:
                import json
                v = json.loads(v)
            except Exception:
                v = [v]
        if isinstance(v, list):
            return [str(x)[:400] for x in v[:8]]
        return []

class InvestigationEnvelope(Contract):
    version: Literal['enterprise.v1']
    status: Literal['complete', 'incomplete']
    findings: list[SpecialistFinding] = Field(max_length=4)
    criticRequiresEscalation: bool
    memoryIds: list[Annotated[str, Field(max_length=256)]] = Field(max_length=20)
    artifactIds: list[Annotated[str, Field(max_length=256)]] = Field(max_length=20)

class Usage(Contract):
    inputTokens: StrictInt = Field(ge=0)
    outputTokens: StrictInt = Field(ge=0)
    modelCalls: StrictInt = Field(ge=0, le=12)


class InvestigationResult(Investigation):
    provider: Literal["strands-bedrock", "strands-qwen"] = "strands-bedrock"
    modelId: str = Field(min_length=1, max_length=256)
    usage: Usage
    toolCalls: StrictInt = Field(ge=0, le=24)
    enterprise: InvestigationEnvelope | None = Field(default=None, exclude_if=lambda value: value is None)


class EmbeddingRequest(Contract):
    texts: list[Annotated[str, Field(min_length=1, max_length=4000)]] = Field(min_length=1, max_length=16)


class EmbeddingResult(Contract):
    vectors: list[list[float]]
    modelId: str
    inputTokens: StrictInt = Field(ge=0)
