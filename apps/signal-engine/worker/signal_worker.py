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
import system_events as obs


# Drought thresholds — emit a signal_drought alarm if NO signal landed
# in the last DROUGHT_HOURS hours. Checked once per scan_all cycle.
DROUGHT_HOURS = 12


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
        # Heartbeat written EVERY cycle even when the engine is disabled
        # — so the diagnostics endpoint can answer "scheduler is firing
        # but flag X is blocking scans" instead of "no signs of life".
        obs.heartbeat('signal_worker', status='live', context={
            'dry_run':       bool(self.settings.signal_dry_run),
            'enabled':       bool(self.settings.signal_engine_enabled),
            'symbol_count':  len(self.settings.symbol_list),
            'timeframe':     self.settings.timeframe,
        })

        if not self.settings.signal_engine_enabled:
            logger.info("Signal engine disabled by config — skipping scan")
            obs.emit('engine_event', payload={
                'event': 'scan_skipped', 'reason': 'engine_disabled',
            }, status='skipped', error_class='engine_disabled')
            return

        if not self.provider():
            logger.warning("No market data provider configured — skipping scan")
            obs.health_alert('data_provider',
                             'no provider configured — universe silent')
            return

        # Refresh the institutional risk engine at the start of every cycle
        # (equity pull, rollover, drawdown checks).
        risk = self.capital_risk()
        if risk is not None:
            try:
                risk.refresh()
            except Exception as e:
                logger.critical(f"Risk refresh raised: {e}")
                obs.health_alert('risk_engine', f'refresh raised: {e!r}')

        logger.info(f"Starting scan: {self.settings.symbol_list}")
        tasks = [self.scan_symbol(sym) for sym in self.settings.symbol_list]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        errors = 0
        for sym, result in zip(self.settings.symbol_list, results):
            if isinstance(result, Exception):
                logger.error(f"Error scanning {sym}: {result}")
                obs.emit('engine_event', payload={
                    'event': 'pipeline_exception', 'symbol': sym,
                    'error': str(result)[:200],
                }, status='failed', error_class='pipeline_error')
                errors += 1

        # End-of-cycle heartbeat with summary + drought check.
        await self._end_cycle_check(errors)

    async def _end_cycle_check(self, error_count: int) -> None:
        """Run AT THE END of every scan_all. Emits a drought alarm when
        no signal has landed in the last DROUGHT_HOURS hours and
        upserts the closing heartbeat with the cycle's outcome."""
        try:
            from datetime import timedelta
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=DROUGHT_HOURS)).isoformat()
            res = (self.db().table('signals')
                   .select('id, published_at')
                   .gte('published_at', cutoff)
                   .order('published_at', desc=True)
                   .limit(1).execute())
            recent = res.data or []
            last = None
            if not recent:
                # No signals in the drought window → emit alarm.
                last_any = (self.db().table('signals')
                            .select('published_at')
                            .order('published_at', desc=True)
                            .limit(1).execute())
                if last_any.data:
                    last = last_any.data[0].get('published_at')
                obs.signal_drought(hours=float(DROUGHT_HOURS), last_at=last)
                logger.warning(
                    f"SIGNAL DROUGHT — no signals in last {DROUGHT_HOURS}h "
                    f"(last: {last or 'never'})"
                )
        except Exception as e:
            logger.debug(f"drought check failed: {e}")

        obs.heartbeat('signal_worker', status='live', context={
            'cycle_complete': True,
            'errors':         error_count,
            'dry_run':        bool(self.settings.signal_dry_run),
        })

    # ─── Inbound webhook consumer ─────────────────────────────────────────

    async def process_webhook_events(self) -> None:
        """Drain unprocessed rows from webhook_events (ingested by
        /api/v1/webhooks/{provider}). Best-effort, never raises:
          • Finnhub news → news_items (deduped by url) so the market news
            feed can surface it.
          • Any event on a symbol the engine tracks → nudge an immediate
            re-scan (breaking event → fresh scan → maybe a signal).
        Every row is marked processed=true so the queue always drains.
        """
        if not self.settings.has_supabase:
            return
        try:
            res = (self.db().table('webhook_events')
                   .select('id, provider, event_type, symbol, payload')
                   .eq('processed', False)
                   .order('received_at', desc=False)
                   .limit(100).execute())
            rows = res.data or []
        except Exception as e:
            logger.warning(f"webhook consumer: fetch failed — {e}")
            return
        if not rows:
            return

        tracked = {s.upper() for s in self.settings.symbol_list}
        nudge: set[str] = set()
        processed_ids: list[str] = []

        for r in rows:
            try:
                provider = (r.get('provider') or '').lower()
                etype    = (r.get('event_type') or '').lower()
                payload  = r.get('payload') or {}
                data     = payload.get('data') if isinstance(payload.get('data'), dict) else {}

                # Route 1 — market news → news_items (dedup by url)
                if provider == 'finnhub' and etype in ('news', 'press_release', 'press-release'):
                    url   = payload.get('url') or data.get('url')
                    title = payload.get('headline') or payload.get('title') or data.get('headline')
                    if url and title:
                        exists = (self.db().table('news_items')
                                  .select('id').eq('url', url).limit(1).execute()).data
                        if not exists:
                            self.db().table('news_items').insert({
                                'title':        str(title)[:500],
                                'url':          url,
                                'source':       'finnhub',
                                'category':     payload.get('category') or 'news',
                                'published_at': _epoch_to_iso(payload.get('datetime') or data.get('datetime')),
                            }).execute()

                # Route 2 — event on a tracked symbol → re-scan nudge
                sym = (r.get('symbol') or '').upper()
                if sym and sym in tracked:
                    nudge.add(sym)

                processed_ids.append(r['id'])
            except Exception as e:
                logger.warning(f"webhook consumer: row {r.get('id')} failed — {e}")
                processed_ids.append(r['id'])  # mark processed to avoid a poison loop

        if processed_ids:
            try:
                self.db().table('webhook_events').update(
                    {'processed': True}).in_('id', processed_ids).execute()
            except Exception as e:
                logger.warning(f"webhook consumer: mark-processed failed — {e}")

        for sym in nudge:
            try:
                await self.scan_symbol(sym)
                logger.info(f"webhook consumer: nudged re-scan of {sym}")
            except Exception:
                pass

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
            obs.signal_skipped(symbol, 'insufficient_bars', bars=len(bars))
            return

        hour_utc = datetime.now(timezone.utc).hour

        # 2. Feature engineering
        features = engineer_features(bars, hour_utc)
        if not features.valid:
            logger.debug(f"[{symbol}] Features invalid — skip")
            obs.signal_skipped(symbol, 'features_invalid')
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
            obs.emit('breaker_open', payload={
                'symbol': symbol, 'reason': breaker.reason,
            }, status='failed', error_class='breaker_open')
            obs.signal_skipped(symbol, 'breaker_open', reason=breaker.reason)
            return

        # 6. Check active signal count
        active_count = await self._count_active_signals(symbol)
        if active_count >= self.settings.max_active_per_symbol:
            logger.debug(f"[{symbol}] Already {active_count} active signal(s) — skip")
            obs.signal_skipped(symbol, 'active_cap_reached',
                               active_count=active_count,
                               max_active=self.settings.max_active_per_symbol)
            return

        # 7. Ensemble signal generation. Pass the data-completeness factor so
        #    a symbol served from stale/degraded cache contributes a dampened
        #    (never blocked) signal — prevents over-reliance on whichever asset
        #    class currently has live data.
        completeness_fn = getattr(self.provider(), 'completeness_for', None)
        data_completeness = completeness_fn(symbol, self.settings.timeframe) if completeness_fn else 1.0
        proposal = ensemble_signal(symbol, features, regime, data_completeness=data_completeness)
        if proposal is None:
            logger.debug(f"[{symbol}] No ensemble consensus — skip")
            obs.signal_rejected(symbol, 'no_ensemble_consensus',
                                regime=regime.regime.value,
                                data_completeness=round(data_completeness, 3))
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
            obs.signal_rejected(symbol, 'gate_blocked',
                                reason=gate.reason,
                                confidence=confidence.score)
            return

        # 9b. Institutional risk gate — AUTHORITATIVE capital protection layer
        risk_gate = self.risk_gate()
        if risk_gate is None:
            logger.critical(f"[{symbol}] Risk subsystem unavailable — refusing to publish")
            obs.signal_rejected(symbol, 'risk_subsystem_unavailable')
            obs.health_alert('risk_engine', 'risk_gate() returned None')
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
            obs.risk_block(symbol,
                           gates_failed=list(risk_decision.gates_failed),
                           reasons=list(risk_decision.reasons))
            # Discord transparency channel — show users that the engine
            # actively refuses trades that don't pass the gates.
            try:
                from notify_discord import notify_rejection, fire as _fire_discord
                _fire_discord(notify_rejection(
                    symbol=symbol,
                    reason=' | '.join(risk_decision.reasons),
                    gate=','.join(risk_decision.gates_failed) or 'risk_gate',
                    proposed_direction=proposal.direction,
                    proposed_entry=proposal.entry,
                ))
            except Exception as e:
                logger.warning(f"[{symbol}] Discord rejection-notify failed (non-fatal): {e}")
            return

        logger.info(
            f"[{symbol}] Risk approved: lot={risk_decision.lot_size:.4f} "
            f"risk=${risk_decision.risk_amount:.2f}"
        )

        # 9c. Dry-run gate — verify generation without publishing/executing.
        # Everything above (ensemble → confidence → gate → risk) has passed;
        # we log the would-be signal and STOP before any DB write / fan-out.
        if self.settings.signal_dry_run:
            logger.warning(
                f"[{symbol}] DRY_RUN would publish: {proposal.direction.upper()} "
                f"entry={proposal.entry} SL={proposal.stop_loss} RR={proposal.risk_reward} "
                f"conf={confidence.score}/100({confidence.tier}) regime={regime.regime.value} "
                f"lot={risk_decision.lot_size:.4f} — NOT publishing (dry-run)"
            )
            # CRITICAL OBSERVABILITY: dry-run swallows EVERY signal. If
            # production is in dry-run by mistake, the engine appears
            # silent. This emission makes the swallow visible on the
            # diagnostics endpoint.
            obs.signal_rejected(symbol, 'dry_run_swallow',
                                direction=proposal.direction,
                                confidence=confidence.score,
                                regime=regime.regime.value,
                                tier=confidence.tier)
            return

        # 10. Publish to Supabase
        signal_id = await self._publish_signal(symbol, proposal, confidence, regime, features)
        if signal_id:
            ms = int((datetime.now(timezone.utc) - t0).total_seconds() * 1000)
            logger.success(f"[{symbol}] Signal published {signal_id[:8]} in {ms}ms")
            obs.signal_generated(symbol, signal_id,
                                 direction=proposal.direction,
                                 confidence=confidence.score,
                                 regime=regime.regime.value,
                                 latency_ms=ms,
                                 tier=confidence.tier)

            # 11. WebSocket broadcast
            if self._ws_broadcast_fn:
                await self._ws_broadcast_fn(symbol, signal_id, gate.tier_required)

            # 12. Discord notification — fire-and-forget. Tier → channel
            # (free | premium | whales). Failure is logged, never raised.
            try:
                from notify_discord import notify_signal, fire as _fire_discord
                tier_label = (
                    'whales'  if confidence.tier in ('institutional', 'whale')
                    else 'premium' if confidence.tier in ('high', 'premium')
                    else 'free'
                )
                _fire_discord(notify_signal(
                    tier=tier_label,
                    symbol=symbol,
                    direction=proposal.direction,
                    entry=proposal.entry,
                    stop_loss=proposal.stop_loss,
                    take_profit_1=proposal.take_profit_1,
                    risk_reward=proposal.risk_reward,
                    confidence=confidence.score,
                    regime=regime.regime.value,
                ))
            except Exception as e:
                logger.warning(f"[{symbol}] Discord notify failed (non-fatal): {e}")

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


def _epoch_to_iso(v) -> str:
    """Finnhub sends `datetime` as epoch seconds. Coerce to ISO; fall back
    to now() for missing/odd values."""
    try:
        if isinstance(v, (int, float)) and v > 0:
            return datetime.fromtimestamp(float(v), tz=timezone.utc).isoformat()
        if isinstance(v, str) and v.isdigit():
            return datetime.fromtimestamp(int(v), tz=timezone.utc).isoformat()
    except Exception:
        pass
    return datetime.now(timezone.utc).isoformat()
