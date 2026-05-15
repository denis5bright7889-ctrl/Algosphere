import { NextResponse } from 'next/server'

// Stripe checkout is disabled — BINANCE-only payment mode is active.
export async function POST() {
  return NextResponse.json(
    { error: 'Stripe checkout is disabled. Use /api/payments/create for Binance USDT TRC20.' },
    { status: 503 }
  )
}
