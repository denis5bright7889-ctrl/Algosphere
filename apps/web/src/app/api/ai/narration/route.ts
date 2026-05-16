import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateText, isAIAvailable, AIError } from '@/lib/ai'
import { computeTrendProbability } from '@/lib/trend-probability'
import { syntheticBars } from '@/lib/backtest'

// AI Market Narration — converts structured trend probability output into
// 2-paragraph natural-language commentary.
//
// POST { symbol, closes: number[] } OR GET ?symbol=BTCUSDT&seed=42 for demo.

const SYSTEM = `You are a senior macro/technical strategist. Convert structured
technical analysis into clear, concise market commentary. 2 short paragraphs,
no fluff, reference exact numbers from the input. Never advise to buy/sell —
describe what the data shows, leave decisions to the trader.`

async function narrate(symbol: string, closes: number[]): Promise<string> {
  const trend = computeTrendProbability({ closes })
  const lastPrice = closes.at(-1) ?? 0

  const prompt = `Write market commentary for ${symbol} (last close: ${lastPrice.toFixed(4)}).

Technical read:
  Direction:    ${trend.direction} (${trend.probability}% confidence)
  EMA align:    ${trend.factors.ema_alignment.toFixed(2)}    (-1 bearish, +1 bullish)
  Momentum:     ${trend.factors.momentum.toFixed(2)}
  RSI position: ${trend.factors.rsi_position.toFixed(2)}
  MACD:         ${trend.factors.macd_signal.toFixed(2)}
  Volatility:   ${trend.factors.volatility.toFixed(2)}
  Persistence:  ${trend.factors.persistence.toFixed(2)} (autocorr)

Reasons:
${trend.reasons.length ? trend.reasons.map(r => `  - ${r}`).join('\n') : '  - no strong factors'}`

  return generateText({
    prompt,
    systemInstruction: SYSTEM,
    maxTokens:         400,
    temperature:       0.5,
  })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isAIAvailable()) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 })
  }

  const body = await req.json().catch(() => null) as
    { symbol?: string; closes?: number[] } | null

  if (!body?.symbol || !Array.isArray(body.closes) || body.closes.length < 50) {
    return NextResponse.json(
      { error: 'Provide symbol + closes[] with ≥50 numbers' },
      { status: 422 },
    )
  }

  try {
    const narration = await narrate(body.symbol, body.closes)
    const trend     = computeTrendProbability({ closes: body.closes })
    return NextResponse.json({ symbol: body.symbol, trend, narration })
  } catch (e) {
    if (e instanceof AIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 502 })
    }
    return NextResponse.json({ error: 'Narration failed' }, { status: 500 })
  }
}

// Demo: generates synthetic bars + narrates them
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isAIAvailable()) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol') ?? 'BTCUSDT'
  const seed   = parseInt(searchParams.get('seed') ?? '42', 10)
  const closes = syntheticBars(200, seed).map(b => b.close)

  try {
    const narration = await narrate(symbol, closes)
    const trend     = computeTrendProbability({ closes })
    return NextResponse.json({ symbol, trend, narration, demo: true })
  } catch (e) {
    if (e instanceof AIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 502 })
    }
    return NextResponse.json({ error: 'Narration failed' }, { status: 500 })
  }
}
