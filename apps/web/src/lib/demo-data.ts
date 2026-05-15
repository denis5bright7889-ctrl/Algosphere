/**
 * AlgoSphere Quant — Demo Data Generators
 *
 * Synthetic, deterministic data for sandbox accounts. All output is clearly
 * tagged with `engine_version: 'demo'` and `id` prefix 'demo-' so it cannot
 * be confused with real engine output anywhere in the system.
 *
 * Demo data is generated at request time — never persisted to Supabase.
 */
import type { Signal, JournalEntry } from '@/lib/types'

// Deterministic PRNG so the same user sees a stable demo feed across reloads
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// ─── Demo signals ────────────────────────────────────────────────────────────

const DEMO_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', 'US30']
const DEMO_REGIMES = ['trending', 'mean_reversion', 'high_volatility', 'trending']
const DEMO_STRATEGIES = [
  ['trend_continuation'],
  ['liquidity_sweep', 'momentum_breakout'],
  ['momentum_breakout'],
]

/**
 * Generates synthetic signals for a demo account.
 *
 * @param userId        — Supabase user id (used as PRNG seed for stability)
 * @param tier          — 'starter' or 'premium' demo tier
 * @param count         — number of signals to return
 * @param delayMinutes  — for starter demo: signals appear N min behind real time
 */
export function generateDemoSignals(
  userId: string,
  tier: 'starter' | 'premium' | 'vip',
  count: number = 12,
  delayMinutes: number = 0,
): Signal[] {
  const rng = seededRandom(hashString(userId + ':signals'))
  const now = Date.now() - delayMinutes * 60 * 1000

  return Array.from({ length: count }, (_, i) => {
    const pair = DEMO_PAIRS[i % DEMO_PAIRS.length]!
    const direction = rng() > 0.5 ? 'buy' : 'sell'
    const basePrice = mockBasePrice(pair)
    const atrPct = 0.005 + rng() * 0.015
    const entry = basePrice * (1 + (rng() - 0.5) * 0.002)
    const slDist = entry * atrPct * 1.2
    const tp1Dist = entry * atrPct * 1.8
    const tp2Dist = entry * atrPct * 2.5
    const tp3Dist = entry * atrPct * 3.5

    const stop = direction === 'buy' ? entry - slDist : entry + slDist
    const tp1  = direction === 'buy' ? entry + tp1Dist : entry - tp1Dist
    const tp2  = direction === 'buy' ? entry + tp2Dist : entry - tp2Dist
    const tp3  = direction === 'buy' ? entry + tp3Dist : entry - tp3Dist

    const confidence = 55 + Math.floor(rng() * 40)   // 55-95
    const regime = DEMO_REGIMES[i % DEMO_REGIMES.length]!
    const strategies = DEMO_STRATEGIES[i % DEMO_STRATEGIES.length]!

    // Lifecycle: most active, some closed wins, occasional loss
    const r = rng()
    const lifecycle = r > 0.65 ? 'active'
                    : r > 0.4  ? 'tp1_hit'
                    : r > 0.2  ? 'tp2_hit'
                    : r > 0.1  ? 'tp3_hit'
                    : 'stopped'
    const result   = lifecycle === 'stopped' ? 'loss'
                   : lifecycle === 'active'  ? null
                   : 'win'

    return {
      id:               `demo-${userId.slice(0, 6)}-${i}`,
      pair,
      direction:         direction as 'buy' | 'sell',
      entry_price:       round(entry, pair),
      stop_loss:         round(stop, pair),
      take_profit_1:     round(tp1, pair),
      take_profit_2:     round(tp2, pair),
      take_profit_3:     round(tp3, pair),
      risk_reward:       Number((tp1Dist / slDist).toFixed(2)),
      status:            lifecycle === 'active' ? 'active' : 'closed',
      lifecycle_state:   lifecycle,
      result,
      pips_gained:       lifecycle === 'active' ? null : (result === 'win' ? 20 + Math.floor(rng() * 80) : -(15 + Math.floor(rng() * 30))),
      tier_required:     tier,
      confidence_score:  confidence,
      quality_score:     Number(((confidence + 10) / 10).toFixed(1)),
      regime,
      engine_version:    'demo',
      der_score:         Number((0.3 + rng() * 0.7).toFixed(4)),
      entropy_score:     Number((0.5 + rng() * 0.5).toFixed(4)),
      published_at:      new Date(now - i * 45 * 60 * 1000).toISOString(),
      created_at:        new Date(now - i * 45 * 60 * 1000).toISOString(),
      strategies_voted:  strategies,
    } as unknown as Signal
  })
}

// ─── Demo journal entries ────────────────────────────────────────────────────

const SETUP_TAGS = ['breakout', 'trend', 'reversal', 'pullback', 'liquidity_grab']

export function generateDemoJournal(userId: string, count: number = 25): JournalEntry[] {
  const rng = seededRandom(hashString(userId + ':journal'))
  const today = new Date()

  return Array.from({ length: count }, (_, i) => {
    const daysBack = i * 2 + Math.floor(rng() * 2)
    const date = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000)
    const pair = DEMO_PAIRS[i % DEMO_PAIRS.length]!
    const direction = rng() > 0.5 ? 'buy' : 'sell'
    const entry = mockBasePrice(pair) * (1 + (rng() - 0.5) * 0.003)
    const isWin = rng() > 0.42
    const pipsAbs = 12 + Math.floor(rng() * 60)
    const pips = isWin ? pipsAbs : -pipsAbs
    const pnl = pips * 10   // $10/pip proxy
    const lotSize = 0.05 + Math.round(rng() * 50) / 100
    const exit = direction === 'buy'
      ? entry + pips * pipFor(pair)
      : entry - pips * pipFor(pair)

    return {
      id:           `demo-journal-${i}`,
      user_id:      userId,
      pair,
      direction:     direction as 'buy' | 'sell',
      entry_price:   round(entry, pair),
      exit_price:    round(exit, pair),
      lot_size:      lotSize,
      pips,
      pnl:           Number(pnl.toFixed(2)),
      risk_amount:   Number((Math.abs(pnl) * 0.5).toFixed(2)),
      setup_tag:     SETUP_TAGS[i % SETUP_TAGS.length]!,
      notes:         '',
      screenshot_url: null,
      trade_date:    date.toISOString().slice(0, 10),
      created_at:    date.toISOString(),
    } as unknown as JournalEntry
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockBasePrice(pair: string): number {
  switch (pair) {
    case 'XAUUSD': return 2050
    case 'EURUSD': return 1.085
    case 'GBPUSD': return 1.275
    case 'USDJPY': return 152.5
    case 'BTCUSD': return 68500
    case 'US30':   return 39500
    default:       return 100
  }
}

function pipFor(pair: string): number {
  if (pair.endsWith('JPY'))         return 0.01
  if (pair === 'XAUUSD')            return 0.1
  if (pair === 'BTCUSD')            return 1.0
  if (pair === 'US30')              return 1.0
  return 0.0001
}

function round(value: number, pair: string): number {
  if (pair === 'BTCUSD' || pair === 'US30') return Math.round(value * 10) / 10
  if (pair.endsWith('JPY'))                 return Math.round(value * 1000) / 1000
  if (pair === 'XAUUSD')                    return Math.round(value * 100) / 100
  return Math.round(value * 100000) / 100000
}
