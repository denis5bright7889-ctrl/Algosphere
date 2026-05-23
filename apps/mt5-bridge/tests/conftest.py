"""
Pytest configuration for the AlgoSphere MT5 Bridge test suite.

Adds the bridge directory to sys.path so unit-test imports resolve
without needing an editable install.
"""
import pathlib
import sys

import pytest
import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_BASE_URL = "http://127.0.0.1:8000"


@pytest.fixture(scope="session")
def mt5_live():
    """Returns True if the live bridge reports mt5_ready=True.

    Tests decorated with @pytest.mark.skipif(not mt5_live(), ...) are
    skipped when the MT5 terminal is not running — they are integration
    tests that require a live MT5 connection, not code bugs."""
    try:
        r = httpx.get(f"{_BASE_URL}/health", timeout=3.0)
        return r.status_code == 200 and r.json().get("mt5_ready", False)
    except Exception:
        return False
