import { NextResponse } from 'next/server'

// Stripe is disabled — BINANCE-only payment mode is active.
// This route returns 503 so external callers get a meaningful error
// instead of a crash from missing env vars.
export async function POST() {
  return NextResponse.json(
    { error: 'Stripe payments are disabled. Platform uses Binance USDT TRC20 only.' },
    { status: 503 }
  )
}
