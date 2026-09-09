from dataclasses import replace
from types import SimpleNamespace
import pytest
from agent import InvestigationHooks
from budget import Budget, BudgetExceeded
from config import Settings


def test_model_and_token_reservations(settings):
    budget = Budget(replace(settings, max_model_calls=2, max_input_tokens=300, max_output_tokens=30, max_output_per_call=20))
    assert budget.before_model(100) == 20
    budget.record_usage(50, 5, 100, 20)
    assert budget.before_model(200) == 20
    budget.record_usage(100, 10, 200, 20)
    assert (budget.input_tokens, budget.output_tokens) == (150, 15)
    with pytest.raises(BudgetExceeded):
        budget.before_model(1)


def test_failed_stream_keeps_reservation(settings):
    budget = Budget(replace(settings, max_output_tokens=20, max_output_per_call=20))
    budget.before_model(100)
    with pytest.raises(BudgetExceeded):
        budget.before_model(100)


def test_input_cap_prevents_call(settings):
    budget = Budget(replace(settings, max_input_tokens=10))
    with pytest.raises(BudgetExceeded):
        budget.before_model(11)
    assert budget.model_calls == 0


def test_tool_cap_cancels_before_thirteenth_call(settings):
    budget = Budget(settings)
    hooks = InvestigationHooks(budget)
    for _ in range(12):
        event = SimpleNamespace(selected_tool=None, tool_use={"name": "get_device_health"}, cancel_tool=False)
        hooks.before_tool(event)
        assert not event.cancel_tool
    event = SimpleNamespace(selected_tool=None, tool_use={"name": "get_device_health"}, cancel_tool=False)
    hooks.before_tool(event)
    assert event.cancel_tool and budget.blocked and budget.tool_calls == 12


def test_unregistered_tool_is_never_executed(settings):
    hooks = InvestigationHooks(Budget(settings))
    event = SimpleNamespace(selected_tool=None, tool_use={"name": "execute_shell"}, cancel_tool=False)
    hooks.before_tool(event)
    assert event.cancel_tool


def test_settings_fail_closed(monkeypatch):
    monkeypatch.setenv('STRANDS_SERVICE_TOKEN', 't' * 40)
    monkeypatch.setenv('DEVICEOPS_MCP_COMMAND', 'node')
    with pytest.raises(ValueError, match='absolute'):
        Settings.from_env()
    monkeypatch.setenv('DEVICEOPS_MCP_COMMAND', '/usr/bin/node')
    monkeypatch.setenv('AGENT_MAX_MODEL_CALLS', '9')
    with pytest.raises(ValueError, match='between'):
        Settings.from_env()
