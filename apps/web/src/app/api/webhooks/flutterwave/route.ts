import { NextResponse } from 'next/server'

// Flutterwave is disabled — BINANCE-only payment mode is active.
export async function POST() {
  return NextResponse.json(
    { error: 'Flutterwave payments are disabled. Platform uses Binance USDT TRC20 only.' },
    { status: 503 }
  )
}
