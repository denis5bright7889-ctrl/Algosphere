"""
Per-user adapter factory.

The signal-engine's /execute endpoint receives a `user_id` + `broker` and
needs to:
  1. Look up the user's encrypted credentials in broker_connections
  2. Decrypt them with the vault (same key as the web app)
  3. Construct the right adapter subclass
  4. Connect + return it

Results are cached in-process so repeated calls within a worker reuse
the live broker session (cheaper than re-handshaking every signal).

Cache invalidation:
  • Adapter-level errors during refresh_state() or submit_order() flip
    a `failed` flag so the next call rebuilds from scratch.
  • Explicit `drop_cache(user_id, broker)` is exposed for the broker
    settings flow — when a user rotates a key in the UI, we invalidate
    here too.
"""
from __future__ import annotations
import asyncio
from dataclasses import dataclass
from typing import Optional, Tuple
from loguru import logger

import os

from risk.adapters.base import ExecutionAdapter
from risk.adapters.binance_adapter import BinanceAdapter
from risk.adapters.bybit_adapter   import BybitAdapter
from risk.adapters.okx_adapter     import OKXAdapter
from risk.adapters.mt5_adapter     import MT5Adapter
from risk.adapters.mt5_bridge_adapter import MT5BridgeAdapter
from risk.adapters.oanda_adapter   import OANDAAdapter
from risk.adapters.tradovate_adapter import TradovateAdapter
from risk.adapters.paper_adapter   import PaperBroker
from risk.broker_state import disabled_reason_for
from risk.vault import decrypt as vault_decrypt, VaultError


# ─── Cache ─────────────────────────────────────────────────────────────

CacheKey = Tuple[str, str]   # (user_id, broker)
_cache:   dict[CacheKey, ExecutionAdapter] = {}
_cache_lock = asyncio.Lock()


class BrokerNotConnected(RuntimeError):
    """The user has no broker_connections row for this broker."""


class BrokerDecryptError(RuntimeError):
    """Credentials exist but couldn't be decrypted — usually means
    CREDENTIAL_ENCRYPTION_KEY was rotated or never set."""


class BrokerDisabled(RuntimeError):
    """The broker is structurally unavailable in this environment
    (e.g. MT5 on Linux). The connection should be marked DISABLED with
    a clear reason rather than retried — only an infrastructure change
    can resolve it."""


# ─── Lookup ────────────────────────────────────────────────────────────

@dataclass
class _ConnRow:
    id:            str
    broker:        str
    is_testnet:    bool
    api_key:       str
    api_secret:    str
    passphrase:    Optional[str]
    account_id:    Optional[str]


def _load_connection(db, user_id: str, broker: str) -> Optional[_ConnRow]:
    try:
        result = (
            db.table('broker_connections')
            .select('id,broker,is_testnet,api_key_enc,api_secret_enc,'
                    'passphrase_enc,account_id')
            .eq('user_id', user_id)
            .eq('broker', broker)
            .order('is_default', desc=True)
            .order('created_at', desc=True)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error(f"broker_connections lookup failed: {e}")
        return None

    rows = result.data or []
    if not rows:
        return None
    row = rows[0]

    try:
        # Some brokers leave a credential column empty (OANDA has no
        # secret; Tradovate has no api_key). Decrypt only non-empty
        # ciphertext — empty → empty string, never a VaultError.
        api_key    = vault_decrypt(row['api_key_enc'])    if row.get('api_key_enc')    else ''
        api_secret = vault_decrypt(row['api_secret_enc']) if row.get('api_secret_enc') else ''
        passphrase = (
            vault_decrypt(row['passphrase_enc']) if row.get('passphrase_enc') else None
        )
    except VaultError as e:
        logger.error(f"Vault decrypt failed for {user_id}/{broker}: {e.code}")
        raise BrokerDecryptError(f"Decrypt failed: {e.code}") from e

    return _ConnRow(
        id         = row['id'],
        broker     = row['broker'],
        is_testnet = bool(row.get('is_testnet', True)),
        api_key    = api_key,
        api_secret = api_secret,
        passphrase = passphrase,
        account_id = row.get('account_id'),
    )


# ─── Build ─────────────────────────────────────────────────────────────

def _build_adapter(conn: _ConnRow, user_id: str) -> ExecutionAdapter:
    # Environment-level guard: if the broker is structurally unsupported
    # in this deploy (MT5 on Linux, cTrader not implemented), refuse
    # immediately so the probe can mark the row DISABLED instead of
    # cycling through retries forever.
    reason = disabled_reason_for(conn.broker)
    if reason is not None:
        raise BrokerDisabled(reason)

    login = f"{conn.broker}_{user_id[:8]}"

    if conn.broker == 'binance':
        return BinanceAdapter(
            conn.api_key, conn.api_secret,
            testnet=conn.is_testnet, login=login,
        )
    if conn.broker == 'bybit':
        return BybitAdapter(
            conn.api_key, conn.api_secret,
            testnet=conn.is_testnet, login=login,
        )
    if conn.broker == 'okx':
        if not conn.passphrase:
            raise BrokerNotConnected("OKX requires passphrase_enc")
        return OKXAdapter(
            conn.api_key, conn.api_secret, conn.passphrase,
            demo=conn.is_testnet, login=login,
        )
    if conn.broker == 'mt5':
        # api_key_enc stores the numeric login; api_secret_enc the password;
        # passphrase_enc the broker server label (e.g. "Pepperstone-Demo").
        if not conn.passphrase:
            raise BrokerNotConnected("MT5 requires passphrase_enc (server name)")
        try:
            login_id = int(conn.api_key)
        except ValueError as e:
            raise BrokerNotConnected(
                "MT5 api_key_enc must decrypt to a numeric login"
            ) from e
        # Two execution paths — bridge mode wins when configured because
        # it's the only viable path on Linux. Local mode is for the rare
        # Windows-hosted engine deploy.
        if os.environ.get('MT5_BRIDGE_URL', '').strip():
            return MT5BridgeAdapter(
                login_id, conn.api_secret, conn.passphrase, testnet=conn.is_testnet,
                owner_user_id=user_id,
            )
        return MT5Adapter(
            login_id, conn.api_secret, conn.passphrase, testnet=conn.is_testnet,
            owner_user_id=user_id,
        )
    if conn.broker == 'oanda':
        # api_key_enc → OANDA token; account_id column → OANDA account id.
        if not conn.account_id:
            raise BrokerNotConnected("OANDA requires account_id (the OANDA account number)")
        return OANDAAdapter(
            conn.api_key, conn.account_id, testnet=conn.is_testnet, login=login,
        )
    if conn.broker == 'tradovate':
        # account_id column → Tradovate username; api_secret_enc → password.
        # Platform app creds (appId/cid/sec) come from engine env.
        if not conn.account_id:
            raise BrokerNotConnected("Tradovate requires account_id (the Tradovate username)")
        return TradovateAdapter(
            conn.account_id, conn.api_secret, testnet=conn.is_testnet, login=login,
        )
    raise BrokerNotConnected(f"No adapter implemented for broker={conn.broker}")


# ─── Public API ───────────────────────────────────────────────────────

async def get_adapter_for_user(
    db, user_id: str, broker: str,
) -> ExecutionAdapter:
    """
    Return a connected adapter for (user_id, broker). Raises
    BrokerNotConnected if the user has no row, BrokerDecryptError if the
    vault can't unseal the credentials. Adapter is cached in-process.
    """
    key: CacheKey = (user_id, broker)

    async with _cache_lock:
        cached = _cache.get(key)
        if cached is not None:
            return cached

    # Paper broker has no credentials — short-circuit the
    # broker_connections / vault path entirely.
    if broker == 'paper':
        adapter: ExecutionAdapter = PaperBroker(user_id)
        await adapter.connect()
        async with _cache_lock:
            existing = _cache.get(key)
            if existing is not None:
                await adapter.close()
                return existing
            _cache[key] = adapter
        return adapter

    conn = await asyncio.to_thread(_load_connection, db, user_id, broker)
    if conn is None:
        raise BrokerNotConnected(
            f"No {broker} connection for user {user_id[:8]}"
        )

    adapter = _build_adapter(conn, user_id)
    await adapter.connect()

    async with _cache_lock:
        # Double-check — another task may have built the same adapter
        # while we were connecting
        existing = _cache.get(key)
        if existing is not None:
            await adapter.close()
            return existing
        _cache[key] = adapter

    return adapter


async def drop_cache(user_id: str, broker: str) -> None:
    """Invalidate the cached adapter — call after credential rotation."""
    key: CacheKey = (user_id, broker)
    async with _cache_lock:
        ad = _cache.pop(key, None)
    if ad is not None:
        try:
            await ad.close()
        except Exception as e:
            logger.warning(f"Adapter close during invalidate failed: {e}")


def cache_size() -> int:
    """For /metrics — number of live broker sessions across all users."""
    return len(_cache)
