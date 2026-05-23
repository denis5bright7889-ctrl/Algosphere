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


@pytest.fixture(scope="function")
def mt5_live(client):
    """Returns True only when the bridge reports status='ok' at this moment.

    Function-scoped so each test re-evaluates current bridge health.
    status='ok' requires mt5_ready=True AND the watchdog has recently
    confirmed the connection (last_ok_ms set), so transient startup
    or post-bad-login states still cause a skip."""
    try:
        r = client.get("/health")
        return r.status_code == 200 and r.json().get("status") == "ok"
    except Exception:
        return False
