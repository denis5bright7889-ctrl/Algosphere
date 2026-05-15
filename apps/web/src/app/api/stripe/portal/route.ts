import { NextResponse } from 'next/server'

// Stripe billing portal is disabled — BINANCE-only payment mode is active.
export async function POST() {
  return NextResponse.json(
    { error: 'Stripe billing portal is disabled. Manage your subscription via Settings.' },
    { status: 503 }
  )
}
