"""
Tradovate execution adapter (demo + live) — futures.

Pure-REST + token auth, runs on Railway (no desktop gateway). Tradovate
is a futures broker: instruments are contracts (e.g. 'ESZ4' = E-mini
S&P, Dec 2024), not currency pairs. The adapter resolves a contract
*name* to Tradovate's internal contractId via /contract/find and
caches it.

Two-tier credential model (this is intrinsic to Tradovate's OAuth):
  • PLATFORM app registration — appId / cid / sec — is registered ONCE
    by the business with Tradovate and shared across all users. Read
    from engine env: TRADOVATE_APP_ID / TRADOVATE_CID / TRADOVATE_SEC
    / TRADOVATE_APP_VERSION.
  • PER-USER credentials from broker_connections:
        account_id  → Tradovate username
        api_secret  → Tradovate password
    api_key / passphrase unused.

If the platform app env vars aren't set, connect() fails loudly with a
clear message — there's no way to auth without the app registration.

Access tokens expire (~80 min); we cache + refresh on 401.
"""
from __future__ import annotations
import os
import time
from typing import Optional
import httpx
from loguru import logger

from risk.adapters.base import (
    ExecutionAdapter, OrderRequest, OrderResult, OrderType, OrderSide,
    Position, OrderRejected,
)
from risk.broker_adapter import SymbolSpec, default_spec

TIMEOUT_S = 15.0


def _platform_app() -> Optional[dict]:
    """Shared platform Tradovate app registration from engine env."""
    app_id = os.environ.get('TRADOVATE_APP_ID')
    cid    = os.environ.get('TRADOVATE_CID')
    sec    = os.environ.get('TRADOVATE_SEC')
    if not (app_id and cid and sec):
        return None
    return {
        'appId':      app_id,
        'appVersion': os.environ.get('TRADOVATE_APP_VERSION', '1.0'),
        'cid':        int(cid) if cid.isdigit() else cid,
        'sec':        sec,
    }


class TradovateAdapter(ExecutionAdapter):
    def __init__(
        self,
        username: str,
        password: str,
        testnet:  bool = True,
        login:    Optional[str] = None,
    ):
        self.username = username
        self.password = password
        self.testnet  = testnet
        self.login    = login or f"tradovate_{username[:8]}"
        self._base = (
            'https://demo.tradovateapi.com/v1' if testnet
            else 'https://live.tradovateapi.com/v1'
        )
        self._token: Optional[str] = None
        self._token_exp_ms: int = 0
        self._account_id: Optional[int] = None
        self._connected = False
        self._last_equity: Optional[float] = None
        self._open_positions_count = 0
        self._contract_cache: dict[str, int] = {}   # symbol → contractId

    # ─── Auth ──────────────────────────────────────────────────────────

    async def _authenticate(self) -> bool:
        app = _platform_app()
        if app is None:
            logger.error(
                "Tradovate: TRADOVATE_APP_ID/CID/SEC not set on the engine — "
                "cannot authenticate without the platform app registration"
            )
            return False
        body = {
            'name':     self.username,
            'password': self.password,
            **app,
        }
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.post(f'{self._base}/auth/accesstokenrequest', json=body)
            if r.status_code != 200:
                logger.error(f"Tradovate auth {r.status_code}: {r.text[:200]}")
                return False
            data = r.json()
            tok = data.get('accessToken')
            if not tok:
                # Tradovate returns a p-ticket flow for captcha/penalty — surface it.
                logger.error(f"Tradovate auth no token: {data.get('errorText') or data}")
                return False
            self._token = tok
            # expirationTime is an ISO string; cache a conservative TTL.
            self._token_exp_ms = int(time.time() * 1000) + 70 * 60 * 1000
            return True
        except Exception as e:
            logger.error(f"Tradovate auth failed: {e}")
            return False

    async def _ensure_token(self) -> bool:
        if self._token and int(time.time() * 1000) < self._token_exp_ms:
            return True
        return await self._authenticate()

    def _headers(self) -> dict:
        return {'Authorization': f'Bearer {self._token}', 'Content-Type': 'application/json'}

    # ─── Lifecycle ────────────────────────────────────────────────────

    async def connect(self) -> None:
        if not await self._ensure_token():
            self._connected = False
            return
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.get(f'{self._base}/account/list', headers=self._headers())
            if r.status_code != 200:
                self._connected = False
                logger.error(f"Tradovate account/list {r.status_code}: {r.text[:200]}")
                return
            accounts = r.json()
            if not accounts:
                self._connected = False
                logger.error("Tradovate: no accounts on this login")
                return
            self._account_id = int(accounts[0]['id'])
            self._connected = True
            logger.info(f"Tradovate connected (demo={self.testnet}, account={self._account_id})")
            await self.refresh_state()
        except Exception as e:
            self._connected = False
            logger.error(f"Tradovate connect failed: {e}")

    async def close(self) -> None:
        self._connected = False

    # ─── BrokerAdapter (read-only) ─────────────────────────────────────

    def get_account_login(self) -> str:        return self.login
    def is_connected(self) -> bool:             return self._connected
    def get_equity(self) -> Optional[float]:    return self._last_equity
    def get_balance(self) -> Optional[float]:   return self._last_equity
    def open_position_count(self) -> int:       return self._open_positions_count
    def get_symbol_spec(self, symbol: str) -> Optional[SymbolSpec]:
        return default_spec(symbol)
    def get_spread_pips(self, symbol: str) -> Optional[float]:
        return None

    def close_all_positions(self) -> int:
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self._close_all_async())
                return 0
            return loop.run_until_complete(self._close_all_async())
        except Exception as e:
            logger.error(f"Tradovate close_all_positions failed: {e}")
            return 0

    async def refresh_state(self) -> None:
        if not await self._ensure_token() or self._account_id is None:
            self._connected = False
            return
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                bal = await c.get(
                    f'{self._base}/cashBalance/getcashbalancesnapshot',
                    headers=self._headers(),
                    params={'accountId': self._account_id},
                )
                pos = await c.get(f'{self._base}/position/list', headers=self._headers())
            if bal.status_code == 200:
                d = bal.json()
                # totalCashValue ≈ equity for futures cash accounts
                self._last_equity = float(d.get('totalCashValue', d.get('cashBalance', 0)) or 0)
            if pos.status_code == 200:
                rows = [p for p in pos.json() if float(p.get('netPos', 0) or 0) != 0]
                self._open_positions_count = len(rows)
            self._connected = True
        except Exception as e:
            logger.error(f"Tradovate refresh_state failed: {e}")

    # ─── Contract resolution ───────────────────────────────────────────

    async def _resolve_contract(self, symbol: str) -> Optional[int]:
        cached = self._contract_cache.get(symbol.upper())
        if cached is not None:
            return cached
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.get(
                    f'{self._base}/contract/find',
                    headers=self._headers(),
                    params={'name': symbol.upper()},
                )
            if r.status_code == 200 and r.json():
                cid = int(r.json()['id'])
                self._contract_cache[symbol.upper()] = cid
                return cid
        except Exception as e:
            logger.warning(f"Tradovate contract resolve failed for {symbol}: {e}")
        return None

    # ─── Execution ─────────────────────────────────────────────────────

    async def submit_order(self, req: OrderRequest) -> OrderResult:
        if not await self._ensure_token() or self._account_id is None:
            raise OrderRejected("Tradovate not connected")

        contract_id = await self._resolve_contract(req.symbol)
        if contract_id is None:
            raise OrderRejected(f"Tradovate: unknown contract {req.symbol!r}")

        body: dict = {
            'accountId':     self._account_id,
            'contractId':    contract_id,
            'action':        'Buy' if req.side == OrderSide.BUY else 'Sell',
            'orderQty':      int(max(1, round(req.quantity))),   # futures = whole contracts
            'orderType':     'Market' if req.order_type == OrderType.MARKET else 'Limit',
            'isAutomated':   True,
        }
        if req.order_type == OrderType.LIMIT:
            if req.price is None:
                raise OrderRejected("LIMIT order requires price")
            body['price'] = req.price

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.post(f'{self._base}/order/placeorder', headers=self._headers(), json=body)
        except Exception as e:
            raise OrderRejected(f"Tradovate placeorder failed: {e}") from e

        if r.status_code != 200:
            raise OrderRejected(f"Tradovate rejected ({r.status_code}): {r.text[:240]}")
        data = r.json()
        if data.get('failureReason'):
            raise OrderRejected(f"Tradovate: {data.get('failureText') or data['failureReason']}")

        order_id = str(data.get('orderId', ''))
        return OrderResult(
            order_id        = order_id,
            client_order_id = req.client_order_id,
            symbol          = req.symbol,
            side            = req.side.value,
            status          = 'FILLED' if req.order_type == OrderType.MARKET else 'NEW',
            requested_qty   = req.quantity,
            filled_qty      = float(body['orderQty']) if req.order_type == OrderType.MARKET else 0.0,
            avg_fill_price  = req.price or 0.0,   # fill price arrives via the fill stream; market resp doesn't include it
            commission      = 0.0,
            slippage_pct    = 0.0,
            timestamp_ms    = int(time.time() * 1000),
            raw             = data,
        )

    async def cancel_order(self, order_id: str, symbol: str) -> bool:
        if not await self._ensure_token():
            return False
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.post(
                    f'{self._base}/order/cancelorder',
                    headers=self._headers(),
                    json={'orderId': int(order_id)},
                )
            return r.status_code == 200 and not r.json().get('failureReason')
        except Exception as e:
            logger.warning(f"Tradovate cancel failed for {order_id}: {e}")
            return False

    async def get_positions(self) -> list[Position]:
        if not await self._ensure_token():
            return []
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.get(f'{self._base}/position/list', headers=self._headers())
            if r.status_code != 200:
                return []
            out: list[Position] = []
            for p in r.json():
                net = float(p.get('netPos', 0) or 0)
                if net == 0:
                    continue
                avg = float(p.get('netPrice', 0) or 0)
                out.append(Position(
                    symbol         = str(p.get('contractId', '')),   # contractId; UI resolves name separately
                    side           = 'long' if net > 0 else 'short',
                    qty            = abs(net),
                    avg_entry      = avg,
                    current_price  = avg,
                    unrealized_pnl = 0.0,    # Tradovate PnL needs a separate /cashBalance or quote join
                    margin_used    = 0.0,
                    broker_pos_id  = str(p.get('id', '')),
                ))
            return out
        except Exception as e:
            logger.error(f"Tradovate get_positions failed: {e}")
            return []

    async def _close_all_async(self) -> int:
        positions = await self.get_positions()
        closed = 0
        for pos in positions:
            try:
                # Liquidate by submitting an opposite market order of the same size.
                side = OrderSide.SELL if pos.side == 'long' else OrderSide.BUY
                # pos.symbol holds the contractId here; resolve isn't needed —
                # place against the contractId directly.
                body = {
                    'accountId':   self._account_id,
                    'contractId':  int(pos.symbol) if str(pos.symbol).isdigit() else None,
                    'action':      'Buy' if side == OrderSide.BUY else 'Sell',
                    'orderQty':    int(pos.qty),
                    'orderType':   'Market',
                    'isAutomated': True,
                }
                if body['contractId'] is None:
                    continue
                async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                    r = await c.post(f'{self._base}/order/placeorder', headers=self._headers(), json=body)
                if r.status_code == 200 and not r.json().get('failureReason'):
                    closed += 1
            except Exception as e:
                logger.error(f"Tradovate emergency close failed: {e}")
        return closed


def adapter_from_env(login: str = 'tradovate') -> Optional[TradovateAdapter]:
    user = os.environ.get('TRADOVATE_USERNAME')
    pwd  = os.environ.get('TRADOVATE_PASSWORD')
    if not user or not pwd:
        return None
    testnet = os.environ.get('TRADOVATE_DEMO', 'true').lower() != 'false'
    return TradovateAdapter(user, pwd, testnet=testnet, login=login)
