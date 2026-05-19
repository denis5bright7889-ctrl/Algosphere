/** Normalised quote returned by every market-data adapter. */
export interface Quote {
  /** Provider's symbol string (e.g. 'EUR/USD' for TD, 'AAPL' for FH). */
  symbol:    string
  price:     number
  /** 24h / day percent change, as a percent number (e.g. -1.23 = -1.23%). */
  changePct: number
  source:    'twelvedata' | 'finnhub'
  fetchedAt: string
}
