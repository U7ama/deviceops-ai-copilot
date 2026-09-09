"""Fail-closed invocation budgets, independent of model-supplied usage numbers."""
from dataclasses import dataclass
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

    def before_model(self, input_upper_bound: int) -> int:
        remaining_output = self.settings.max_output_tokens - self.reserved_output
        if self.blocked or self.model_calls >= self.settings.max_model_calls or self.reserved_input + input_upper_bound > self.settings.max_input_tokens or remaining_output <= 0:
            self.blocked = True
            raise BudgetExceeded("model budget exhausted")
        cap = min(self.settings.max_output_per_call, remaining_output)
        self.model_calls += 1
        # Keep the reservation until usage arrives, including failed/incomplete streams.
        self.reserved_input += input_upper_bound
        self.reserved_output += cap
        return cap

    def record_usage(self, input_tokens: int, output_tokens: int, reserved_input: int, reserved_output: int) -> None:
        if input_tokens < 0 or output_tokens < 0:
            self.blocked = True
            raise BudgetExceeded("invalid provider usage")
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.reserved_input += input_tokens - reserved_input
        self.reserved_output += output_tokens - reserved_output
        if self.reserved_input > self.settings.max_input_tokens or self.reserved_output > self.settings.max_output_tokens:
            self.blocked = True
            raise BudgetExceeded("provider token budget exhausted")

    def before_tool(self) -> None:
        if self.blocked or self.tool_calls >= self.settings.max_tool_calls:
            self.blocked = True
            raise BudgetExceeded("tool budget exhausted")
        self.tool_calls += 1
