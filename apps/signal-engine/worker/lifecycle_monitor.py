"""
AlgoSphere Signal Lifecycle Monitor
Polls active signals and auto-transitions state when TP/SL levels are hit.
Runs as a scheduled APScheduler job alongside the main scan.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from typing import Optional
import httpx
from loguru import logger
from supabase import create_client, Client

from config import get_settings


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
            return

        if not signals:
            return

        logger.debug(f"Lifecycle monitor: checking {len(signals)} active signal(s)")

        tasks = [self._check_signal(sig) for sig in signals]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _check_signal(self, sig: dict) -> None:
        symbol = sig['pair']
        sid    = sig['id'][:8]

        # Check expiry first (time-based)
        try:
            published = datetime.fromisoformat(sig['published_at'].replace('Z', '+00:00'))
            age_hours = (datetime.now(timezone.utc) - published).total_seconds() / 3600
            if age_hours >= SIGNAL_EXPIRY_HOURS:
                await self._transition(sig['id'], symbol, 'expired', f"Signal expired after {age_hours:.1f}h")
                return
        except Exception:
            pass

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
            update: dict = {
                'lifecycle_state': new_state,
                'updated_at': datetime.now(timezone.utc).isoformat(),
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

            self.db().table('signals').update(update).eq('id', signal_id).execute()

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
        key = self.settings.engine_api_key
        base = (self.settings.web_app_url or '').rstrip('/')
        if not key or not base:
            logger.debug("Skipping copy settlement — web_app_url/engine_api_key unset")
            return
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(
                    f"{base}/api/internal/settle-signal",
                    headers={'X-Engine-Key': key},
                    json={'signal_id': signal_id},
                )
            if resp.status_code != 200:
                logger.warning(
                    f"Copy settlement callback {resp.status_code} for {signal_id}: "
                    f"{resp.text[:200]}"
                )
            else:
                logger.info(f"Copy settlement triggered for {signal_id}")
        except Exception as e:
            logger.warning(f"Copy settlement callback failed for {signal_id}: {e}")
