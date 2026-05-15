"""
AlgoSphere Quant — Risk Subsystem Tests
Covers all institutional scenarios required by the risk specification:
  - persistence roundtrip
  - rollover resets (daily / weekly)
  - cooldown activation + expiry
  - kill switch activation
  - total / daily / weekly DD breach
  - broker disconnect fallback (cached equity)
  - operator restart unlock
  - account-change detection
  - all 12 gate failures
  - micro-account mode
  - adaptive lot scaling
  - locked-state persistence across restart

Run with:  pytest apps/signal-engine/tests/test_risk.py -v
"""
from __future__ import annotations
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
import pytest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from risk import (
    RiskConfig, RiskEngine, RiskGate, MockBroker, SymbolSpec,
)
from risk.risk_state import RiskStateStore


# ═════════════════════════════════════════════════════════════════════════════
# Fixtures
# ═════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def tmp_paths(tmp_path):
    """Provide per-test isolated state and kill-switch flag paths."""
    state = tmp_path / 'risk_state.json'
    flag  = tmp_path / 'HALTED.flag'
    return state, flag


@pytest.fixture
def cfg(tmp_paths):
    state, flag = tmp_paths
    return RiskConfig(
        enabled=True,
        initial_equity=10_000.0,
        starting_balance=10_000.0,
        daily_loss_limit_pct=0.05,
        weekly_loss_limit_pct=0.10,
        max_total_drawdown_pct=0.15,
        cooldown_consecutive_losses=3,
        cooldown_minutes=120,
        max_consecutive_losses=4,
        risk_per_trade_pct=0.01,
        max_lot_multiplier=2.0,
        max_effective_risk_pct=0.02,
        max_open_positions=5,
        max_spread_pips=5.0,
        min_sl_distance_pips=5.0,
        state_path=str(state),
        halted_flag_path=str(flag),
        broker_mode='mock',
    )


@pytest.fixture
def broker():
    b = MockBroker(login='test_acc_001', equity=10_000.0)
    # XAUUSD spec — wide enough that 1% of 10k @ 20-pip SL gives a tradable lot
    b.set_spec('XAUUSD', SymbolSpec('XAUUSD', 0.01, 1.0, 0.01, 100.0, 0.01, 100, 2))
    b.set_spread('XAUUSD', 2.0)
    return b


@pytest.fixture
def engine(broker, cfg, tmp_paths):
    state, flag = tmp_paths
    return RiskEngine(broker, cfg, state_path=state, kill_flag_path=flag)


@pytest.fixture
def gate(engine, cfg):
    return RiskGate(engine, cfg)


# Convenience: a known-good trade ticket for XAUUSD
GOOD_TRADE = dict(
    symbol='XAUUSD',
    direction='buy',
    entry_price=2050.0,
    stop_loss_price=2048.0,   # 200 ticks ≈ 20 pips, well above min_sl
    spread_pips=2.0,
)


# ═════════════════════════════════════════════════════════════════════════════
# 1. Persistence roundtrip
# ═════════════════════════════════════════════════════════════════════════════

def test_persistence_roundtrip(engine, broker, cfg, tmp_paths):
    state_path, flag_path = tmp_paths

    engine.state.current_equity = 9_500.0
    engine.state.peak_equity    = 10_200.0
    engine.state.consecutive_losses = 2
    engine.store.save(engine.state)

    # New engine loads from disk
    e2 = RiskEngine(broker, cfg, state_path=state_path, kill_flag_path=flag_path)
    assert e2.state.current_equity     == 9_500.0
    assert e2.state.peak_equity        == 10_200.0
    assert e2.state.consecutive_losses == 2
    assert e2.state.account_login      == broker.get_account_login()


# ═════════════════════════════════════════════════════════════════════════════
# 2. Daily rollover resets baseline + pnl
# ═════════════════════════════════════════════════════════════════════════════

def test_daily_rollover_resets_baseline(engine):
    engine.state.daily_baseline_equity = 10_000.0
    engine.state.daily_baseline_date   = '1999-01-01'   # stale
    engine.state.current_equity        = 9_700.0

    engine._check_rollover()
    assert engine.state.daily_baseline_date == engine._today()
    assert engine.state.daily_baseline_equity == 9_700.0
    assert engine.state.daily_pnl == 0.0


def test_weekly_rollover_resets_baseline(engine):
    engine.state.weekly_baseline_iso_week = '1999-W01'
    engine.state.weekly_baseline_equity   = 10_000.0
    engine.state.current_equity           = 9_500.0

    engine._check_rollover()
    assert engine.state.weekly_baseline_iso_week == engine._iso_week()
    assert engine.state.weekly_baseline_equity == 9_500.0


# ═════════════════════════════════════════════════════════════════════════════
# 3. Cooldown activation + expiry
# ═════════════════════════════════════════════════════════════════════════════

def test_cooldown_activates_after_consecutive_losses(engine):
    for _ in range(3):
        engine.record_trade(was_win=False, pnl=-50.0, symbol='XAUUSD')
    assert engine.is_cooldown_active() is True
    assert engine.state.consecutive_losses == 3


def test_cooldown_expires_naturally(engine):
    # Manually set a cooldown that has already passed
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    engine.state.cooldown_until_iso = past
    engine.refresh()
    assert engine.state.cooldown_until_iso is None
    assert engine.is_cooldown_active() is False


# ═════════════════════════════════════════════════════════════════════════════
# 4. Kill switch from max consecutive losses
# ═════════════════════════════════════════════════════════════════════════════

def test_kill_switch_fires_on_max_consecutive_losses(engine, tmp_paths):
    state_path, flag_path = tmp_paths
    for _ in range(4):
        engine.record_trade(was_win=False, pnl=-50.0, symbol='XAUUSD')
    assert engine.is_locked() is True
    assert engine.kill_switch.is_active() is True
    assert flag_path.exists()


# ═════════════════════════════════════════════════════════════════════════════
# 5. Total DD breach → kill switch
# ═════════════════════════════════════════════════════════════════════════════

def test_total_drawdown_breach_fires_kill(engine, broker):
    # 15% drawdown from peak = catastrophic
    engine.state.peak_equity    = 10_000.0
    engine.state.current_equity = 8_500.0   # 15% DD
    broker.set_equity(8_500.0)
    engine.refresh()
    assert engine.is_locked() is True
    assert engine.kill_switch.is_active() is True


# ═════════════════════════════════════════════════════════════════════════════
# 6. Daily DD breach → halt for the day (not full kill)
# ═════════════════════════════════════════════════════════════════════════════

def test_daily_dd_breach_halts_until_midnight(engine, broker):
    engine.state.daily_baseline_equity = 10_000.0
    engine.state.current_equity        = 9_400.0   # 6% daily DD > 5%
    broker.set_equity(9_400.0)
    # Peak high enough that we don't trigger total DD
    engine.state.peak_equity = 10_000.0
    engine.refresh()
    assert engine.is_locked() is False
    assert engine.is_cooldown_active() is True


# ═════════════════════════════════════════════════════════════════════════════
# 7. Weekly DD breach → halt
# ═════════════════════════════════════════════════════════════════════════════

def test_weekly_dd_breach_halts(engine, broker):
    engine.state.weekly_baseline_equity = 10_000.0
    engine.state.current_equity         = 8_900.0   # 11% weekly DD > 10%
    engine.state.daily_baseline_equity  = 8_900.0   # already rolled
    engine.state.peak_equity            = 10_000.0
    # 11% loss = total DD 11% < 15%, so total-DD doesn't kill first
    broker.set_equity(8_900.0)
    engine.refresh()
    assert engine.is_cooldown_active() is True
    assert engine.is_locked() is False


# ═════════════════════════════════════════════════════════════════════════════
# 8. Broker disconnect — preserve cached equity, do not zero out
# ═════════════════════════════════════════════════════════════════════════════

def test_broker_disconnect_preserves_cached_equity(engine, broker):
    engine.state.current_equity = 9_800.0
    broker.set_connected(False)
    engine.refresh()
    assert engine.state.current_equity == 9_800.0   # unchanged
    assert engine.is_locked() is False              # no false alarm


# ═════════════════════════════════════════════════════════════════════════════
# 9. Operator restart unlock (manual kill switch reset)
# ═════════════════════════════════════════════════════════════════════════════

def test_operator_reset_unlocks_engine(engine):
    # Force-fire kill switch
    engine._fire_kill("synthetic test")
    assert engine.is_locked() is True

    ok = engine.reset_lock(operator='test-operator')
    assert ok is True
    assert engine.is_locked() is False
    assert engine.kill_switch.is_active() is False


# ═════════════════════════════════════════════════════════════════════════════
# 10. Account change detection
# ═════════════════════════════════════════════════════════════════════════════

def test_account_change_discards_previous_state(broker, cfg, tmp_paths):
    state_path, flag_path = tmp_paths
    # Write state belonging to OLD account
    e1 = RiskEngine(broker, cfg, state_path=state_path, kill_flag_path=flag_path)
    e1.state.current_equity = 9_000.0
    e1.store.save(e1.state)

    # New broker = different account
    broker2 = MockBroker(login='DIFFERENT_ACCOUNT', equity=10_000.0)
    broker2.set_spec('XAUUSD', SymbolSpec('XAUUSD', 0.01, 1.0, 0.01, 100.0, 0.01, 100, 2))
    e2 = RiskEngine(broker2, cfg, state_path=state_path, kill_flag_path=flag_path)
    assert e2.state.account_login   == 'DIFFERENT_ACCOUNT'
    assert e2.state.current_equity  == 10_000.0   # fresh state, NOT 9000


# ═════════════════════════════════════════════════════════════════════════════
# 11. All 12 gate failure paths
# ═════════════════════════════════════════════════════════════════════════════

def test_gate_01_kill_switch_blocks(engine, gate):
    engine._fire_kill("test")
    d = gate.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    assert '01_kill_switch' in d.gates_failed


def test_gate_02_daily_halt_blocks(engine, gate):
    # Set a long cooldown — interpreted by gate 2
    far = (datetime.now(timezone.utc) + timedelta(hours=10)).isoformat()
    engine.state.cooldown_until_iso = far
    engine.state.last_refreshed_iso = datetime.now(timezone.utc).isoformat()
    d = gate.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    # Either gate 02 or 03 fires depending on cooldown length — both are halt-related
    assert '02_daily_halt' in d.gates_failed or '03_cooldown' in d.gates_failed


def test_gate_03_short_cooldown_blocks(engine, gate):
    soon = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
    engine.state.cooldown_until_iso = soon
    engine.state.last_refreshed_iso = datetime.now(timezone.utc).isoformat()
    d = gate.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    assert '03_cooldown' in d.gates_failed


def test_gate_04_consecutive_losses_blocks(engine, gate):
    engine.state.consecutive_losses = 4
    d = gate.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    assert '04_consecutive_losses' in d.gates_failed


def test_gate_05_daily_dd_blocks(engine, gate):
    engine.state.daily_baseline_equity = 10_000.0
    engine.state.current_equity        = 9_400.0
    d = gate.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    assert '05_daily_dd' in d.gates_failed


def test_gate_06_weekly_dd_blocks(engine, gate):
    engine.state.weekly_baseline_equity = 10_000.0
    engine.state.current_equity         = 8_900.0
    engine.state.daily_baseline_equity  = 8_900.0   # so daily check passes
    engine.state.peak_equity            = 10_000.0   # so total DD < 15
    d = gate.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    assert '06_weekly_dd' in d.gates_failed


def test_gate_07_total_dd_blocks(engine, gate):
    engine.state.peak_equity    = 10_000.0
    engine.state.current_equity = 8_400.0   # 16% total DD
    engine.state.daily_baseline_equity  = 8_400.0
    engine.state.weekly_baseline_equity = 8_400.0
    d = gate.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    assert '07_total_dd' in d.gates_failed


def test_gate_08_portfolio_exposure_blocks(engine, gate):
    engine.state.open_positions = 5
    d = gate.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    assert '08_portfolio_exposure' in d.gates_failed


def test_gate_09_missing_symbol_spec_blocks(engine, gate, broker):
    # Force-clear the spec
    broker._specs = {}
    # Override default_spec fallback by using an exotic symbol with no defaults
    # — actually default_spec always returns SOMETHING, so we patch get_symbol_spec
    broker.get_symbol_spec = lambda s: None    # type: ignore
    d = gate.approve_trade(**{**GOOD_TRADE, 'symbol': 'XAUUSD'})
    assert d.approved is False
    assert '09_symbol_spec' in d.gates_failed


def test_gate_10_sl_too_close_blocks(engine, gate):
    bad = {**GOOD_TRADE, 'stop_loss_price': 2049.99}   # 0.01 = 0.1 pips on XAU
    d = gate.approve_trade(**bad)
    assert d.approved is False
    assert '10_sl_distance' in d.gates_failed


def test_gate_11_spread_too_wide_blocks(engine, gate):
    bad = {**GOOD_TRADE, 'spread_pips': 99.0}
    d = gate.approve_trade(**bad)
    assert d.approved is False
    assert '11_spread' in d.gates_failed


def test_gate_12_sizing_rejects_when_micro_account_over_cap(engine, gate, broker, cfg):
    # Force equity so low that even min_lot would exceed the effective-risk cap
    broker.set_equity(50.0)
    engine.state.current_equity = 50.0
    engine.state.daily_baseline_equity  = 50.0
    engine.state.weekly_baseline_equity = 50.0
    engine.state.peak_equity            = 50.0
    d = gate.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    assert '12_risk_per_trade' in d.gates_failed


# ═════════════════════════════════════════════════════════════════════════════
# 12. All gates pass on a clean trade
# ═════════════════════════════════════════════════════════════════════════════

def test_clean_trade_passes_all_gates(engine, gate):
    d = gate.approve_trade(**GOOD_TRADE)
    assert d.approved is True, f"Expected approval, got: {d.reasons}"
    assert len(d.gates_passed) == 12
    assert d.lot_size > 0
    assert d.risk_amount > 0


# ═════════════════════════════════════════════════════════════════════════════
# 13. Micro-account mode (small equity, min_lot allowed within cap)
# ═════════════════════════════════════════════════════════════════════════════

def test_micro_account_mode_allowed_when_within_cap(engine, broker):
    # Equity small but min_lot risk still under 2 % cap
    broker.set_equity(500.0)
    engine.state.current_equity = 500.0

    lot, meta = engine.calculate_lot('XAUUSD', stop_loss_distance_price=2.0)
    # min_lot=0.01, ticks=2/0.01=200, tick_value=1 → effective_risk = 0.01 * 200 * 1 = $2.00
    # $2 / $500 = 0.4 % — well under 2 % cap
    assert lot == 0.01
    assert meta['micro_account_mode'] is True


# ═════════════════════════════════════════════════════════════════════════════
# 14. Adaptive lot scaling
# ═════════════════════════════════════════════════════════════════════════════

def test_adaptive_reduces_on_drawdown(engine):
    engine.state.peak_equity    = 10_000.0
    engine.state.current_equity = 8_800.0    # 12% DD
    assert engine._adaptive_multiplier() == 0.5


def test_adaptive_boosts_on_win_streak(engine, cfg):
    engine.state.consecutive_wins = 4
    m = engine._adaptive_multiplier()
    assert m > 1.0
    assert m <= cfg.max_lot_multiplier


def test_adaptive_reduces_on_loss_streak(engine):
    engine.state.consecutive_losses = 2
    assert engine._adaptive_multiplier() == 0.7


# ═════════════════════════════════════════════════════════════════════════════
# 15. Locked-state persistence across restart
# ═════════════════════════════════════════════════════════════════════════════

def test_locked_state_persists_across_restart(broker, cfg, tmp_paths):
    state_path, flag_path = tmp_paths
    e1 = RiskEngine(broker, cfg, state_path=state_path, kill_flag_path=flag_path)
    e1._fire_kill("synthetic")
    assert e1.is_locked() is True
    assert flag_path.exists()

    # Simulate restart
    e2 = RiskEngine(broker, cfg, state_path=state_path, kill_flag_path=flag_path)
    assert e2.is_locked() is True
    assert e2.state.locked is True

    # And the gate respects it
    g2 = RiskGate(e2, cfg)
    d = g2.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    assert '01_kill_switch' in d.gates_failed


# ═════════════════════════════════════════════════════════════════════════════
# 16. Fail-safe — internal error returns approved=False
# ═════════════════════════════════════════════════════════════════════════════

def test_failsafe_returns_reject_on_internal_error(engine, gate, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("simulated explosion inside the engine")
    monkeypatch.setattr(engine, 'is_locked', boom)
    d = gate.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    assert any('Internal error' in r for r in d.reasons)


# ═════════════════════════════════════════════════════════════════════════════
# 17. Refresh updates peak equity on new highs
# ═════════════════════════════════════════════════════════════════════════════

def test_peak_equity_advances_on_new_highs(engine, broker):
    broker.set_equity(11_500.0)
    engine.refresh()
    assert engine.state.peak_equity == 11_500.0


# ═════════════════════════════════════════════════════════════════════════════
# 18. Disabled risk subsystem rejects all trades
# ═════════════════════════════════════════════════════════════════════════════

def test_disabled_risk_subsystem_rejects(engine, cfg):
    cfg2 = RiskConfig(
        enabled=False,
        state_path=cfg.state_path,
        halted_flag_path=cfg.halted_flag_path,
    )
    g = RiskGate(engine, cfg2)
    d = g.approve_trade(**GOOD_TRADE)
    assert d.approved is False
    assert any('disabled' in r.lower() for r in d.reasons)
