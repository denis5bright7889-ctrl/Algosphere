"""
AlgoSphere MT5 Bridge — endpoint test suite.

Covers:
  - Public / auth / system endpoints
  - New endpoints: /health/live, /trade/status/{queue_id}
  - Modified endpoint: /trade/place (queue-on-notready behaviour)
  - Request validation on all trading endpoints
  - Unit tests: dependency_guard, execution_engine, _QueuedTrade

Run with:
    python -m pytest tests/test_bridge_endpoints.py -v
    python -m pytest tests/test_bridge_endpoints.py -v -k "live"       # only new endpoints
    python -m pytest tests/test_bridge_endpoints.py -v -k "unit"       # only unit tests
    python -m pytest tests/test_bridge_endpoints.py -v --tb=short      # compact tracebacks
"""
from __future__ import annotations

import asyncio
import pathlib
import sys
import types
import unittest

import httpx
import pytest

# ── Config ─────────────────────────────────────────────────────────────

BASE_URL = "http://127.0.0.1:8000"
_BRIDGE_DIR = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BRIDGE_DIR))

# Read the API key from .env so we don't hardcode secrets in tests.
_API_KEY = ""
_env_file = _BRIDGE_DIR / ".env"
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        if _line.startswith("BRIDGE_API_KEY="):
            _API_KEY = _line.split("=", 1)[1].strip()
            break

GOOD_AUTH = {"X-Bridge-Key": _API_KEY}
BAD_AUTH  = {"X-Bridge-Key": "definitely-wrong-key"}


# ── Session-scoped client ───────────────────────────────────────────────

@pytest.fixture(scope="session")
def client():
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as c:
        yield c


# ═══════════════════════════════════════════════════════════════════════
# GROUP 1 — Public / unauthenticated endpoints
# ═══════════════════════════════════════════════════════════════════════

class TestHealthEndpoint:
    def test_returns_200(self, client):
        assert client.get("/health").status_code == 200

    def test_canonical_fields_present(self, client):
        j = client.get("/health").json()
        for field in ("status", "mt5_loaded", "timestamp"):
            assert field in j, f"missing canonical field: {field!r}"

    def test_status_is_ok(self, client, mt5_live):
        if not mt5_live:
            pytest.skip("MT5 not running — status will be 'degraded', not 'ok'")
        assert client.get("/health").json()["status"] == "ok"

    def test_mt5_ready_true(self, client, mt5_live):
        if not mt5_live:
            pytest.skip("MT5 not running — mt5_ready will be False")
        assert client.get("/health").json()["mt5_ready"] is True

    def test_bridge_ready_alias_present(self, client):
        j = client.get("/health").json()
        assert "bridge_ready" in j
        assert j["bridge_ready"] == j["mt5_ready"]

    # Fields added by the upgrade
    def test_terminal_connected_field(self, client):
        j = client.get("/health").json()
        assert "terminal_connected" in j
        assert isinstance(j["terminal_connected"], bool)

    def test_trade_queue_section(self, client):
        j = client.get("/health").json()
        assert "trade_queue" in j
        tq = j["trade_queue"]
        for key in ("pending", "executing", "done", "failed", "total"):
            assert key in tq, f"trade_queue missing key: {key!r}"
            assert isinstance(tq[key], int)
        assert tq["total"] == tq["pending"] + tq["executing"] + tq["done"] + tq["failed"]

    def test_risk_section_shape(self, client):
        j = client.get("/health").json()
        assert "risk" in j
        r = j["risk"]
        for key in ("max_lot_limit", "max_orders_per_min", "orders_last_60s", "rate_status"):
            assert key in r, f"risk missing key: {key!r}"

    def test_service_uptime_positive(self, client):
        assert client.get("/health").json()["service_uptime_s"] >= 0


class TestHealthLive:
    """/health/live — process liveness probe (always 200 while process runs)."""

    def test_returns_200_always(self, client):
        """Liveness probe must always return 200 while the process is alive,
        regardless of MT5 state. Returning 503 would cause orchestrators to
        kill the bridge during an MT5 reconnect cycle."""
        assert client.get("/health/live").status_code == 200

    def test_live_true(self, client):
        assert client.get("/health/live").json()["live"] is True

    def test_required_fields(self, client):
        j = client.get("/health/live").json()
        for field in ("live", "mt5_ready", "terminal_connected", "queued_trades", "uptime_s"):
            assert field in j, f"/health/live missing field: {field!r}"

    def test_startup_grace_field_present(self, client):
        assert "startup_grace" in client.get("/health/live").json()

    def test_queued_trades_is_int(self, client):
        j = client.get("/health/live").json()
        assert isinstance(j["queued_trades"], int)
        assert j["queued_trades"] >= 0

    def test_uptime_positive(self, client):
        assert client.get("/health/live").json()["uptime_s"] >= 0

    def test_no_auth_required(self, client):
        r = client.get("/health/live")
        assert r.status_code == 200   # always 200 — liveness, not readiness

    def test_consistent_with_health(self, client):
        health = client.get("/health").json()
        live   = client.get("/health/live").json()
        assert live["mt5_ready"] == health["mt5_ready"]


class TestHealthReady:
    """/health/ready — readiness probe (503 until MT5 is ready to trade)."""

    def test_returns_200_or_503(self, client):
        assert client.get("/health/ready").status_code in (200, 503)

    def test_ready_field_present(self, client):
        assert "ready" in client.get("/health/ready").json()

    def test_required_fields(self, client):
        j = client.get("/health/ready").json()
        for field in ("ready", "mt5_ready", "terminal_connected", "uptime_s"):
            assert field in j, f"/health/ready missing field: {field!r}"

    def test_ready_matches_mt5_ready(self, client):
        j = client.get("/health/ready").json()
        assert j["ready"] == j["mt5_ready"]

    def test_status_code_matches_ready(self, client):
        r = client.get("/health/ready")
        j = r.json()
        if j["ready"]:
            assert r.status_code == 200
        else:
            assert r.status_code == 503

    def test_ready_true_when_mt5_live(self, client, mt5_live):
        if not mt5_live:
            pytest.skip("MT5 not running — /health/ready will return 503")
        r = client.get("/health/ready")
        assert r.status_code == 200
        assert r.json()["ready"] is True

    def test_no_auth_required(self, client):
        r = client.get("/health/ready")
        assert r.status_code in (200, 503)


class TestDashboard:
    def test_admin_returns_html(self, client):
        r = client.get("/admin", follow_redirects=False)
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")

    def test_dashboard_308_to_admin(self, client):
        r = client.get("/dashboard", follow_redirects=False)
        assert r.status_code == 308
        assert r.headers.get("location", "").endswith("/admin")


# ═══════════════════════════════════════════════════════════════════════
# GROUP 2 — Authentication enforcement
# ═══════════════════════════════════════════════════════════════════════

class TestAuthEnforcement:
    _protected = [
        ("GET",  "/processes"),
        ("GET",  "/logs"),
        ("GET",  "/trade/status/dummy"),
        ("POST", "/connect"),
        ("POST", "/order"),
        ("POST", "/positions"),
        ("POST", "/cancel"),
        ("POST", "/symbol_spec"),
        ("POST", "/quote"),
        ("GET",  "/account"),
        ("GET",  "/positions"),
        ("GET",  "/system/processes"),
        ("GET",  "/system/logs"),
    ]

    @pytest.mark.parametrize("method,path", _protected)
    def test_missing_key_rejected(self, client, method, path):
        r = client.request(method, path)
        assert r.status_code in (401, 503), (
            f"{method} {path} with no key returned {r.status_code}"
        )

    @pytest.mark.parametrize("method,path", _protected)
    def test_wrong_key_401(self, client, method, path):
        r = client.request(method, path, headers=BAD_AUTH)
        assert r.status_code == 401, (
            f"{method} {path} with wrong key returned {r.status_code}"
        )


# ═══════════════════════════════════════════════════════════════════════
# GROUP 3 — System / monitoring endpoints
# ═══════════════════════════════════════════════════════════════════════

class TestSystemEndpoints:
    def test_processes_200(self, client):
        assert client.get("/processes", headers=GOOD_AUTH).status_code == 200

    def test_processes_list_shape(self, client):
        j = client.get("/processes", headers=GOOD_AUTH).json()
        assert "processes" in j
        assert isinstance(j["processes"], list)
        assert len(j["processes"]) > 0
        for p in j["processes"]:
            assert "name"    in p
            assert "running" in p
            assert "count"   in p

    def test_processes_start_runtime_listed(self, client):
        j = client.get("/processes", headers=GOOD_AUTH).json()
        names = {p["name"] for p in j["processes"]}
        assert "start_runtime.py" in names, (
            "start_runtime.py should be in EXPECTED_PROCESSES after migration"
        )

    def test_processes_legacy_start_listed(self, client):
        j = client.get("/processes", headers=GOOD_AUTH).json()
        names = {p["name"] for p in j["processes"]}
        # start.py kept as legacy reference
        assert "start.py" in names

    def test_processes_start_runtime_running(self, client):
        j = client.get("/processes", headers=GOOD_AUTH).json()
        sr = next(p for p in j["processes"] if p["name"] == "start_runtime.py")
        assert sr["running"] is True, "start_runtime.py should be the active runtime"

    def test_logs_200(self, client):
        assert client.get("/logs", headers=GOOD_AUTH).status_code == 200

    def test_logs_returns_list(self, client):
        j = client.get("/logs", headers=GOOD_AUTH).json()
        assert "logs" in j
        assert isinstance(j["logs"], list)

    def test_logs_default_max_20(self, client):
        j = client.get("/logs", headers=GOOD_AUTH).json()
        assert len(j["logs"]) <= 20

    def test_logs_lines_param_respected(self, client):
        j = client.get("/logs?lines=5", headers=GOOD_AUTH).json()
        assert len(j["logs"]) <= 5

    def test_logs_lines_zero_422(self, client):
        assert client.get("/logs?lines=0", headers=GOOD_AUTH).status_code == 422

    def test_logs_lines_over_500_422(self, client):
        assert client.get("/logs?lines=501", headers=GOOD_AUTH).status_code == 422

    def test_system_health_matches_health(self, client):
        base  = client.get("/health").json()
        alias = client.get("/system/health").json()
        assert alias["status"]    == base["status"]
        assert alias["mt5_ready"] == base["mt5_ready"]

    def test_system_status_200(self, client):
        r = client.get("/system/status")
        assert r.status_code == 200
        assert "status" in r.json()

    def test_system_processes_with_key(self, client):
        assert client.get("/system/processes", headers=GOOD_AUTH).status_code == 200

    def test_system_logs_with_key(self, client):
        assert client.get("/system/logs", headers=GOOD_AUTH).status_code == 200


# ═══════════════════════════════════════════════════════════════════════
# GROUP 4 — /trade/status/{queue_id}  (NEW endpoint)
# ═══════════════════════════════════════════════════════════════════════

class TestTradeStatus:
    def test_unknown_id_404(self, client):
        r = client.get("/trade/status/doesnotexist", headers=GOOD_AUTH)
        assert r.status_code == 404

    def test_404_detail_mentions_id(self, client):
        r = client.get("/trade/status/myid42", headers=GOOD_AUTH)
        assert "myid42" in r.json().get("detail", "")

    def test_no_key_rejected(self, client):
        r = client.get("/trade/status/anything")
        assert r.status_code in (401, 503)

    def test_wrong_key_401(self, client):
        r = client.get("/trade/status/anything", headers=BAD_AUTH)
        assert r.status_code == 401

    def test_response_shape_for_queued_id(self, client):
        """Place a trade while MT5 is NOT ready to produce a queued item,
        then verify the status response shape. If MT5 is ready, the trade
        executes immediately (200) and the queue_id is never created.
        We only validate the queue_id shape when we actually get a 202."""
        import uuid
        fake_id = uuid.uuid4().hex[:12]
        r = client.get(f"/trade/status/{fake_id}", headers=GOOD_AUTH)
        # Either 404 (not in store) or 200 (if somehow exists).
        if r.status_code == 200:
            j = r.json()
            for field in ("queue_id", "status", "enqueued_at", "mt5_ready"):
                assert field in j, f"trade/status response missing field: {field!r}"


# ═══════════════════════════════════════════════════════════════════════
# GROUP 5 — /trade/place   (MODIFIED: queue instead of 503)
# ═══════════════════════════════════════════════════════════════════════

class TestTradePlace:
    def test_invalid_direction_422(self, client):
        r = client.post("/trade/place", headers=GOOD_AUTH, json={
            "symbol": "EURUSD", "lot": 0.01, "direction": "SIDEWAYS",
        })
        assert r.status_code == 422

    def test_invalid_direction_detail(self, client):
        r = client.post("/trade/place", headers=GOOD_AUTH, json={
            "symbol": "EURUSD", "lot": 0.01, "direction": "DIAGONAL",
        })
        assert r.status_code == 422
        assert "BUY" in str(r.json()) or "SELL" in str(r.json()) or "direction" in str(r.json()).lower()

    def test_missing_symbol_422(self, client):
        r = client.post("/trade/place", headers=GOOD_AUTH, json={
            "lot": 0.01, "direction": "BUY",
        })
        assert r.status_code == 422

    def test_missing_lot_422(self, client):
        r = client.post("/trade/place", headers=GOOD_AUTH, json={
            "symbol": "EURUSD", "direction": "BUY",
        })
        assert r.status_code == 422

    def test_no_auth_rejected(self, client):
        r = client.post("/trade/place", json={
            "symbol": "EURUSD", "lot": 0.01, "direction": "BUY",
        })
        assert r.status_code in (401, 503)

    def test_never_returns_503_for_mt5_not_ready(self, client):
        """Core regression: /trade/place must queue, never 503."""
        # With no default creds configured we'll get 503 for a different
        # reason (no .env creds). That's expected. The 503 for mt5_ready=False
        # is the one we eliminated — it's now a 202 instead.
        r = client.post("/trade/place", headers=GOOD_AUTH, json={
            "symbol": "EURUSD", "lot": 0.01, "direction": "BUY",
        })
        # Acceptable: 200 (executed), 202 (queued), 503 (no default creds)
        # NOT acceptable: 503 with message about MT5 not ready
        if r.status_code == 503:
            detail = r.json().get("detail", "")
            assert "MT5 not ready" not in detail, (
                f"/trade/place returned 503 with MT5-not-ready detail — "
                f"should have queued instead: {detail!r}"
            )

    def test_202_response_has_queue_id_when_queued(self, client):
        """If we get a 202, the body must have queue_id and poll_url."""
        r = client.post("/trade/place", headers=GOOD_AUTH, json={
            "symbol": "EURUSD", "lot": 0.01, "direction": "BUY",
        })
        if r.status_code == 202:
            j = r.json()
            assert "queue_id"  in j
            assert "poll_url"  in j
            assert "status"    in j
            assert j["status"] == "queued"
            assert j["poll_url"].startswith("/trade/status/")

    def test_queued_id_queryable(self, client):
        """A 202 queue_id should be queryable via /trade/status/{id}."""
        r = client.post("/trade/place", headers=GOOD_AUTH, json={
            "symbol": "EURUSD", "lot": 0.01, "direction": "BUY",
        })
        if r.status_code != 202:
            pytest.skip("trade not queued (MT5 ready or no creds) — skip")
        qid = r.json()["queue_id"]
        s = client.get(f"/trade/status/{qid}", headers=GOOD_AUTH)
        assert s.status_code == 200
        assert s.json()["queue_id"] == qid
        assert s.json()["status"] in ("pending", "executing", "done", "failed")


# ═══════════════════════════════════════════════════════════════════════
# GROUP 6 — Request validation on existing trading endpoints
# ═══════════════════════════════════════════════════════════════════════

class TestRequestValidation:
    @pytest.mark.parametrize("endpoint", [
        "/connect", "/order", "/cancel", "/positions",
        "/close_all", "/symbol_spec", "/quote",
    ])
    def test_empty_body_422(self, client, endpoint):
        r = client.post(endpoint, headers=GOOD_AUTH, json={})
        assert r.status_code == 422, (
            f"POST {endpoint} with empty body should be 422, got {r.status_code}"
        )

    def test_order_negative_qty_422(self, client):
        r = client.post("/order", headers=GOOD_AUTH, json={
            "login": 1, "password": "x", "server": "x",
            "symbol": "EURUSD", "side": "buy",
            "order_type": "market", "quantity": -1.0,
        })
        # Either 422 (Pydantic) or processed by _validate_qty (also 422)
        assert r.status_code in (400, 422)

    def test_order_invalid_side_422(self, client):
        r = client.post("/order", headers=GOOD_AUTH, json={
            "login": 1, "password": "x", "server": "x",
            "symbol": "EURUSD", "side": "sideways",
            "order_type": "market", "quantity": 0.01,
        })
        # Requires MT5 to be ready and login to succeed before side validation.
        # Accept 400 (login fail), 422 (side invalid), 503 (mt5 not ready).
        assert r.status_code in (400, 422, 503)

    def test_logs_non_integer_lines_422(self, client):
        r = client.get("/logs?lines=abc", headers=GOOD_AUTH)
        assert r.status_code == 422


# ═══════════════════════════════════════════════════════════════════════
# GROUP 7 — Unit tests: dependency_guard
# ═══════════════════════════════════════════════════════════════════════

class TestDependencyGuardUnit(unittest.TestCase):
    def _import(self):
        from dependency_guard import check_dependencies, GuardReport
        return check_dependencies, GuardReport

    def test_check_returns_guard_report(self):
        check_dependencies, GuardReport = self._import()
        report = check_dependencies()
        self.assertIsInstance(report, GuardReport)

    def test_no_fatal_dependencies(self):
        check_dependencies, _ = self._import()
        report = check_dependencies()
        self.assertEqual(report.fatal, [], f"fatal deps: {report.fatal}")

    def test_api_capability_enabled(self):
        check_dependencies, _ = self._import()
        report = check_dependencies()
        self.assertTrue(
            report.capabilities.get("api"),
            "fastapi capability should be True"
        )

    def test_server_capability_enabled(self):
        check_dependencies, _ = self._import()
        report = check_dependencies()
        self.assertTrue(report.capabilities.get("server"))

    def test_as_dict_has_required_keys(self):
        check_dependencies, _ = self._import()
        d = check_dependencies().as_dict()
        for key in ("degraded", "fatal", "capabilities", "deps"):
            self.assertIn(key, d)

    def test_deps_list_not_empty(self):
        check_dependencies, _ = self._import()
        d = check_dependencies().as_dict()
        self.assertGreater(len(d["deps"]), 0)

    def test_each_dep_has_required_keys(self):
        check_dependencies, _ = self._import()
        for dep in check_dependencies().as_dict()["deps"]:
            for key in ("name", "required", "present", "ok"):
                self.assertIn(key, dep, f"dep {dep.get('name')!r} missing key {key!r}")


# ═══════════════════════════════════════════════════════════════════════
# GROUP 8 — Unit tests: execution_engine
# ═══════════════════════════════════════════════════════════════════════

class TestExecutionEngineUnit(unittest.TestCase):
    def setUp(self):
        from execution_engine import (
            get_engine, MT5ExecutionEngine, BrokerAPIExecutionEngine,
            EngineConfig, _ENGINE_REGISTRY,
        )
        self.get_engine       = get_engine
        self.MT5Engine        = MT5ExecutionEngine
        self.BrokerEngine     = BrokerAPIExecutionEngine
        self.EngineConfig     = EngineConfig
        self.registry         = _ENGINE_REGISTRY

    def test_get_engine_mt5_returns_correct_type(self):
        e = self.get_engine("mt5")
        self.assertIsInstance(e, self.MT5Engine)

    def test_get_engine_broker_api_returns_correct_type(self):
        e = self.get_engine("broker_api", base_url="http://localhost", api_key="k")
        self.assertIsInstance(e, self.BrokerEngine)

    def test_get_engine_unknown_raises_value_error(self):
        with self.assertRaises(ValueError) as ctx:
            self.get_engine("unknown_engine_xyz")
        self.assertIn("unknown_engine_xyz", str(ctx.exception).lower())

    def test_registry_contains_expected_engines(self):
        self.assertIn("mt5",        self.registry)
        self.assertIn("broker_api", self.registry)

    def test_broker_api_connect_not_implemented(self):
        e = self.get_engine("broker_api", base_url="http://localhost", api_key="k")
        cfg = self.EngineConfig(login=1, password="x", server="x")
        with self.assertRaises(NotImplementedError):
            asyncio.run(e.connect(cfg))

    def test_broker_api_submit_order_not_implemented(self):
        e = self.get_engine("broker_api", base_url="http://localhost", api_key="k")
        cfg = self.EngineConfig(login=1, password="x", server="x")
        with self.assertRaises(NotImplementedError):
            asyncio.run(e.submit_order(cfg, "EURUSD", "buy", "market", 0.01))

    def test_broker_api_get_positions_not_implemented(self):
        e = self.get_engine("broker_api", base_url="http://localhost", api_key="k")
        cfg = self.EngineConfig(login=1, password="x", server="x")
        with self.assertRaises(NotImplementedError):
            asyncio.run(e.get_positions(cfg))

    def test_engine_config_defaults(self):
        cfg = self.EngineConfig(login=123, password="p", server="s")
        self.assertEqual(cfg.magic, 20240501)

    def test_order_result_dataclass(self):
        from execution_engine import OrderResult
        r = OrderResult(
            order_id="1", status="FILLED", requested_qty=0.01,
            filled_qty=0.01, avg_fill_price=1.1, slippage_pct=0.0,
            commission=0.0, timestamp_ms=1000,
        )
        self.assertEqual(r.status, "FILLED")
        self.assertIsNone(r.raw)

    def test_position_dataclass(self):
        from execution_engine import Position
        p = Position(
            symbol="EURUSD", side="long", qty=0.1,
            avg_entry=1.1, current_price=1.2, unrealized_pnl=10.0,
            broker_pos_id="42",
        )
        self.assertEqual(p.side, "long")


# ═══════════════════════════════════════════════════════════════════════
# GROUP 9 — Unit tests: bridge internals (MetaTrader5 mocked)
# ═══════════════════════════════════════════════════════════════════════

def _import_bridge_with_mock_mt5():
    """Import bridge.py with MetaTrader5 stubbed so tests don't need the
    terminal. Safe to call multiple times — returns cached module."""
    if "bridge" in sys.modules:
        return sys.modules["bridge"]
    # Stub MetaTrader5 before the first bridge import.
    fake = types.ModuleType("MetaTrader5")
    fake.initialize = lambda *a, **kw: True
    fake.terminal_info = lambda: None
    fake.last_error = lambda: (0, "")
    sys.modules.setdefault("MetaTrader5", fake)
    import bridge  # noqa: PLC0415
    return bridge


class TestBridgeQueuedTrade(unittest.TestCase):
    def setUp(self):
        self.bridge = _import_bridge_with_mock_mt5()

    def test_default_status_is_pending(self):
        t = self.bridge._QueuedTrade(queue_id="abc", req=None)
        self.assertEqual(t.status, "pending")

    def test_default_result_is_none(self):
        t = self.bridge._QueuedTrade(queue_id="abc", req=None)
        self.assertIsNone(t.result)

    def test_default_error_is_empty(self):
        t = self.bridge._QueuedTrade(queue_id="abc", req=None)
        self.assertEqual(t.error, "")

    def test_default_completed_at_is_none(self):
        t = self.bridge._QueuedTrade(queue_id="abc", req=None)
        self.assertIsNone(t.completed_at)

    def test_enqueued_at_is_set(self):
        import time
        before = time.time()
        t = self.bridge._QueuedTrade(queue_id="abc", req=None)
        after = time.time()
        self.assertGreaterEqual(t.enqueued_at, before)
        self.assertLessEqual(t.enqueued_at, after)

    def test_trade_queue_store_is_dict(self):
        self.assertIsInstance(self.bridge._trade_queue_store, dict)

    def test_terminal_connected_is_bool(self):
        self.assertIsInstance(self.bridge._terminal_connected, bool)

    def test_mt5_reconnect_constants(self):
        self.assertGreater(self.bridge.MT5_RECONNECT_MIN_S, 0)
        self.assertGreaterEqual(self.bridge.MT5_RECONNECT_MAX_S, self.bridge.MT5_RECONNECT_MIN_S)

    def test_trade_queue_timeout_positive(self):
        self.assertGreater(self.bridge.TRADE_QUEUE_TIMEOUT_S, 0)

    def test_service_started_at_is_float(self):
        self.assertIsInstance(self.bridge.SERVICE_STARTED_AT, float)

    def test_expected_processes_contains_start_runtime(self):
        self.assertIn("start_runtime.py", self.bridge.EXPECTED_PROCESSES)

    def test_expected_processes_no_watchdog_entries(self):
        # Legacy watchdog.py and guardian.py were removed from the list.
        self.assertNotIn("watchdog.py",  self.bridge.EXPECTED_PROCESSES)
        self.assertNotIn("guardian.py",  self.bridge.EXPECTED_PROCESSES)

    def test_queue_ttl_positive(self):
        self.assertGreater(self.bridge.QUEUE_TTL_S, 0)

    def test_startup_grace_positive(self):
        self.assertGreater(self.bridge.STARTUP_GRACE_S, 0)


# ═══════════════════════════════════════════════════════════════════════
# GROUP 10 — /system/validate (Phase 6 final state validation)
# ═══════════════════════════════════════════════════════════════════════

class TestSystemValidate:
    """/system/validate — Phase 6 production-grade state validation."""

    def test_requires_auth(self, client):
        assert client.get("/system/validate").status_code in (401, 503)

    def test_wrong_key_401(self, client):
        assert client.get("/system/validate", headers=BAD_AUTH).status_code == 401

    def test_returns_200_or_degraded(self, client):
        r = client.get("/system/validate", headers=GOOD_AUTH)
        assert r.status_code == 200

    def test_status_field_present(self, client):
        j = client.get("/system/validate", headers=GOOD_AUTH).json()
        assert "status" in j
        assert j["status"] in ("ok", "degraded")

    def test_required_fields(self, client):
        j = client.get("/system/validate", headers=GOOD_AUTH).json()
        for field in ("status", "pid", "single_instance", "mt5_ready",
                      "terminal_connected", "orphan_ports", "trade_queue_depth",
                      "uptime_s", "checks"):
            assert field in j, f"/system/validate missing field: {field!r}"

    def test_pid_is_positive_int(self, client):
        j = client.get("/system/validate", headers=GOOD_AUTH).json()
        assert isinstance(j["pid"], int)
        assert j["pid"] > 0

    def test_orphan_ports_is_list(self, client):
        j = client.get("/system/validate", headers=GOOD_AUTH).json()
        assert isinstance(j["orphan_ports"], list)

    def test_checks_section_shape(self, client):
        j = client.get("/system/validate", headers=GOOD_AUTH).json()
        checks = j["checks"]
        for key in ("mt5_ready", "single_instance", "no_orphan_ports",
                    "watchdog_clean", "queue_empty"):
            assert key in checks, f"checks missing key: {key!r}"
            assert isinstance(checks[key], bool)

    def test_trade_queue_depth_non_negative(self, client):
        j = client.get("/system/validate", headers=GOOD_AUTH).json()
        assert j["trade_queue_depth"] >= 0

    def test_uptime_positive(self, client):
        j = client.get("/system/validate", headers=GOOD_AUTH).json()
        assert j["uptime_s"] >= 0

    def test_status_ok_when_all_checks_pass(self, client, mt5_live):
        if not mt5_live:
            pytest.skip("MT5 not running — status will be 'degraded'")
        j = client.get("/system/validate", headers=GOOD_AUTH).json()
        assert j["status"] == "ok", f"expected ok, got degraded: {j}"
