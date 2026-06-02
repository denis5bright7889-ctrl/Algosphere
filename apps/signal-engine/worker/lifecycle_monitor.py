"""
AlgoSphere Signal Lifecycle Monitor
Polls active signals and auto-transitions state when TP/SL levels are hit.
Runs as a scheduled APScheduler job alongside the main scan.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from typing import Optional
from loguru import logger
from supabase import create_client, Client

from config import get_settings
import system_events as obs


TERMINAL_STATES = {'tp1_hit', 'tp2_hit', 'tp3_hit', 'stopped', 'breakeven', 'invalidated', 'expired'}

# Seconds without a price update before a signal is marked expired
SIGNAL_EXPIRY_HOURS = 24


class LifecycleMonitor:
    """
    Monitors open signals from Supabase and auto-advances lifecycle state
    when take-profit or stop-loss levels are breached by the live price.
    """

    def __init__(self, provider=None):
        self.settings = get_settings()
        self._db: Optional[Client] = None
        self._provider = provider   # FallbackDataProvider injected by main

    def db(self) -> Client:
        if self._db is None:
            self._db = create_client(
                self.settings.supabase_url,
                self.settings.supabase_service_role_key,
            )
        return self._db

    # ─── Main loop ────────────────────────────────────────────────────────────

    async def check_all(self) -> None:
        """Fetch all active engine signals and check their levels."""
        # Heartbeat upfront so the diagnostics endpoint can answer
        # "is the lifecycle monitor actually firing?" — the bug that
        # caused the 2026-06 signal-silence incident was lifecycle
        # monitor silent-failing for days.
        obs.heartbeat('lifecycle_monitor', status='live')

        try:
            result = (
                self.db().table('signals')
                .select('id,pair,direction,entry_price,stop_loss,take_profit_1,'
                        'take_profit_2,take_profit_3,lifecycle_state,published_at')
                .eq('engine_version', 'algo_v1')
                .eq('lifecycle_state', 'active')
                .execute()
            )
            signals = result.data or []
        except Exception as e:
            logger.error(f"Lifecycle monitor fetch failed: {e}")
            obs.health_alert('lifecycle_monitor',
                             f'fetch failed: {str(e)[:200]}')
            return

        if not signals:
            return

        logger.debug(f"Lifecycle monitor: checking {len(signals)} active signal(s)")

        # CRITICAL: previously used return_exceptions=True without
        # ITERATING the results — every per-signal exception (including
        # the schema mismatch that caused the production outage) was
        # silently swallowed. Now we surface exceptions to the operator.
        tasks = [self._check_signal(sig) for sig in signals]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for sig, result in zip(signals, results):
            if isinstance(result, Exception):
                logger.error(
                    f"[{sig['pair']}:{sig['id'][:8]}] lifecycle check raised: {result}"
                )
                obs.emit('engine_event', payload={
                    'event':    'lifecycle_check_raised',
                    'signal_id': sig['id'],
                    'pair':      sig['pair'],
                    'error':     str(result)[:200],
                }, status='failed', error_class='lifecycle_error')

    async def _check_signal(self, sig: dict) -> None:
        symbol = sig['pair']
        sid    = sig['id'][:8]

        # Check expiry first (time-based). The outer `except: pass` that
        # used to wrap this whole block silently swallowed parse failures
        # — replaced with narrow exception handling so genuine parse
        # errors get logged, and the transition still happens.
        try:
            published = datetime.fromisoformat(sig['published_at'].replace('Z', '+00:00'))
        except (ValueError, KeyError, AttributeError) as e:
            logger.warning(f"[{symbol}:{sid}] could not parse published_at: {e}")
            return
        age_hours = (datetime.now(timezone.utc) - published).total_seconds() / 3600
        if age_hours >= SIGNAL_EXPIRY_HOURS:
            await self._transition(sig['id'], symbol, 'expired',
                                   f"Signal expired after {age_hours:.1f}h")
            return

        if not self._provider:
            return

        price = await self._provider.fetch_live_price(symbol)
        if price is None:
            return

        direction = sig['direction']
        sl  = sig.get('stop_loss')
        tp1 = sig.get('take_profit_1')
        tp2 = sig.get('take_profit_2')
        tp3 = sig.get('take_profit_3')
        current_state = sig['lifecycle_state']

        new_state: Optional[str] = None
        reason = ''

        if direction == 'buy':
            if sl and price <= sl:
                new_state = 'stopped'
                reason = f"SL hit at {price} (SL={sl})"
            elif tp3 and price >= tp3 and current_state not in ('tp3_hit',):
                new_state = 'tp3_hit'
                reason = f"TP3 hit at {price} (TP3={tp3})"
            elif tp2 and price >= tp2 and current_state not in ('tp3_hit', 'tp2_hit'):
                new_state = 'tp2_hit'
                reason = f"TP2 hit at {price} (TP2={tp2})"
            elif tp1 and price >= tp1 and current_state == 'active':
                new_state = 'tp1_hit'
                reason = f"TP1 hit at {price} (TP1={tp1})"

        elif direction == 'sell':
            if sl and price >= sl:
                new_state = 'stopped'
                reason = f"SL hit at {price} (SL={sl})"
            elif tp3 and price <= tp3 and current_state not in ('tp3_hit',):
                new_state = 'tp3_hit'
                reason = f"TP3 hit at {price} (TP3={tp3})"
            elif tp2 and price <= tp2 and current_state not in ('tp3_hit', 'tp2_hit'):
                new_state = 'tp2_hit'
                reason = f"TP2 hit at {price} (TP2={tp2})"
            elif tp1 and price <= tp1 and current_state == 'active':
                new_state = 'tp1_hit'
                reason = f"TP1 hit at {price} (TP1={tp1})"

        if new_state:
            logger.info(f"[{symbol}:{sid}] Auto-transition → {new_state}: {reason}")
            await self._transition(sig['id'], symbol, new_state, reason)

    async def _transition(self, signal_id: str, symbol: str, new_state: str, reason: str) -> None:
        try:
            is_terminal = new_state in TERMINAL_STATES
            # NOTE: signals table has no `updated_at` column. The earlier
            # version of this code set it anyway, which caused PostgREST
            # to reject EVERY UPDATE silently. The lifecycle monitor was
            # effectively a no-op for days. Removed — do not re-add
            # without verifying the schema first.
            update: dict = {
                'lifecycle_state': new_state,
            }

            if is_terminal:
                update['status'] = 'closed'

            # Map terminal states to result field
            if new_state in ('tp1_hit', 'tp2_hit', 'tp3_hit'):
                update['result'] = 'win'
            elif new_state == 'stopped':
                update['result'] = 'loss'
            elif new_state == 'breakeven':
                update['result'] = 'breakeven'

            res = self.db().table('signals').update(update).eq('id', signal_id).execute()
            updated_rows = len(res.data) if res.data else 0
            if updated_rows == 0:
                # An UPDATE that touched 0 rows is the prior silent
                # failure signature. Surface it loudly so the next
                # schema-drift bug can't hide for days.
                logger.error(
                    f"[{symbol}:{signal_id[:8]}] lifecycle UPDATE matched 0 rows "
                    f"(state={new_state})"
                )
                obs.health_alert('lifecycle_monitor',
                                 f'transition matched 0 rows: '
                                 f'signal={signal_id[:8]} state={new_state}')
            else:
                # Mirror to system_event_log so the diagnostics endpoint
                # shows the lifecycle stream alongside signal generation.
                obs.emit(
                    'sl_hit' if new_state == 'stopped'
                    else 'tp_hit' if new_state in ('tp1_hit', 'tp2_hit', 'tp3_hit')
                    else 'trade_close',
                    payload={'symbol': symbol, 'state': new_state, 'reason': reason},
                    reference_id=signal_id,
                )

            # Write to execution_logs for audit trail
            try:
                self.db().table('execution_logs').insert({
                    'signal_id': signal_id,
                    'event':     f'auto_lifecycle_{new_state}',
                    'notes':     reason,
                    'logged_at': datetime.now(timezone.utc).isoformat(),
                }).execute()
            except Exception:
                pass  # execution_logs is best-effort

            # On terminal close, hand settlement back to the web app —
            # copy-trade PnL, creator profit-share and shadow-drift are
            # single-sourced in lib/copy-settlement.ts. Fire-and-forget;
            # the endpoint is idempotent so a missed call self-heals on
            # the next admin/cron settle.
            if is_terminal:
                await self._settle_copies(signal_id)

        except Exception as e:
            logger.error(f"Lifecycle transition failed for {signal_id}: {e}")

    async def _settle_copies(self, signal_id: str) -> None:
        """Refocus R2: copy-trade infrastructure retired. This callback
        used to POST /api/internal/settle-signal on the web app, which
        fanned signal closes into copy-trade settlements. That endpoint
        no longer exists, so the call would 404 on every signal close.
        Kept as a no-op so the caller in _transition() doesn't need a
        conditional; will be removed entirely once R6 drops the
        residual copy_* tables. Unused parameter is intentional."""
        _ = signal_id  # noqa: keep signature, callers still pass it
        return
