import { NextResponse } from 'next/server'
import { computeTrendProbability } from '@/lib/trend-probability'
import { syntheticBars } from '@/lib/backtest'

// AI Trend Probability — POST { closes: number[] } OR ?seed=42 for demo
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { closes?: number[] } | null
  const closes = Array.isArray(body?.closes) && body!.closes.every(v => typeof v === 'number')
    ? body!.closes
    : null
  if (!closes || closes.length < 50) {
    return NextResponse.json({ error: 'Provide closes[] with ≥50 numbers' }, { status: 422 })
  }
  return NextResponse.json(computeTrendProbability({ closes }))
}

// GET — demo using synthetic bars
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const seed = parseInt(searchParams.get('seed') ?? '42', 10)
  const bars = syntheticBars(200, seed)
  const closes = bars.map(b => b.close)
  return NextResponse.json(computeTrendProbability({ closes }))
}
