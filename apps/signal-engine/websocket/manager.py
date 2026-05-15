"""
AlgoSphere WebSocket Manager
Tier-aware connection registry with heartbeat, stale-connection cleanup,
symbol subscriptions, and concurrent broadcast queues.
"""
from __future__ import annotations
import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Optional
from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger

TIER_ORDER = {'free': 0, 'starter': 1, 'premium': 2}

# Tiers that can receive each signal tier
TIER_ACCESS = {
    'free':     {'free'},
    'starter':  {'free', 'starter'},
    'premium':  {'free', 'starter', 'premium'},
}

HEARTBEAT_INTERVAL = 25   # seconds
STALE_TIMEOUT = 120       # seconds — disconnect if no pong within this window


@dataclass
class Connection:
    ws: WebSocket
    client_id: str
    tier: str                              # user subscription tier
    symbols: set[str] = field(default_factory=set)  # empty = all symbols
    last_pong: float = field(default_factory=time.monotonic)
    send_queue: asyncio.Queue = field(default_factory=asyncio.Queue)


class WebSocketManager:
    """
    Manages all active WebSocket connections with tier-based filtering.
    Supports channels: /ws/signals, /ws/analytics, /ws/regime
    """

    def __init__(self):
        self._connections: dict[str, Connection] = {}   # client_id → Connection
        self._lock = asyncio.Lock()
        self._heartbeat_task: Optional[asyncio.Task] = None

    # ─── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self) -> None:
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        logger.info("WebSocket manager started")

    async def stop(self) -> None:
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        async with self._lock:
            for conn in list(self._connections.values()):
                try:
                    await conn.ws.close()
                except Exception:
                    pass
            self._connections.clear()
        logger.info("WebSocket manager stopped")

    # ─── Connection management ────────────────────────────────────────────────

    async def connect(self, ws: WebSocket, client_id: str, tier: str) -> Connection:
        await ws.accept()
        conn = Connection(ws=ws, client_id=client_id, tier=tier)
        async with self._lock:
            self._connections[client_id] = conn
        logger.info(f"WS connected: {client_id} (tier={tier}) — {len(self._connections)} active")

        # Start per-connection sender task
        asyncio.create_task(self._sender(conn))
        return conn

    async def disconnect(self, client_id: str) -> None:
        async with self._lock:
            conn = self._connections.pop(client_id, None)
        if conn:
            try:
                await conn.ws.close()
            except Exception:
                pass
            logger.info(f"WS disconnected: {client_id} — {len(self._connections)} remaining")

    async def handle(self, conn: Connection) -> None:
        """
        Main receive loop for a connection. Handles pong and symbol subscription messages.
        Runs until the client disconnects.
        """
        try:
            while True:
                try:
                    raw = await asyncio.wait_for(conn.ws.receive_text(), timeout=STALE_TIMEOUT)
                except asyncio.TimeoutError:
                    logger.warning(f"WS stale timeout: {conn.client_id}")
                    break

                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                kind = msg.get('type')

                if kind == 'pong':
                    conn.last_pong = time.monotonic()

                elif kind == 'subscribe':
                    symbols = {s.upper() for s in msg.get('symbols', []) if isinstance(s, str)}
                    conn.symbols = symbols
                    logger.debug(f"WS {conn.client_id} subscribed to {symbols or 'all'}")

                elif kind == 'unsubscribe':
                    conn.symbols.clear()

        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.warning(f"WS handle error ({conn.client_id}): {e}")
        finally:
            await self.disconnect(conn.client_id)

    # ─── Broadcast ───────────────────────────────────────────────────────────

    async def broadcast_signal(self, symbol: str, signal_id: str, tier_required: str) -> int:
        """Broadcast new signal to all eligible connections. Returns recipient count."""
        payload = json.dumps({
            'type':         'signal',
            'symbol':       symbol,
            'signal_id':    signal_id,
            'tier_required': tier_required,
            'timestamp':    time.time(),
        })
        return await self._broadcast(payload, symbol=symbol, min_tier=tier_required)

    async def broadcast_regime(self, symbol: str, regime: str, score: float) -> int:
        payload = json.dumps({
            'type':    'regime',
            'symbol':  symbol,
            'regime':  regime,
            'score':   score,
            'timestamp': time.time(),
        })
        return await self._broadcast(payload, symbol=symbol, min_tier='free')

    async def broadcast_analytics(self, data: dict) -> int:
        payload = json.dumps({'type': 'analytics', 'timestamp': time.time(), **data})
        return await self._broadcast(payload, symbol=None, min_tier='premium')

    async def _broadcast(
        self,
        payload: str,
        symbol: Optional[str],
        min_tier: str,
    ) -> int:
        sent = 0
        async with self._lock:
            targets = list(self._connections.values())

        for conn in targets:
            # Tier gate
            if not self._tier_can_access(conn.tier, min_tier):
                continue
            # Symbol filter (empty set = all symbols)
            if symbol and conn.symbols and symbol not in conn.symbols:
                continue
            try:
                conn.send_queue.put_nowait(payload)
                sent += 1
            except asyncio.QueueFull:
                logger.warning(f"WS send queue full for {conn.client_id}")

        return sent

    # ─── Per-connection sender (drain queue) ─────────────────────────────────

    async def _sender(self, conn: Connection) -> None:
        try:
            while True:
                payload = await conn.send_queue.get()
                try:
                    await conn.ws.send_text(payload)
                except Exception:
                    break  # socket gone — handle() will call disconnect
        except asyncio.CancelledError:
            pass

    # ─── Heartbeat ───────────────────────────────────────────────────────────

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            now = time.monotonic()
            async with self._lock:
                targets = list(self._connections.values())

            stale = []
            for conn in targets:
                if now - conn.last_pong > STALE_TIMEOUT:
                    stale.append(conn.client_id)
                    continue
                try:
                    conn.send_queue.put_nowait(json.dumps({'type': 'ping'}))
                except asyncio.QueueFull:
                    pass

            for cid in stale:
                logger.info(f"WS pruning stale connection: {cid}")
                await self.disconnect(cid)

    # ─── Stats ───────────────────────────────────────────────────────────────

    def stats(self) -> dict:
        tiers: dict[str, int] = {}
        for conn in self._connections.values():
            tiers[conn.tier] = tiers.get(conn.tier, 0) + 1
        return {'total': len(self._connections), 'by_tier': tiers}

    # ─── Helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _tier_can_access(user_tier: str, required_tier: str) -> bool:
        return TIER_ORDER.get(user_tier, 0) >= TIER_ORDER.get(required_tier, 0)


# Module-level singleton — imported by main.py and signal_worker
ws_manager = WebSocketManager()
