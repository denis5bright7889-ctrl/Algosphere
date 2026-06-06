from __future__ import annotations
from functools import lru_cache
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    # Supabase — default to '' so the service still BOOTS and /health responds
    # even if env vars are absent/misconfigured. Signal scanning + persistence
    # degrade gracefully (skipped) until these are set; they are validated
    # lazily by has_supabase, not at import time.
    supabase_url: str = ''
    supabase_service_role_key: str = ''

    # Market data providers (at least one required)
    twelve_data_api_key: str = ''
    # Polygon is the only path for indices/equities. The key has historically
    # been provisioned under MASSIVE_API_KEY (Polygon's "Massive" plan name in
    # this stack); accept either so indices aren't silently starved when only
    # MASSIVE_API_KEY is set. POLYGON_API_KEY wins if both are present.
    polygon_api_key: str = Field(
        '', validation_alias=AliasChoices('POLYGON_API_KEY', 'MASSIVE_API_KEY'))
    alpha_vantage_api_key: str = ''

    # Inbound provider webhooks. Finnhub posts events with an
    # 'X-Finnhub-Secret' header == the secret shown in your Finnhub webhook
    # dashboard; we verify against this. Other providers fall back to a
    # per-provider <PROVIDER>_WEBHOOK_SECRET env var (see api/webhooks.py).
    finnhub_webhook_secret: str = ''

    # Redis (optional)
    redis_url: str = ''

    # Engine
    signal_engine_enabled: bool = True
    # When true, the pipeline runs the FULL path (ensemble → confidence →
    # gate → risk) and LOGS the signal it would publish, but does NOT write
    # to `signals` or fan out to the copy/execution pipeline. Used to verify
    # generation after a tuning change without any live-trade exposure.
    signal_dry_run: bool = False
    scan_interval_minutes: int = 5
    # Default scan universe — keep this in sync with the SYMBOLS env var in
    # production. TD-served symbols (forex / metals / energy / indices) each
    # cost 1 credit per scan; with the TwelveData Basic plan (800/day, 8/min)
    # the safe ceiling is ~8 TD symbols at scan_interval_minutes=5.
    # Crypto via Coinbase is keyless and unmetered.
    #
    # Phase-2 multi-asset expansion (2026-06): the institutional universe is
    #   Forex 10 + Metals 2 + Indices 5 + Energy 2 + Crypto 9 = 28 symbols.
    # Of those, 19 are TD-served — at the 5-min cadence that is ~5,472
    # credits/day, requiring a TD plan ≥ Pro ($79/mo, 8,000 credits/day).
    # On Grow ($29, 2,500/day), raise scan_interval_minutes to 12 or wider.
    # Indices may decline on TD free tier; Polygon (MASSIVE_API_KEY /
    # POLYGON_API_KEY) is the fallback for SPX500/GER40/UK100/NAS100/US30.
    #
    # DOGEUSDT kept from the prior universe to honour the "don't remove
    # working assets" preservation rule even though the target spec omits it.
    symbols: str = (
        # ── Forex (10 TD) ──
        'EURUSD,GBPUSD,USDJPY,AUDUSD,USDCHF,'
        'USDCAD,NZDUSD,EURJPY,GBPJPY,EURGBP,'
        # ── Metals (2 TD) ──
        'XAUUSD,XAGUSD,'
        # ── Indices (5 TD primary, Polygon fallback) ──
        'NAS100,SPX500,US30,GER40,UK100,'
        # ── Energy (2 TD) ──
        'USOIL,UKOIL,'
        # ── Crypto (9 target + 1 preserved = 10 Coinbase, unmetered) ──
        'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,ADAUSDT,'
        'AVAXUSDT,LINKUSDT,LTCUSDT,DOTUSDT,DOGEUSDT'
    )
    timeframe: str = '1h'
    min_confidence: int = 55
    max_consecutive_losses: int = 3
    daily_loss_cap: int = 5
    max_active_per_symbol: int = 1

    # Broker Reality Sync (truth layer). DORMANT by default: the reconciler
    # only runs when explicitly enabled, so it never journals paper/testnet
    # noise. Enable once a LIVE broker is connected. Interval can drop to
    # 5–15s once live; default conservative to respect broker rate limits.
    broker_sync_enabled: bool = False
    broker_sync_interval_s: int = 30

    # Broker-truth snapshot layer (V4.1). DORMANT by default — enable AFTER the
    # 20240101000073 migration is applied. Persists account/position/equity
    # snapshots from real broker polls (read-only) for historical reconstruction.
    equity_snapshot_enabled: bool = False
    equity_snapshot_interval_s: int = 60

    # App
    port: int = 8001
    environment: str = 'production'
    admin_email: str = ''
    engine_api_key: str = ''
    allowed_origins: str = 'https://algosphere.vercel.app,http://localhost:3000'
    # Web app base URL — engine calls back here to settle copy trades when
    # it auto-closes a signal (settlement logic is single-sourced in TS).
    web_app_url: str = 'https://algospherequant.com'

    @property
    def symbol_list(self) -> list[str]:
        return [s.strip().upper() for s in self.symbols.split(',') if s.strip()]

    @property
    def has_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def has_market_data(self) -> bool:
        return bool(self.twelve_data_api_key or self.polygon_api_key or self.alpha_vantage_api_key)

    @property
    def has_redis(self) -> bool:
        return bool(self.redis_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
