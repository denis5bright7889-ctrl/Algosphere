"""
AlgoSphere Quant — Risk Configuration
All thresholds operator-tunable via RISK_* environment variables.
"""
from __future__ import annotations
from pydantic_settings import BaseSettings, SettingsConfigDict


class RiskConfig(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_prefix='RISK_', extra='ignore')

    # ─── Master switch ─────────────────────────────────────────────────────
    enabled: bool = True

    # ─── Account baseline ──────────────────────────────────────────────────
    initial_equity: float = 10000.0          # used only if broker is offline at startup
    starting_balance: float = 10000.0        # for SupabaseBroker (paper account)

    # ─── Hard drawdown limits ──────────────────────────────────────────────
    daily_loss_limit_pct:    float = 0.05    # 5 % daily
    weekly_loss_limit_pct:   float = 0.10    # 10 % weekly
    max_total_drawdown_pct:  float = 0.15    # 15 % all-time → KILL SWITCH

    # ─── Consecutive-loss circuit breaker ──────────────────────────────────
    cooldown_consecutive_losses: int = 3     # losses → soft cooldown
    cooldown_minutes:            int = 120   # 2 h
    max_consecutive_losses:      int = 4     # losses → KILL SWITCH

    # ─── Position sizing ───────────────────────────────────────────────────
    risk_per_trade_pct:      float = 0.01    # 1 % per trade
    max_lot_multiplier:      float = 2.0     # adaptive cap
    max_effective_risk_pct:  float = 0.02    # micro-account hard cap (2 %)

    # ─── Portfolio exposure ────────────────────────────────────────────────
    max_open_positions:        int = 5
    # Spec section 6: portfolio-level controls.
    max_open_per_symbol:       int = 1     # one position per instrument
    max_correlated_positions:  int = 2     # cap on simultaneous opens in any
                                            # correlated group (see CORRELATED_GROUPS)
    max_portfolio_risk_pct:    float = 0.03 # 3 % total risk budget across all open
                                            # positions (sum of per-trade risk_pct)

    # ─── Pre-trade validation ──────────────────────────────────────────────
    max_spread_pips:        float = 5.0
    min_sl_distance_pips:   float = 5.0

    # ─── Persistence paths ─────────────────────────────────────────────────
    state_path:        str = 'logs/risk_state.json'
    halted_flag_path:  str = 'logs/HALTED.flag'

    # ─── Broker mode ───────────────────────────────────────────────────────
    # 'supabase' (signal-only paper mode) | 'mock' (testing) | 'mt5' (future)
    broker_mode: str = 'supabase'
