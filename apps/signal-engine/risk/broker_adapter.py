"""
AlgoSphere Quant — Broker Adapter
Abstract interface that decouples the risk engine from any specific broker.

Provided implementations:
  - MockBroker      — for tests; full control over returned values
  - SupabaseBroker  — signal-only paper-account mode; equity derived from
                      published-signal P&L history in Supabase
  - MT5Broker       — stub for Phase 2 (live execution)
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
from loguru import logger


# ─── Symbol specification ─────────────────────────────────────────────────────

@dataclass
class SymbolSpec:
    """Broker-side specification for a tradable instrument."""
    symbol:        str
    tick_size:     float    # smallest price increment
    tick_value:    float    # USD value per tick per 1.0 lot
    min_lot:       float
    max_lot:       float
    lot_step:      float
    contract_size: float
    digits:        int = 5


# Conservative defaults — used by SupabaseBroker (paper mode) when no
# real broker spec is available. Numbers chosen to be representative of
# typical retail forex/CFD brokers.
_DEFAULT_SPECS: dict[str, SymbolSpec] = {
    'XAUUSD': SymbolSpec('XAUUSD', 0.01, 1.0,  0.01, 100.0, 0.01, 100,    2),
    'XAGUSD': SymbolSpec('XAGUSD', 0.001, 5.0, 0.01, 100.0, 0.01, 5000,   3),
    'BTCUSD': SymbolSpec('BTCUSD', 0.1,  0.1,  0.01, 10.0,  0.01, 1,      1),
    'ETHUSD': SymbolSpec('ETHUSD', 0.01, 0.1,  0.01, 10.0,  0.01, 1,      2),
    'US30':   SymbolSpec('US30',   1.0,  1.0,  0.1,  100.0, 0.1,  1,      1),
    'NAS100': SymbolSpec('NAS100', 1.0,  1.0,  0.1,  100.0, 0.1,  1,      1),
    'SPX500': SymbolSpec('SPX500', 0.1,  1.0,  0.1,  100.0, 0.1,  1,      2),
}


def default_spec(symbol: str) -> SymbolSpec:
    s = symbol.upper()
    if s in _DEFAULT_SPECS:
        return _DEFAULT_SPECS[s]
    if s.endswith('JPY'):
        return SymbolSpec(s, 0.001, 0.91, 0.01, 100.0, 0.01, 100_000, 3)
    # Default forex
    return SymbolSpec(s, 0.00001, 1.0, 0.01, 100.0, 0.01, 100_000, 5)


# ─── Abstract broker ──────────────────────────────────────────────────────────

class BrokerAdapter(ABC):
    """
    Abstract broker interface. All broker integrations must implement these
    methods. None of them may raise — broker errors should be returned as
    None / 0 so the risk engine can degrade gracefully.
    """

    @abstractmethod
    def get_account_login(self) -> str: ...

    @abstractmethod
    def is_connected(self) -> bool: ...

    @abstractmethod
    def get_equity(self) -> Optional[float]: ...

    @abstractmethod
    def get_balance(self) -> Optional[float]: ...

    @abstractmethod
    def get_symbol_spec(self, symbol: str) -> Optional[SymbolSpec]: ...

    @abstractmethod
    def get_spread_pips(self, symbol: str) -> Optional[float]: ...

    @abstractmethod
    def close_all_positions(self) -> int: ...

    @abstractmethod
    def open_position_count(self) -> int: ...


# ─── MockBroker — for tests ──────────────────────────────────────────────────

class MockBroker(BrokerAdapter):
    """Deterministic broker for unit tests."""

    def __init__(self, login: str = 'mock_001', equity: float = 10_000.0,
                 balance: Optional[float] = None):
        self.login     = login
        self.equity    = equity
        self.balance   = balance if balance is not None else equity
        self.connected = True
        self._open_positions = 0
        self._closed_positions = 0
        self._specs:   dict[str, SymbolSpec] = {}
        self._spreads: dict[str, float] = {}

    # — helpers for tests —
    def set_equity(self, value: float) -> None:        self.equity = value
    def set_connected(self, on: bool) -> None:         self.connected = on
    def set_spec(self, symbol: str, spec: SymbolSpec): self._specs[symbol] = spec
    def set_spread(self, symbol: str, pips: float):    self._spreads[symbol] = pips
    def add_open_position(self, n: int = 1):           self._open_positions += n

    # — interface —
    def get_account_login(self) -> str:           return self.login
    def is_connected(self) -> bool:               return self.connected
    def get_equity(self) -> Optional[float]:      return self.equity if self.connected else None
    def get_balance(self) -> Optional[float]:     return self.balance if self.connected else None

    def get_symbol_spec(self, symbol: str) -> Optional[SymbolSpec]:
        return self._specs.get(symbol, default_spec(symbol))

    def get_spread_pips(self, symbol: str) -> Optional[float]:
        return self._spreads.get(symbol)

    def close_all_positions(self) -> int:
        n = self._open_positions
        self._closed_positions += n
        self._open_positions = 0
        return n

    def open_position_count(self) -> int:
        return self._open_positions


# ─── SupabaseBroker — signal-only paper mode ─────────────────────────────────

class SupabaseBroker(BrokerAdapter):
    """
    Paper-account broker derived from Supabase signal history.

    Equity model:
        equity = starting_balance + sum(pips_gained * usd_per_pip) for closed signals

    Open positions = signals in lifecycle_state='active'.
    close_all_positions() invalidates all active engine signals.
    """

    USD_PER_PIP_PROXY = 10.0   # approximate $10/pip on 1 lot — fine for paper

    def __init__(self, db, starting_balance: float = 10_000.0,
                 login: str = 'algosphere_paper'):
        self.db = db
        self.starting = starting_balance
        self.login    = login
        self._last_equity_cache: Optional[float] = None

    def get_account_login(self) -> str:
        return self.login

    def is_connected(self) -> bool:
        # Supabase is the data plane — assume connected. Real failures surface as None below.
        return True

    def get_equity(self) -> Optional[float]:
        try:
            result = (
                self.db.table('signals')
                .select('pips_gained,result')
                .eq('engine_version', 'algo_v1')
                .not_.is_('result', 'null')
                .execute()
            )
            pnl = 0.0
            for row in result.data or []:
                pips = row.get('pips_gained') or 0
                pnl += pips * self.USD_PER_PIP_PROXY
            equity = self.starting + pnl
            self._last_equity_cache = equity
            return equity
        except Exception as e:
            logger.warning(f"SupabaseBroker.get_equity failed: {e} — returning cached")
            return self._last_equity_cache

    def get_balance(self) -> Optional[float]:
        return self.get_equity()

    def get_symbol_spec(self, symbol: str) -> Optional[SymbolSpec]:
        return default_spec(symbol)

    def get_spread_pips(self, symbol: str) -> Optional[float]:
        # Without a live feed we assume a baseline that is realistic for majors
        return 2.0

    def close_all_positions(self) -> int:
        try:
            result = (
                self.db.table('signals')
                .update({
                    'lifecycle_state': 'invalidated',
                    'status':          'closed',
                })
                .eq('engine_version', 'algo_v1')
                .eq('lifecycle_state', 'active')
                .execute()
            )
            n = len(result.data or [])
            logger.warning(f"SupabaseBroker: invalidated {n} active signal(s) as 'close_all'")
            return n
        except Exception as e:
            logger.error(f"SupabaseBroker.close_all_positions failed: {e}")
            return 0

    def open_position_count(self) -> int:
        try:
            result = (
                self.db.table('signals')
                .select('id', count='exact')
                .eq('engine_version', 'algo_v1')
                .eq('lifecycle_state', 'active')
                .execute()
            )
            return result.count or 0
        except Exception:
            return 0


# ─── MT5Broker — Phase 2 stub ────────────────────────────────────────────────

class MT5Broker(BrokerAdapter):
    """
    Stub for live execution via MetaTrader 5. Wire MetaTrader5 SDK calls here
    when the execution layer is built. All methods currently raise
    NotImplementedError to make accidental use loud.
    """

    def __init__(self, *args, **kwargs):
        raise NotImplementedError(
            "MT5Broker is a Phase 2 stub. AlgoSphere is signal-only today — "
            "use SupabaseBroker. Wire MetaTrader5 here when execution comes online."
        )

    def get_account_login(self):       raise NotImplementedError
    def is_connected(self):            raise NotImplementedError
    def get_equity(self):              raise NotImplementedError
    def get_balance(self):             raise NotImplementedError
    def get_symbol_spec(self, s):      raise NotImplementedError
    def get_spread_pips(self, s):      raise NotImplementedError
    def close_all_positions(self):     raise NotImplementedError
    def open_position_count(self):     raise NotImplementedError
