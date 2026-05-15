"""
AlgoSphere Quant — Asset Class Classification & Pip Math
Centralized so RiskEngine and RiskGate share one canonical view.
"""
from __future__ import annotations


ASSET_RISK_TIERS: dict[str, float] = {
    'forex':     1.0,
    'commodity': 1.0,
    'index':     0.7,
    'metal':     0.5,
    'crypto':    0.3,
}


CRYPTO_PREFIXES = ('BTC', 'ETH', 'XRP', 'LTC', 'BCH', 'DOT', 'ADA', 'SOL', 'DOGE')
INDEX_SYMBOLS = {'US30', 'NAS100', 'SPX500', 'GER40', 'GER30', 'UK100', 'JP225', 'AUS200', 'HK50', 'FRA40'}
COMMODITY_SYMBOLS = {'WTI', 'BRENT', 'USOIL', 'UKOIL', 'NATGAS'}


def asset_class(symbol: str) -> str:
    """Classify a symbol into one of {forex, metal, crypto, index, commodity}."""
    s = symbol.upper()
    if s.startswith('XAU') or s.startswith('XAG') or s.startswith('XPT') or s.startswith('XPD'):
        return 'metal'
    if s in INDEX_SYMBOLS:
        return 'index'
    if s in COMMODITY_SYMBOLS:
        return 'commodity'
    if any(s.startswith(p) for p in CRYPTO_PREFIXES) or s.endswith('USDT'):
        return 'crypto'
    return 'forex'


def pip_size(symbol: str) -> float:
    """Return the price increment representing one pip for this symbol."""
    s = symbol.upper()
    if s.endswith('JPY'):
        return 0.01
    if s.startswith('XAU'):
        return 0.1
    if s.startswith('XAG'):
        return 0.01
    if any(s.startswith(p) for p in CRYPTO_PREFIXES):
        return 1.0
    if s in INDEX_SYMBOLS:
        return 1.0
    if s in COMMODITY_SYMBOLS:
        return 0.01
    return 0.0001  # default forex


def price_to_pips(symbol: str, price_distance: float) -> float:
    p = pip_size(symbol)
    if p == 0:
        return 0.0
    return abs(price_distance) / p


def pips_to_price(symbol: str, pips: float) -> float:
    return pips * pip_size(symbol)
