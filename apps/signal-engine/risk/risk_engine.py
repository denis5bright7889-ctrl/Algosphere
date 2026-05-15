"""
AlgoSphere Quant — Risk Engine
Equity / drawdown / cooldown tracking. Authoritative state owner.

NO other module may mutate risk state directly. All state changes go through:
  refresh()           — pulled every poll cycle from the broker
  register_open()     — after order fill
  register_close()    — after position close
  record_trade()      — after trade outcome resolved
  reset_lock()        — operator-only unlock

Capital preservation is the PRIMARY objective.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, Tuple
from loguru import logger

from .config import RiskConfig
from .risk_state import RiskState, RiskStateStore, TradeRecord
from .kill_switch import KillSwitch
from .broker_adapter import BrokerAdapter
from .sizing import asset_class, ASSET_RISK_TIERS


class RiskEngine:
    """Single source of truth for capital risk."""

    def __init__(
        self,
        broker: BrokerAdapter,
        config: RiskConfig,
        state_path: Optional[Path] = None,
        kill_flag_path: Optional[Path] = None,
    ):
        self.broker = broker
        self.config = config
        self.store        = RiskStateStore(state_path or Path(config.state_path))
        self.kill_switch  = KillSwitch(kill_flag_path or Path(config.halted_flag_path))
        self.state        = self._initialize_state()

    # ───────────────────────────────────────────────────────────────────────
    # Initialization (handles restart, account-change, broker-offline)
    # ───────────────────────────────────────────────────────────────────────

    def _initialize_state(self) -> RiskState:
        saved = self.store.load()
        current_login = self.broker.get_account_login()
        now = datetime.now(timezone.utc)

        # Account-change detection — discard stale state for a different account
        if saved and saved.account_login and saved.account_login != current_login:
            logger.warning(
                f"⚠️  Account change detected: previous={saved.account_login} → "
                f"current={current_login}. Discarding previous risk state."
            )
            saved = None

        if saved:
            logger.info(f"Restored risk state for account {current_login} "
                        f"(equity=${saved.current_equity:.2f}, locked={saved.locked})")
            # Sync exposure from broker (best-effort)
            try:
                saved.open_positions = self.broker.open_position_count()
            except Exception:
                pass
            return saved

        # Fresh state
        equity = self.broker.get_equity()
        if equity is None or equity <= 0:
            logger.warning(
                f"Broker did not return equity at startup — falling back to "
                f"config.initial_equity=${self.config.initial_equity:.2f}"
            )
            equity = self.config.initial_equity

        state = RiskState(
            account_login=current_login,
            initial_equity=equity,
            peak_equity=equity,
            current_equity=equity,
            daily_baseline_equity=equity,
            daily_baseline_date=self._today(),
            weekly_baseline_equity=equity,
            weekly_baseline_iso_week=self._iso_week(),
            last_refreshed_iso=now.isoformat(),
            last_equity_from_broker_iso=now.isoformat() if self.broker.is_connected() else None,
        )
        self.store.save(state)
        logger.info(f"Fresh risk state initialised: account={current_login} equity=${equity:.2f}")
        return state

    # ───────────────────────────────────────────────────────────────────────
    # Refresh — call this every poll cycle
    # ───────────────────────────────────────────────────────────────────────

    def refresh(self) -> None:
        """
        Pull latest equity from broker, roll daily/weekly baselines, evaluate
        drawdown limits, and persist state. Broker offline → degrade safely.
        """
        now = datetime.now(timezone.utc)

        # 1) Pull equity from broker — never zero out on disconnect
        try:
            equity = self.broker.get_equity()
        except Exception as e:
            logger.warning(f"Broker.get_equity raised: {e} — using cached")
            equity = None

        if equity is not None and equity > 0:
            self.state.current_equity = equity
            self.state.last_equity_from_broker_iso = now.isoformat()
            if equity > self.state.peak_equity:
                self.state.peak_equity = equity
        else:
            # Broker offline — DO NOT touch current_equity. Just log.
            if self.broker.is_connected() is False:
                logger.debug("Broker offline — preserving cached equity")

        # 2) Daily / weekly rollover
        self._check_rollover()

        # 3) Update derived P&L counters
        self.state.daily_pnl  = self.state.current_equity - self.state.daily_baseline_equity
        self.state.weekly_pnl = self.state.current_equity - self.state.weekly_baseline_equity

        # 4) Cooldown expiry
        if self.state.cooldown_until_iso:
            try:
                end = datetime.fromisoformat(self.state.cooldown_until_iso)
                if now >= end:
                    self.state.cooldown_until_iso = None
                    logger.info("Cooldown / halt expired — trading re-enabled (gates permitting)")
            except Exception:
                self.state.cooldown_until_iso = None

        # 5) Honour any externally-set HALTED.flag
        if self.kill_switch.is_active() and not self.state.locked:
            reason_payload = self.kill_switch.reason() or {}
            self.state.locked        = True
            self.state.locked_reason = reason_payload.get('reason', 'HALTED.flag detected')
            self.state.locked_at_iso = now.isoformat()
            logger.critical(f"Engine locked from external HALTED.flag: {self.state.locked_reason}")

        # 6) Drawdown gates — may fire kill switch
        self._enforce_drawdown_limits()

        self.state.last_refreshed_iso = now.isoformat()
        self.store.save(self.state)

    # ───────────────────────────────────────────────────────────────────────
    # Rollover
    # ───────────────────────────────────────────────────────────────────────

    def _check_rollover(self) -> None:
        today = self._today()
        week  = self._iso_week()

        if self.state.daily_baseline_date != today:
            logger.info(f"📅 Daily rollover: {self.state.daily_baseline_date or '(init)'} → {today}")
            self.state.daily_baseline_equity = self.state.current_equity
            self.state.daily_baseline_date   = today
            self.state.daily_pnl             = 0.0

        if self.state.weekly_baseline_iso_week != week:
            logger.info(f"📅 Weekly rollover: {self.state.weekly_baseline_iso_week or '(init)'} → {week}")
            self.state.weekly_baseline_equity   = self.state.current_equity
            self.state.weekly_baseline_iso_week = week
            self.state.weekly_pnl               = 0.0

    # ───────────────────────────────────────────────────────────────────────
    # Drawdown enforcement
    # ───────────────────────────────────────────────────────────────────────

    def _enforce_drawdown_limits(self) -> None:
        if self.state.locked:
            return

        total_dd = self.total_drawdown_pct()
        if total_dd >= self.config.max_total_drawdown_pct:
            self._fire_kill(
                f"Total DD breach: {total_dd:.2%} >= max {self.config.max_total_drawdown_pct:.2%}"
            )
            return

        daily_dd = self.daily_drawdown_pct()
        if daily_dd >= self.config.daily_loss_limit_pct:
            self._halt_until_midnight(f"Daily DD breach: {daily_dd:.2%}")
            return

        weekly_dd = self.weekly_drawdown_pct()
        if weekly_dd >= self.config.weekly_loss_limit_pct:
            self._halt_until_next_monday(f"Weekly DD breach: {weekly_dd:.2%}")

    def total_drawdown_pct(self) -> float:
        if self.state.peak_equity <= 0:
            return 0.0
        return max(0.0, (self.state.peak_equity - self.state.current_equity) / self.state.peak_equity)

    def daily_drawdown_pct(self) -> float:
        if self.state.daily_baseline_equity <= 0:
            return 0.0
        loss = max(0.0, self.state.daily_baseline_equity - self.state.current_equity)
        return loss / self.state.daily_baseline_equity

    def weekly_drawdown_pct(self) -> float:
        if self.state.weekly_baseline_equity <= 0:
            return 0.0
        loss = max(0.0, self.state.weekly_baseline_equity - self.state.current_equity)
        return loss / self.state.weekly_baseline_equity

    # ───────────────────────────────────────────────────────────────────────
    # Halt / kill
    # ───────────────────────────────────────────────────────────────────────

    def _halt_until_midnight(self, reason: str) -> None:
        midnight = datetime.now(timezone.utc).replace(
            hour=23, minute=59, second=59, microsecond=0
        )
        self.state.cooldown_until_iso = midnight.isoformat()
        logger.error(f"⛔ DAILY HALT: {reason} — blocked until {midnight.isoformat()}")
        self.store.save(self.state)

    def _halt_until_next_monday(self, reason: str) -> None:
        now = datetime.now(timezone.utc)
        days = (7 - now.weekday()) % 7 or 7   # never 0 — always at least to next Monday
        nxt = (now + timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
        self.state.cooldown_until_iso = nxt.isoformat()
        logger.error(f"⛔ WEEKLY HALT: {reason} — blocked until {nxt.isoformat()}")
        self.store.save(self.state)

    def _fire_kill(self, reason: str) -> None:
        """Catastrophic breach — flatten positions, lock permanently."""
        logger.critical(f"🚨 KILL SWITCH FIRING: {reason}")

        try:
            n = self.broker.close_all_positions()
            logger.critical(f"🚨 Flattened {n} broker position(s)")
        except Exception as e:
            logger.critical(f"🚨 Failed to flatten positions: {e}")

        self.kill_switch.trigger(reason)
        self.state.locked        = True
        self.state.locked_reason = reason
        self.state.locked_at_iso = datetime.now(timezone.utc).isoformat()
        self.state.open_positions = 0
        self.store.save(self.state)

    # ───────────────────────────────────────────────────────────────────────
    # Trade lifecycle hooks
    # ───────────────────────────────────────────────────────────────────────

    def register_open(self) -> None:
        self.state.open_positions += 1
        self.store.save(self.state)

    def register_close(self) -> None:
        self.state.open_positions = max(0, self.state.open_positions - 1)
        self.store.save(self.state)

    def record_trade(self, was_win: bool, pnl: float = 0.0, symbol: str = '') -> None:
        """Called after every closed trade. Updates streaks and may fire cooldown / kill."""
        now_iso = datetime.now(timezone.utc).isoformat()
        record = TradeRecord(timestamp=now_iso, symbol=symbol, was_win=was_win, pnl=pnl)
        self.state.trade_history.append(record)
        self.state.trade_history = self.state.trade_history[-50:]

        if was_win:
            self.state.consecutive_wins  += 1
            self.state.consecutive_losses = 0
        else:
            self.state.consecutive_losses += 1
            self.state.consecutive_wins   = 0

            # Soft cooldown
            if self.state.consecutive_losses >= self.config.cooldown_consecutive_losses \
               and self.state.consecutive_losses < self.config.max_consecutive_losses:
                until = datetime.now(timezone.utc) + timedelta(minutes=self.config.cooldown_minutes)
                self.state.cooldown_until_iso = until.isoformat()
                logger.warning(
                    f"❄️  Cooldown activated after {self.state.consecutive_losses} losses — "
                    f"resumes at {until.isoformat()}"
                )

            # Hard breaker → kill switch
            if self.state.consecutive_losses >= self.config.max_consecutive_losses:
                self._fire_kill(f"Max consecutive losses reached: {self.state.consecutive_losses}")

        self.store.save(self.state)

    # ───────────────────────────────────────────────────────────────────────
    # Sizing — equity-aware, asset-class-aware, adaptive
    # ───────────────────────────────────────────────────────────────────────

    def calculate_lot(
        self,
        symbol: str,
        stop_loss_distance_price: float,
    ) -> Tuple[float, dict]:
        """
        Compute the lot size for a trade.

        Returns (lot, metadata). lot == 0 means SIZING REJECTED — the metadata
        carries the reason. Never returns a lot above broker max_lot.
        """
        meta: dict = {
            'asset_class':         None,
            'class_multiplier':    None,
            'adaptive_multiplier': None,
            'risk_pct':            None,
            'risk_amount':         None,
            'raw_lot':             None,
            'rounded_lot':         None,
            'micro_account_mode':  False,
            'reason':              None,
        }

        spec = self.broker.get_symbol_spec(symbol)
        if not spec:
            meta['reason'] = f"No broker spec for {symbol}"
            return 0.0, meta

        if stop_loss_distance_price <= 0:
            meta['reason'] = "Invalid SL distance (<=0)"
            return 0.0, meta

        equity = self.state.current_equity
        if equity <= 0:
            meta['reason'] = "Zero / negative equity"
            return 0.0, meta

        klass = asset_class(symbol)
        class_mult     = ASSET_RISK_TIERS.get(klass, 1.0)
        adaptive_mult  = self._adaptive_multiplier()

        risk_pct    = self.config.risk_per_trade_pct * class_mult * adaptive_mult
        risk_amount = equity * risk_pct

        ticks = stop_loss_distance_price / spec.tick_size
        if ticks <= 0 or spec.tick_value <= 0:
            meta['reason'] = "Invalid tick math"
            return 0.0, meta

        raw_lot = risk_amount / (ticks * spec.tick_value)

        # Round DOWN to lot step (never round up the size)
        steps = int(raw_lot / spec.lot_step) if spec.lot_step > 0 else 0
        lot   = max(0.0, min(steps * spec.lot_step, spec.max_lot))

        meta.update({
            'asset_class':         klass,
            'class_multiplier':    class_mult,
            'adaptive_multiplier': adaptive_mult,
            'risk_pct':            risk_pct,
            'risk_amount':         risk_amount,
            'raw_lot':             raw_lot,
            'rounded_lot':         lot,
        })

        # Micro-account guard — do NOT blindly force min_lot
        if lot < spec.min_lot:
            effective_risk = spec.min_lot * ticks * spec.tick_value
            effective_pct  = effective_risk / equity
            meta['effective_risk_pct'] = effective_pct

            if effective_pct <= self.config.max_effective_risk_pct:
                lot = spec.min_lot
                meta['micro_account_mode'] = True
                meta['rounded_lot']        = lot
            else:
                meta['reason'] = (
                    f"Micro-account guard: min_lot={spec.min_lot} would risk "
                    f"{effective_pct:.2%} > cap {self.config.max_effective_risk_pct:.2%}"
                )
                return 0.0, meta

        return lot, meta

    def _adaptive_multiplier(self) -> float:
        """
        Adaptive risk scaling:
          - heavy DD → halve
          - moderate DD → 0.75
          - loss streak → 0.7
          - win streak → boost up to max_lot_multiplier
        """
        dd = self.total_drawdown_pct()
        if dd > 0.10:
            return 0.5
        if dd > 0.05:
            return 0.75

        if self.state.consecutive_losses >= 2:
            return 0.7

        if self.state.consecutive_wins >= 3:
            boost = 1.0 + 0.10 * (self.state.consecutive_wins - 2)
            return min(boost, self.config.max_lot_multiplier)

        return 1.0

    # ───────────────────────────────────────────────────────────────────────
    # Status queries
    # ───────────────────────────────────────────────────────────────────────

    def is_locked(self) -> bool:
        return self.state.locked or self.kill_switch.is_active()

    def is_cooldown_active(self) -> bool:
        if not self.state.cooldown_until_iso:
            return False
        try:
            return datetime.fromisoformat(self.state.cooldown_until_iso) > datetime.now(timezone.utc)
        except Exception:
            return False

    # ───────────────────────────────────────────────────────────────────────
    # Operator-only manual unlock
    # ───────────────────────────────────────────────────────────────────────

    def reset_lock(self, operator: str) -> bool:
        if not self.kill_switch.reset(operator):
            return False
        self.state.locked         = False
        self.state.locked_reason  = ''
        self.state.locked_at_iso  = None
        # Do not zero the loss streak silently — operator must accept that risk
        self.state.cooldown_until_iso = None
        self.store.save(self.state)
        logger.warning(f"✅ RISK ENGINE UNLOCKED by operator={operator}")
        return True

    # ───────────────────────────────────────────────────────────────────────
    # Telemetry for dashboard
    # ───────────────────────────────────────────────────────────────────────

    def telemetry(self) -> dict:
        if self.is_locked():
            state_label = 'LOCKED'
        elif self.is_cooldown_active():
            state_label = 'COOLDOWN'
        else:
            state_label = 'ACTIVE'

        return {
            'state':                state_label,
            'account_login':        self.state.account_login,
            'current_equity':       round(self.state.current_equity, 2),
            'peak_equity':          round(self.state.peak_equity, 2),
            'initial_equity':       round(self.state.initial_equity, 2),
            'total_drawdown_pct':   round(self.total_drawdown_pct() * 100, 2),
            'daily_drawdown_pct':   round(self.daily_drawdown_pct() * 100, 2),
            'weekly_drawdown_pct':  round(self.weekly_drawdown_pct() * 100, 2),
            'daily_pnl':            round(self.state.daily_pnl, 2),
            'weekly_pnl':           round(self.state.weekly_pnl, 2),
            'consecutive_wins':     self.state.consecutive_wins,
            'consecutive_losses':   self.state.consecutive_losses,
            'cooldown_until':       self.state.cooldown_until_iso,
            'locked':               self.state.locked,
            'locked_reason':        self.state.locked_reason,
            'open_positions':       self.state.open_positions,
            'kill_switch_active':   self.kill_switch.is_active(),
            'adaptive_multiplier':  round(self._adaptive_multiplier(), 2),
            'broker_connected':     self.broker.is_connected(),
            'last_refreshed':       self.state.last_refreshed_iso,
            'last_broker_sync':     self.state.last_equity_from_broker_iso,
            'limits': {
                'daily_loss_limit_pct':     self.config.daily_loss_limit_pct,
                'weekly_loss_limit_pct':    self.config.weekly_loss_limit_pct,
                'max_total_drawdown_pct':   self.config.max_total_drawdown_pct,
                'max_consecutive_losses':   self.config.max_consecutive_losses,
                'max_open_positions':       self.config.max_open_positions,
            },
        }

    # ───────────────────────────────────────────────────────────────────────
    # Helpers
    # ───────────────────────────────────────────────────────────────────────

    @staticmethod
    def _today() -> str:
        return datetime.now(timezone.utc).strftime('%Y-%m-%d')

    @staticmethod
    def _iso_week() -> str:
        now = datetime.now(timezone.utc)
        year, week, _ = now.isocalendar()
        return f"{year}-W{week:02d}"
