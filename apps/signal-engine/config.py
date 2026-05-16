from __future__ import annotations
from functools import lru_cache
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
    polygon_api_key: str = ''
    alpha_vantage_api_key: str = ''

    # Redis (optional)
    redis_url: str = ''

    # Engine
    signal_engine_enabled: bool = True
    scan_interval_minutes: int = 5
    symbols: str = 'XAUUSD,EURUSD,GBPUSD,USDJPY'
    timeframe: str = '1h'
    min_confidence: int = 55
    max_consecutive_losses: int = 3
    daily_loss_cap: int = 5
    max_active_per_symbol: int = 1

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
