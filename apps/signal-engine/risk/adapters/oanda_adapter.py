"""
OANDA v20 execution adapter (practice + live).

Pure-REST, runs anywhere (no desktop gateway needed — unlike MT5 / IB).
OANDA is forex / metals / CFD, which aligns with the platform's existing
XAUUSD / EURUSD / GBPUSD universe.

Credential mapping (from broker_connections, decrypted by the factory):
  api_key     → OANDA API token (Bearer)
  account_id  → OANDA account id (e.g. "001-001-1234567-001")
  is_testnet  → practice (true) vs live (false)
api_secret / passphrase are unused for OANDA.

Endpoints used (v20):
  GET  /v3/accounts/{id}/summary          → equity (NAV) / balance / openPositionCount
  GET  /v3/accounts/{id}/openPositions    → positions
  POST /v3/accounts/{id}/orders           → market / limit order (+ SL/TP attached)
  PUT  /v3/accounts/{id}/orders/{oid}/cancel
  GET  /v3/accounts/{id}/pricing          → bid/ask for slippage check

Units: OANDA trades in *units* (signed: + = buy, − = sell), not lots.
OrderRequest.quantity is in lots; we convert via the symbol's
contract_size (default_spec) — 0.01 lot EURUSD × 100_000 = 1_000 units.
"""
from __future__ import annotations
import os
import time
from typing import Optional
import httpx
from loguru import logger

from risk.adapters.base import (
    ExecutionAdapter, OrderRequest, OrderResult, OrderType, OrderSide,
    Position, OrderRejected, SlippageExceeded,
)
from risk.broker_adapter import SymbolSpec, default_spec

TIMEOUT_S = 15.0


def _to_oanda_instrument(symbol: str) -> str:
    """Platform symbol → OANDA instrument. 'EURUSD'→'EUR_USD',
    'XAUUSD'→'XAU_USD'. Pass-through if already underscored."""
    s = symbol.upper().replace('_', '')
    if len(s) == 6:
        return f"{s[:3]}_{s[3:]}"
    # Common metals / indices that aren't 6-char
    return symbol.upper() if '_' in symbol else s


class OANDAAdapter(ExecutionAdapter):
    def __init__(
        self,
        token:      str,
        account_id: str,
        testnet:    bool = True,
        login:      Optional[str] = None,
    ):
        self.token      = token
        self.account_id = account_id
        self.testnet    = testnet
        self.login      = login or f"oanda_{account_id[-6:] if account_id else 'acct'}"
        self._base = (
            'https://api-fxpractice.oanda.com' if testnet
            else 'https://api-fxtrade.oanda.com'
        )
        self._connected = False
        self._last_equity: Optional[float] = None
        self._open_positions_count = 0

    def _headers(self) -> dict:
        return {
            'Authorization': f'Bearer {self.token}',
            'Content-Type':  'application/json',
        }

    # ─── Lifecycle ────────────────────────────────────────────────────

    async def connect(self) -> None:
        # Probe by fetching the account summary. 401 → bad token,
        # 404 → bad account id. Either way _connected stays False.
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.get(
                    f'{self._base}/v3/accounts/{self.account_id}/summary',
                    headers=self._headers(),
                )
            if r.status_code == 200:
                self._connected = True
                acct = r.json().get('account', {})
                self._last_equity = float(acct.get('NAV', acct.get('balance', 0)) or 0)
                self._open_positions_count = int(acct.get('openPositionCount', 0) or 0)
                logger.info(f"OANDA adapter connected (practice={self.testnet}, NAV={self._last_equity})")
            else:
                self._connected = False
                logger.error(f"OANDA connect {r.status_code}: {r.text[:200]}")
        except Exception as e:
            self._connected = False
            logger.error(f"OANDA connect failed: {e}")

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
        return None   # live spread comes from /pricing at submit time

    def close_all_positions(self) -> int:
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self._close_all_async())
                return 0
            return loop.run_until_complete(self._close_all_async())
        except Exception as e:
            logger.error(f"OANDA close_all_positions failed: {e}")
            return 0

    # ─── Async refresh ─────────────────────────────────────────────────

    async def refresh_state(self) -> None:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.get(
                    f'{self._base}/v3/accounts/{self.account_id}/summary',
                    headers=self._headers(),
                )
            if r.status_code != 200:
                self._connected = False
                return
            acct = r.json().get('account', {})
            self._last_equity = float(acct.get('NAV', acct.get('balance', 0)) or 0)
            self._open_positions_count = int(acct.get('openPositionCount', 0) or 0)
            self._connected = True
        except Exception as e:
            logger.error(f"OANDA refresh_state failed: {e}")

    # ─── Execution ─────────────────────────────────────────────────────

    async def submit_order(self, req: OrderRequest) -> OrderResult:
        instrument = _to_oanda_instrument(req.symbol)
        spec = default_spec(req.symbol)
        # lots → signed units
        units = req.quantity * spec.contract_size
        signed_units = units if req.side == OrderSide.BUY else -units

        async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
            # Slippage guard for market orders — read current pricing.
            base_px: Optional[float] = None
            if req.order_type == OrderType.MARKET:
                try:
                    pr = await c.get(
                        f'{self._base}/v3/accounts/{self.account_id}/pricing',
                        headers=self._headers(),
                        params={'instruments': instrument},
                    )
                    if pr.status_code == 200:
                        prices = pr.json().get('prices', [])
                        if prices:
                            bid = float(prices[0]['bids'][0]['price'])
                            ask = float(prices[0]['asks'][0]['price'])
                            mid = (bid + ask) / 2
                            base_px = ask if req.side == OrderSide.BUY else bid
                            if mid > 0 and (ask - bid) / mid > req.max_slippage_pct:
                                raise SlippageExceeded(
                                    f"Spread {(ask-bid)/mid:.4%} > max {req.max_slippage_pct:.4%}"
                                )
                except SlippageExceeded:
                    raise
                except Exception as e:
                    logger.warning(f"OANDA pricing check failed (continuing): {e}")

            order: dict = {
                'order': {
                    'instrument':   instrument,
                    'units':        str(int(signed_units)),
                    'type':         'MARKET' if req.order_type == OrderType.MARKET else 'LIMIT',
                    'timeInForce':  'FOK' if req.order_type == OrderType.MARKET else 'GTC',
                    'positionFill': 'DEFAULT',
                }
            }
            if req.order_type == OrderType.LIMIT:
                if req.price is None:
                    raise OrderRejected("LIMIT order requires price")
                order['order']['price'] = str(req.price)
                order['order']['timeInForce'] = 'GTC'
            if req.stop_loss is not None:
                order['order']['stopLossOnFill']   = {'price': str(req.stop_loss)}
            if req.take_profit is not None:
                order['order']['takeProfitOnFill'] = {'price': str(req.take_profit)}
            if req.client_order_id:
                order['order']['clientExtensions'] = {'id': req.client_order_id[:128]}

            r = await c.post(
                f'{self._base}/v3/accounts/{self.account_id}/orders',
                headers=self._headers(),
                json=order,
            )

        if r.status_code not in (200, 201):
            raise OrderRejected(f"OANDA rejected ({r.status_code}): {r.text[:240]}")

        data = r.json()
        fill = data.get('orderFillTransaction')
        if fill is None:
            # Order created but not filled (e.g. pending limit), or rejected.
            rej = data.get('orderRejectTransaction') or data.get('orderCancelTransaction')
            if rej:
                raise OrderRejected(f"OANDA: {rej.get('reason', 'order not filled')}")
            create = data.get('orderCreateTransaction', {})
            return OrderResult(
                order_id        = str(create.get('id', '')),
                client_order_id = req.client_order_id,
                symbol          = req.symbol,
                side            = req.side.value,
                status          = 'NEW',
                requested_qty   = req.quantity,
                filled_qty      = 0.0,
                avg_fill_price  = req.price or 0.0,
                commission      = 0.0,
                slippage_pct    = 0.0,
                timestamp_ms    = int(time.time() * 1000),
                raw             = data,
            )

        avg_price   = float(fill.get('price', 0) or 0)
        filled_units= abs(float(fill.get('units', 0) or 0))
        filled_lots = filled_units / spec.contract_size if spec.contract_size else filled_units
        slippage    = 0.0
        if base_px and avg_price and base_px > 0:
            slippage = (avg_price - base_px) / base_px
        commission  = abs(float(fill.get('commission', 0) or 0))

        return OrderResult(
            order_id        = str(fill.get('orderID', fill.get('id', ''))),
            client_order_id = req.client_order_id,
            symbol          = req.symbol,
            side            = req.side.value,
            status          = 'FILLED',
            requested_qty   = req.quantity,
            filled_qty      = filled_lots,
            avg_fill_price  = avg_price,
            commission      = commission,
            slippage_pct    = slippage,
            timestamp_ms    = int(time.time() * 1000),
            raw             = fill,
        )

    async def cancel_order(self, order_id: str, symbol: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.put(
                    f'{self._base}/v3/accounts/{self.account_id}/orders/{order_id}/cancel',
                    headers=self._headers(),
                )
            return r.status_code in (200, 201)
        except Exception as e:
            logger.warning(f"OANDA cancel failed for {order_id}: {e}")
            return False

    async def get_positions(self) -> list[Position]:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                r = await c.get(
                    f'{self._base}/v3/accounts/{self.account_id}/openPositions',
                    headers=self._headers(),
                )
            if r.status_code != 200:
                return []
            out: list[Position] = []
            for p in r.json().get('positions', []):
                instrument = p.get('instrument', '')
                platform_sym = instrument.replace('_', '')
                spec = default_spec(platform_sym)
                long_units  = float(p.get('long', {}).get('units', 0) or 0)
                short_units = float(p.get('short', {}).get('units', 0) or 0)
                if long_units != 0:
                    side, units, side_obj = 'long', long_units, p['long']
                elif short_units != 0:
                    side, units, side_obj = 'short', short_units, p['short']
                else:
                    continue
                avg = float(side_obj.get('averagePrice', 0) or 0)
                upnl = float(side_obj.get('unrealizedPL', p.get('unrealizedPL', 0)) or 0)
                out.append(Position(
                    symbol         = platform_sym,
                    side           = side,    # type: ignore[arg-type]
                    qty            = abs(units) / spec.contract_size if spec.contract_size else abs(units),
                    avg_entry      = avg,
                    current_price  = avg,     # OANDA openPositions doesn't return mark; refreshed via /pricing if needed
                    unrealized_pnl = upnl,
                    margin_used    = 0.0,
                    broker_pos_id  = f"{instrument}:{side[0].upper()}",
                ))
            return out
        except Exception as e:
            logger.error(f"OANDA get_positions failed: {e}")
            return []

    async def _close_all_async(self) -> int:
        positions = await self.get_positions()
        closed = 0
        for pos in positions:
            try:
                instrument = _to_oanda_instrument(pos.symbol)
                # OANDA closes a position by instrument with longUnits/shortUnits=ALL
                body = {'longUnits': 'ALL'} if pos.side == 'long' else {'shortUnits': 'ALL'}
                async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
                    r = await c.put(
                        f'{self._base}/v3/accounts/{self.account_id}/positions/{instrument}/close',
                        headers=self._headers(),
                        json=body,
                    )
                if r.status_code in (200, 201):
                    closed += 1
            except Exception as e:
                logger.error(f"OANDA emergency close of {pos.symbol} failed: {e}")
        return closed


def adapter_from_env(login: str = 'oanda') -> Optional[OANDAAdapter]:
    token   = os.environ.get('OANDA_TOKEN')
    account = os.environ.get('OANDA_ACCOUNT_ID')
    if not token or not account:
        return None
    testnet = os.environ.get('OANDA_PRACTICE', 'true').lower() != 'false'
    return OANDAAdapter(token, account, testnet=testnet, login=login)
