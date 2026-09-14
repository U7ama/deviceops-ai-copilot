import json
from runner import safe_diagnostic


def test_diagnostic_excludes_secrets_and_source():
    secret = "private-api-key-and-payload"
    try:
        raise ValueError(secret)
    except ValueError as error:
        result = safe_diagnostic(error)
    assert result["type"] == "ValueError"
    assert result["status"] is None
    assert result["frames"][-1]["file"] == "test_diagnostics.py"
    assert secret not in json.dumps(result)
    assert "/" not in result["frames"][-1]["file"]


def test_status_only_accepts_integer():
    error = RuntimeError("secret")
    error.code = "secret"
    assert safe_diagnostic(error)["status"] is None
    error.code = 503
    assert safe_diagnostic(error)["status"] == 503


def test_strands_wrapper_exposes_original_status_without_message():
    from runner import underlying_error
    from strands.types.exceptions import EventLoopException
    error = RuntimeError("private payload")
    error.code = 429
    wrapped = EventLoopException(EventLoopException(error))
    assert underlying_error(wrapped) is error
    assert safe_diagnostic(underlying_error(wrapped))["status"] == 429
