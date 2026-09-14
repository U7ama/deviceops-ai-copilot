"""Fail-closed invocation budgets, independent of model-supplied usage numbers."""
from dataclasses import dataclass, field
from typing import Callable
from config import Settings


class BudgetExceeded(Exception):
    pass


@dataclass
class Budget:
    settings: Settings
    model_calls: int = 0
    tool_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    reserved_input: int = 0
    reserved_output: int = 0
    blocked: bool = False
    exhausted_reason: str = ""
    progress: Callable[..., None] | None = field(default=None, repr=False)
    check_active: Callable[[], None] | None = field(default=None, repr=False)

    def exhausted(self, message: str) -> BudgetExceeded:
        self.exhausted_reason = message
        return BudgetExceeded(message)

    def before_model(self, input_upper_bound: int) -> int:
        if self.check_active: self.check_active()
        remaining_output = self.settings.max_output_tokens - self.reserved_output
        if self.blocked:
            raise self.exhausted("model budget exhausted: already blocked")
        if self.model_calls >= self.settings.max_model_calls:
            self.blocked = True
            raise self.exhausted(f"model budget exhausted: calls {self.model_calls} >= {self.settings.max_model_calls}")
        if self.reserved_input + input_upper_bound > self.settings.max_input_tokens:
            self.blocked = True
            raise self.exhausted(f"model budget exhausted: reserved_input {self.reserved_input} + {input_upper_bound} > {self.settings.max_input_tokens}")
        if remaining_output <= 0:
            self.blocked = True
            raise self.exhausted(f"model budget exhausted: remaining_output {remaining_output} <= 0")
        cap = min(self.settings.max_output_per_call, remaining_output)
        self.model_calls += 1
        # Keep the reservation until usage arrives, including failed/incomplete streams.
        self.reserved_input += input_upper_bound
        self.reserved_output += cap
        return cap

    def record_usage(self, input_tokens: int, output_tokens: int, reserved_input: int, reserved_output: int) -> None:
        if input_tokens < 0 or output_tokens < 0:
            self.blocked = True
            raise self.exhausted("invalid provider usage")
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.reserved_input += input_tokens - reserved_input
        self.reserved_output += output_tokens - reserved_output
        if self.reserved_input > self.settings.max_input_tokens or self.reserved_output > self.settings.max_output_tokens:
            self.blocked = True
            raise self.exhausted("provider token budget exhausted")

    def before_tool(self) -> None:
        if self.blocked or self.tool_calls >= self.settings.max_tool_calls:
            self.blocked = True
            raise self.exhausted("tool budget exhausted")
        self.tool_calls += 1
