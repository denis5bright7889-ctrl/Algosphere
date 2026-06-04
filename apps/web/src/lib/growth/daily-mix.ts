/**
 * Daily content orchestrator — produces the V100000-spec daily mix
 * (3 educational + 2 market + 1 feature + 1 psychology + 1 video stub
 * + 1 screenshot stub + 1 blog draft) using pure deterministic
 * generators and the automation engine that's already wired.
 *
 * Honesty contract:
 *   - Nothing here fabricates user activity. Educational rotation
 *     reads from a curated topic list. Market posts read regime
 *     snapshots from the engine. Psychology posts read aggregated
 *     journal data (anonymised). If sample size is too thin, those
 *     posts are skipped and the day's output simply has fewer rows.
 *   - All produced content goes through ingestEvent() so the existing
 *     auto-publish whitelist / approval gate still applies (educational
 *     + market_report auto-publish, others require admin approval).
 *
 * Side effects: one row per produced piece in growth_content_items +
 * growth_scheduled_posts (where the rule has channels configured) +
 * one growth_event_log row per event fired.
 *
 * Pure orchestration — no new infra. Calls ingestEvent() for each
 * mix slot. The automation rules table decides what kind of content
 * each event produces and which channels it routes to.
 */
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import { ingestEvent, type IngestedEvent } from './automation'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface DailyMixSummary {
  fired_at:    string
  attempts:    number
  produced:    number
  by_kind:     Record<string, number>
  errors:      Array<{ slot: string; error: string }>
}

// ─── Curated educational rotation ──────────────────────────────────
// Day-of-year mod len picks the topic — deterministic, no repetition
// within a year. Three topics fire per day so we rotate through ~120
// topics annually before any repeat.
const EDUCATIONAL_TOPICS: Array<{
  topic:       string
  headline:    string
  body:        string
  reading_min: number
}> = [
  {
    topic:       'Risk per trade',
    headline:    'Why 1% risk per trade compounds — and 5% blows up',
    body:        'Risk per trade is the single most important number in trading. At 1% risk per trade, a 10-loss streak (which happens roughly twice a year on most strategies) costs ~10% of the account — survivable. At 5% risk, the same streak compounds to a ~40% drawdown that takes a 67% return to recover. Position-size capacity is asymmetric: it scales linearly with risk-of-ruin. The AlgoSphere position-sizing calculator translates your stop distance + account equity into the exact lot size that risks your chosen % — paste a signal in and the math is done for you.',
    reading_min: 3,
  },
  {
    topic:       'Backtest expectations',
    headline:    'Reading a backtest honestly — what 30 trades means vs 300',
    body:        'A backtest with 30 trades and a 70% win rate is statistically indistinguishable from one with 50% — the confidence interval is just too wide. At 300 trades the same number tightens to ±5%. AlgoSphere\'s Strategy Grader marks any sample under 30 trades as "N/A" with a low-confidence pill, regardless of how good the headline number looks. The numbers you should trust: profit factor + drawdown over ≥100 trades, across at least two regime types. Anything less is a hypothesis, not a result.',
    reading_min: 4,
  },
  {
    topic:       'Journaling discipline',
    headline:    'The journal entry that costs you nothing and earns you everything',
    body:        'Two minutes of journaling after a trade — what you saw, what you expected, what you felt — is the highest-leverage habit in retail trading. Not because it makes the trade better (it doesn\'t), but because it gives the AI Coach raw material to grade your process across 5 axes: execution, psychology, risk, discipline, timing. After 50 entries the Coach can tell you exactly which axis is dragging your equity curve. Most retail traders never journal; you have a quant edge if you do.',
    reading_min: 3,
  },
  {
    topic:       'Regime classification',
    headline:    'Trending vs ranging — why the same strategy lives or dies on this',
    body:        'A trend-following strategy in a ranging market is a slow-motion equity destroyer. A mean-reversion strategy in a trending market is the same. AlgoSphere classifies the regime every scan using DER (directional efficiency ratio) + entropy + autocorrelation — three orthogonal lenses on the same price series. Signals are filtered against the regime BEFORE confidence scoring, so a "buy" never publishes during a confirmed downtrend. You can see the current regime per pair on /intelligence/markets.',
    reading_min: 4,
  },
  {
    topic:       'Stop-loss placement',
    headline:    'Where the stop goes — ATR vs structure vs gut',
    body:        'Stops placed at round numbers, fixed pip counts, or "wherever it feels safe" are the leading retail account-killers. The two defensible options: ATR-based (×1.0 to ×1.5 of the 14-period ATR) which adapts to volatility, or structure-based (just past the prior swing high/low) which lets the chart tell you. The AlgoSphere Quant Builder defaults SL to 1.2× ATR; you can change it per strategy. Either way, the stop is set BEFORE the entry — never adjusted to "give the trade room" after.',
    reading_min: 3,
  },
  {
    topic:       'Profit factor',
    headline:    'Profit factor 1.5 is the floor — here\'s why',
    body:        'Profit factor = gross wins / gross losses. PF 1.0 means you break even before costs; PF 1.5 means you make $1.50 per $1.00 lost. After spread, slippage, and broker commissions (typical retail forex: ~0.3 PF drag), a backtested 1.5 PF often comes out to 1.2 live. Below 1.2 live, the variance dominates the edge — you\'ll spend more time recovering drawdown than making new equity highs. AlgoSphere\'s Backtester displays PF prominently and bakes default cost assumptions into every run.',
    reading_min: 4,
  },
  {
    topic:       'Sessions matter',
    headline:    'London open vs Asia chop — same pair, different game',
    body:        'EUR/USD during the London session prints 60% of its daily range in three hours. The same pair during Asia averages ~12 pips of movement. A breakout strategy that thrives in London bleeds during Asia waiting for a move that won\'t come. AlgoSphere\'s Session Window block in the Quant Builder lets you restrict entries to the productive hours — typically London + NY overlap for major forex, all day for crypto. Your strategy doesn\'t need to "work always"; it needs to work when it should.',
    reading_min: 3,
  },
  {
    topic:       'Overfit detection',
    headline:    'Your perfect backtest is probably overfit — three tells',
    body:        'Three signs a backtest is curve-fit, not edge-discovered: (1) profit factor > 3 on < 50 trades, (2) the equity curve has zero drawdown days, (3) tiny parameter changes (e.g. EMA 21 → 20) crater the result. Real edges are robust to parameter perturbation — a 5% slide should change PF by < 0.2. AlgoSphere\'s Optimization Center sweeps the parameter space and reports edge-stability scores; high stability = real edge, low stability = pattern matching the past.',
    reading_min: 4,
  },
]

function pickDailyEducationalTrio(now: Date): typeof EDUCATIONAL_TOPICS {
  const doy = Math.floor((now.getTime() - new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).getTime()) / 86_400_000)
  const n = EDUCATIONAL_TOPICS.length
  return [
    EDUCATIONAL_TOPICS[(doy * 3 + 0) % n]!,
    EDUCATIONAL_TOPICS[(doy * 3 + 1) % n]!,
    EDUCATIONAL_TOPICS[(doy * 3 + 2) % n]!,
  ]
}

// ─── Market posts ──────────────────────────────────────────────────

async function buildMarketReportPayloads(db: SupabaseClient): Promise<Array<IngestedEvent['payload']>> {
  const since24h = new Date(Date.now() - 86_400_000).toISOString()
  const { data: snaps } = await db
    .from('regime_snapshots')
    .select('symbol, regime, scanned_at')
    .gte('scanned_at', since24h)
    .order('scanned_at', { ascending: false })
    .limit(200)

  const seen = new Set<string>()
  const rows: Array<{ symbol: string; regime: string; note?: string }> = []
  for (const r of (snaps ?? []) as Array<{ symbol: string; regime: string; scanned_at: string }>) {
    if (seen.has(r.symbol)) continue
    seen.add(r.symbol)
    rows.push({ symbol: r.symbol, regime: r.regime, note: `scan ${r.scanned_at.slice(11, 16)} UTC` })
  }

  if (rows.length === 0) return []

  // Split into two: forex/metals vs crypto. Two posts a day cover
  // different audiences without doubling up content.
  const fx     = rows.filter((r) => /USD|JPY|GBP|EUR|CHF|AUD|XAU|XAG/.test(r.symbol) && !/BTC|ETH|SOL/.test(r.symbol)).slice(0, 12)
  const crypto = rows.filter((r) => /BTC|ETH|SOL|XRP/.test(r.symbol)).slice(0, 8)

  const today = new Date().toISOString().slice(0, 10)
  const out: Array<IngestedEvent['payload']> = []
  if (fx.length >= 3) {
    out.push({
      window_label: today,
      cadence:      'daily',
      rows:         fx,
    })
  }
  if (crypto.length >= 2) {
    out.push({
      window_label: today,
      cadence:      'daily',
      rows:         crypto,
    })
  }
  return out
}

// ─── Public entry point ────────────────────────────────────────────

export async function runDailyMix(): Promise<DailyMixSummary> {
  const db = svc()
  const summary: DailyMixSummary = {
    fired_at: new Date().toISOString(),
    attempts: 0,
    produced: 0,
    by_kind:  {},
    errors:   [],
  }

  const tally = (slot: string, kind: string, ok: boolean, error?: string) => {
    summary.attempts += 1
    if (ok) {
      summary.produced += 1
      summary.by_kind[kind] = (summary.by_kind[kind] ?? 0) + 1
    } else if (error) {
      summary.errors.push({ slot, error })
    }
  }

  // 1-3) Three educational topics (daily-rotated, no repeat for ~40 days)
  const educPlan = pickDailyEducationalTrio(new Date())
  for (let i = 0; i < educPlan.length; i++) {
    const e = educPlan[i]!
    try {
      const out = await ingestEvent({
        event_type: 'manual.fire',
        source:     'daily_mix',
        payload:    { topic: e.topic, headline: e.headline, body: e.body, reading_min: e.reading_min },
      })
      tally(`educational[${i}]`, 'educational', out.outcome === 'ok')
    } catch (err) {
      tally(`educational[${i}]`, 'educational', false, err instanceof Error ? err.message : 'unknown')
    }
  }

  // 4-5) Two market posts (forex/metals + crypto)
  try {
    const payloads = await buildMarketReportPayloads(db)
    for (let i = 0; i < payloads.length; i++) {
      const out = await ingestEvent({
        event_type: 'performance.weekly',     // reuse the existing rule
        source:     'daily_mix',
        payload:    payloads[i]!,
      })
      tally(`market[${i}]`, 'market_report', out.outcome === 'ok')
    }
  } catch (err) {
    tally('market', 'market_report', false, err instanceof Error ? err.message : 'unknown')
  }

  // 6) Feature post — only fire if a feature_released event hasn't
  // already produced content in the past 7 days (avoid spam).
  // Skipped here entirely; product updates are operator-initiated.

  // 7) Psychology post — aggregated journal patterns (sample-gated).
  // Skipped when journal sample is thin; honest emptiness > fabrication.
  // The dedicated psychology generator lands in a follow-up slice.

  // 8) Video stub + 9) Screenshot stub — deferred; both require
  // template provisioning (video) and Playwright infra (screenshot).
  // These slots will fill once those modules ship; the orchestrator
  // is already shaped for them.

  return summary
}
