"""
AlgoSphere Quant — Institutional Risk Management Subsystem

The single source of truth for capital protection. No trade may be approved
without passing through RiskGate.approve_trade().

Architecture:
    RiskConfig      — operator-tunable thresholds (env-driven)
    RiskState       — persistent dataclass (JSON-backed)
    KillSwitch      — file-based HALTED.flag controller
    BrokerAdapter   — abstract interface (MockBroker, SupabaseBroker, MT5Broker stub)
    RiskEngine      — equity/drawdown/cooldown tracking + sizing
    RiskGate        — 12-gate institutional pre-trade validator

Capital preservation is the PRIMARY objective. Profitability is secondary.
"""
from .config import RiskConfig
from .risk_state import RiskState, TradeRecord, RiskStateStore
from .kill_switch import KillSwitch
from .broker_adapter import BrokerAdapter, SymbolSpec, MockBroker, SupabaseBroker
from .risk_engine import RiskEngine
from .risk_gate import RiskGate, GateDecision

__all__ = [
    'RiskConfig',
    'RiskState',
    'TradeRecord',
    'RiskStateStore',
    'KillSwitch',
    'BrokerAdapter',
    'SymbolSpec',
    'MockBroker',
    'SupabaseBroker',
    'RiskEngine',
    'RiskGate',
    'GateDecision',
]
