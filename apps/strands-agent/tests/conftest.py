import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from config import Settings


@pytest.fixture
def settings():
    return Settings(service_token="t" * 40, credits_confirmed=True)
