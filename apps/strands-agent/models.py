"""Strict request/result boundaries shared with the DeviceOps worker."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictInt

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
    action: Action | None


class SpecialistFinding(Contract):
    specialist: Literal['network', 'system', 'power', 'critic']
    status: Literal['complete', 'incomplete']
    hypothesis: str = Field(max_length=1200)
    evidenceIds: list[Annotated[str, Field(max_length=256)]] = Field(max_length=40)
    conflicts: list[Annotated[str, Field(max_length=400)]] = Field(max_length=8)
    gaps: list[Annotated[str, Field(max_length=400)]] = Field(max_length=8)
    uncertainty: str = Field(max_length=1000)

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
    provider: Literal["strands-bedrock", "strands-gemini"] = "strands-bedrock"
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
