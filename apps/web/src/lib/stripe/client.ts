// Stripe is disabled in BINANCE-only mode.
// This module is kept to avoid import errors in files that reference it,
// but no Stripe SDK is initialized — no env vars are required.

export const stripe = null
