"""
AlgoSphere Signal Pipeline Worker
Full async pipeline: OHLCV → features → regime → signal → confidence → gate → publish
Runs on APScheduler. Each symbol is isolated and fault-tolerant.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from typing import Optional
from loguru import logger
from supabase import create_client, Client

from config import get_settings
from engine.feature_engineer import engineer_features, OHLCVBar
from engine.regime_engine import classify_regime
from engine.signal_engine import ensemble_signal
from engine.confidence_engine import score_confidence, tier_to_subscription
from engine.signal_gate import RiskEngine, gate_signal, CircuitBreakerState
from data.market_data import FallbackDataProvider, build_provider
from risk import RiskConfig, RiskEngine as InstitutionalRiskEngine, RiskGate, SupabaseBroker


class SignalWorker:
    """
    Orchestrates the full signal pipeline for all configured symbols.
    Designed to run as a background APScheduler job.
    """

    def __init__(self):
        self.settings = get_settings()
        self._db: Optional[Client] = None
        self._provider: Optional[FallbackDataProvider] = None
        self._risk_engine = RiskEngine(
            max_consecutive_losses=self.settings.max_consecutive_losses,
            daily_loss_cap=self.settings.daily_loss_cap,
        )
        self._ws_broadcast_fn = None  # injected by websocket manager

        # ─── Institutional risk subsystem ─────────────────────────────────
        # Single source of truth for capital risk. No signal may publish
        # without first passing RiskGate.approve_trade().
        self._risk_config: Optional[RiskConfig] = None
        self._capital_risk: Optional[InstitutionalRiskEngine] = None
        self._risk_gate:   Optional[RiskGate] = None

    def set_ws_broadcaster(self, fn) -> None:
        """Inject WebSocket broadcast callback."""
        self._ws_broadcast_fn = fn

    def db(self) -> Client:
        if self._db is None:
            self._db = create_client(
                self.settings.supabase_url,
                self.settings.supabase_service_role_key,
            )
        return self._db

    def provider(self) -> Optional[FallbackDataProvider]:
        if self._provider is None:
            self._provider = build_provider(self.settings)
        return self._provider

    # ─── Institutional risk subsystem (lazy init) ─────────────────────────

    def risk_gate(self) -> Optional[RiskGate]:
        if self._risk_gate is None:
            try:
                self._risk_config  = RiskConfig()
                broker             = SupabaseBroker(
                    self.db(),
                    starting_balance=self._risk_config.starting_balance,
                )
                self._capital_risk = InstitutionalRiskEngine(broker, self._risk_config)
                self._risk_gate    = RiskGate(self._capital_risk, self._risk_config)
                logger.info("Institutional risk subsystem initialised")
            except Exception as e:
                logger.critical(f"Failed to init risk subsystem: {e}")
                return None
        return self._risk_gate

    def capital_risk(self) -> Optional[InstitutionalRiskEngine]:
        """Direct access to the capital risk engine for telemetry / operator actions."""
        self.risk_gate()   # lazy-init
        return self._capital_risk

    # ─── Main scan job ────────────────────────────────────────────────────

    async def scan_all(self) -> None:
        """Scan all configured symbols concurrently."""
        if not self.settings.signal_engine_enabled:
            logger.info("Signal engine disabled by config — skipping scan")
            return

        if not self.provider():
            logger.warning("No market data provider configured — skipping scan")
            return

        # Refresh the institutional risk engine at the start of every cycle
        # (equity pull, rollover, drawdown checks).
        risk = self.capital_risk()
        if risk is not None:
            try:
                risk.refresh()
            except Exception as e:
                logger.critical(f"Risk refresh raised: {e}")

        logger.info(f"Starting scan: {self.settings.symbol_list}")
        tasks = [self.scan_symbol(sym) for sym in self.settings.symbol_list]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for sym, result in zip(self.settings.symbol_list, results):
            if isinstance(result, Exception):
                logger.error(f"Error scanning {sym}: {result}")

    async def scan_symbol(self, symbol: str) -> None:
        """Run the full pipeline for a single symbol. Never raises."""
        try:
            await self._pipeline(symbol)
        except Exception as e:
            logger.error(f"Pipeline failed for {symbol}: {e}")

    # ─── Full pipeline ────────────────────────────────────────────────────

    async def _pipeline(self, symbol: str) -> None:
        t0 = datetime.now(timezone.utc)
        logger.debug(f"[{symbol}] Pipeline start")

        # 1. Fetch OHLCV
        bars: list[OHLCVBar] = await self.provider().fetch_ohlcv(
            symbol, self.settings.timeframe, outputsize=300
        )
        if len(bars) < 50:
            logger.warning(f"[{symbol}] Insufficient bars ({len(bars)}) — skip")
            return

        hour_utc = datetime.now(timezone.utc).hour

        # 2. Feature engineering
        features = engineer_features(bars, hour_utc)
        if not features.valid:
            logger.debug(f"[{symbol}] Features invalid — skip")
            return

        # 3. Regime classification
        regime = classify_regime(features)
        logger.debug(f"[{symbol}] Regime: {regime.regime.value} ({regime.description})")

        # 4. Persist regime snapshot (non-blocking)
        asyncio.create_task(self._save_regime(symbol, features, regime))

        # 5. Circuit breaker check
        breaker = self._risk_engine.get_state(symbol)
        if breaker.is_open:
            logger.info(f"[{symbol}] Circuit breaker OPEN: {breaker.reason}")
            return

        # 6. Check active signal count
        active_count = await self._count_active_signals(symbol)
        if active_count >= self.settings.max_active_per_symbol:
            logger.debug(f"[{symbol}] Already {active_count} active signal(s) — skip")
            return

        # 7. Ensemble signal generation
        proposal = ensemble_signal(symbol, features, regime)
        if proposal is None:
            logger.debug(f"[{symbol}] No ensemble consensus — skip")
            return

        logger.info(f"[{symbol}] Proposal: {proposal.direction.upper()} "
                    f"RR={proposal.risk_reward} strategies={proposal.strategies_voted}")

        # 8. Confidence scoring
        spread = await self.provider().get_spread(symbol)
        confidence = score_confidence(features, regime, proposal, spread_pips=spread)

        logger.info(f"[{symbol}] Confidence: {confidence.score}/100 ({confidence.tier})")

        # 9. Signal gate
        gate = gate_signal(
            proposal=proposal,
            confidence=confidence,
            regime=regime,
            breaker=breaker,
            active_signal_count=active_count,
            max_active=self.settings.max_active_per_symbol,
        )

        if not gate.approved:
            logger.info(f"[{symbol}] Gate BLOCKED: {gate.reason}")
            return

        # 9b. Institutional risk gate — AUTHORITATIVE capital protection layer
        risk_gate = self.risk_gate()
        if risk_gate is None:
            logger.critical(f"[{symbol}] Risk subsystem unavailable — refusing to publish")
            return

        risk_decision = risk_gate.approve_trade(
            symbol=symbol,
            direction=proposal.direction,
            entry_price=proposal.entry,
            stop_loss_price=proposal.stop_loss,
            spread_pips=spread,
        )
        if not risk_decision.approved:
            logger.warning(
                f"[{symbol}] RISK GATE BLOCKED: failed=[{','.join(risk_decision.gates_failed)}] "
                f"reasons=[{' | '.join(risk_decision.reasons)}]"
            )
            return

        logger.info(
            f"[{symbol}] Risk approved: lot={risk_decision.lot_size:.4f} "
            f"risk=${risk_decision.risk_amount:.2f}"
        )

        # 10. Publish to Supabase
        signal_id = await self._publish_signal(symbol, proposal, confidence, regime, features)
        if signal_id:
            ms = int((datetime.now(timezone.utc) - t0).total_seconds() * 1000)
            logger.success(f"[{symbol}] Signal published {signal_id[:8]} in {ms}ms")

            # 11. WebSocket broadcast
            if self._ws_broadcast_fn:
                await self._ws_broadcast_fn(symbol, signal_id, gate.tier_required)

    # ─── Database operations ──────────────────────────────────────────────

    async def _publish_signal(
        self, symbol, proposal, confidence, regime, features
    ) -> Optional[str]:
        """Insert signal into Supabase signals table (preserves all existing fields)."""
        try:
            payload = {
                'pair':           symbol,
                'direction':      proposal.direction,
                'entry_price':    proposal.entry,
                'stop_loss':      proposal.stop_loss,
                'take_profit_1':  proposal.take_profit_1,
                'take_profit_2':  proposal.take_profit_2,
                'take_profit_3':  proposal.take_profit_3,
                'risk_reward':    proposal.risk_reward,
                'status':         'active',
                'lifecycle_state': 'active',
                'tier_required':  tier_to_subscription(confidence.tier),
                'confidence_score': confidence.score,
                'regime':         regime.regime.value,
                'engine_version': 'algo_v1',
                'der_score':      round(features.der, 4),
                'entropy_score':  round(features.entropy, 4),
                'feature_snapshot': {
                    'ema9': features.ema9,
                    'ema21': features.ema21,
                    'ema50': features.ema50,
                    'ema200': features.ema200,
                    'rsi14': round(features.rsi14, 2),
                    'atr14': round(features.atr14, 5),
                    'atr_pct': round(features.atr_pct, 4),
                    'macd_histogram': round(features.macd_histogram, 5),
                    'bb_pct_b': round(features.bb_pct_b, 3),
                    'strategies': proposal.strategies_voted,
                    'confidence_breakdown': {
                        'ema_alignment':  confidence.breakdown.ema_alignment,
                        'rsi_momentum':   confidence.breakdown.rsi_momentum,
                        'macd_alignment': confidence.breakdown.macd_alignment,
                        'session':        confidence.breakdown.session_quality,
                        'regime':         confidence.breakdown.regime_quality,
                    },
                },
            }
            result = self.db().table('signals').insert(payload).execute()
            if result.data:
                return result.data[0]['id']
        except Exception as e:
            logger.error(f"Failed to publish signal for {symbol}: {e}")
        return None

    async def _save_regime(self, symbol, features, regime) -> None:
        try:
            self.db().table('regime_snapshots').insert({
                'symbol':       symbol,
                'timeframe':    self.settings.timeframe,
                'regime':       regime.regime.value,
                'der_score':    round(features.der, 4),
                'entropy_score': round(features.entropy, 4),
                'autocorr_score': round(features.autocorr, 4),
                'atr_pct':      round(features.atr_pct, 4),
                'session':      _current_session(features),
                'scanned_at':   datetime.now(timezone.utc).isoformat(),
            }).execute()
        except Exception as e:
            logger.warning(f"Failed to save regime snapshot: {e}")

        # Broadcast regime update over WebSocket (best-effort)
        try:
            from websocket.manager import ws_manager
            await ws_manager.broadcast_regime(
                symbol=symbol,
                regime=regime.regime.value,
                score=round(features.der, 4),
            )
        except Exception:
            pass

    async def _count_active_signals(self, symbol: str) -> int:
        try:
            result = self.db().table('signals') \
                .select('id', count='exact') \
                .eq('pair', symbol) \
                .eq('lifecycle_state', 'active') \
                .execute()
            return result.count or 0
        except Exception:
            return 0

    def record_outcome(self, symbol: str, was_win: bool, pnl: float = 0.0) -> None:
        """Called when a signal closes — updates BOTH the strategy circuit breaker
        and the institutional risk engine."""
        self._risk_engine.record_outcome(symbol, was_win)
        risk = self.capital_risk()
        if risk is not None:
            try:
                risk.record_trade(was_win=was_win, pnl=pnl, symbol=symbol)
            except Exception as e:
                logger.error(f"capital_risk.record_trade failed: {e}")


def _current_session(features) -> str:
    if features.is_london_ny: return 'london_ny'
    if features.is_london:    return 'london'
    if features.is_new_york:  return 'new_york'
    if features.is_asian:     return 'asian'
    return 'off_hours'
