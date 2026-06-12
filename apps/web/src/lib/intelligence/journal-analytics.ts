/**
 * Journal Intelligence — deterministic computations on V2 journal entries.
 *
 * Stage-1 building blocks for the AlgoSphere Journal Intelligence Center:
 *   - `lossDrivers`     → why losing trades lose (categorised attribution)
 *   - `conditionEdges`  → which contexts (pair × session × regime × setup ×
 *                         timeframe × emotion) actually produce edge
 *
 * Pure functions. Server-only. No LLM calls. No schema changes.
 *
 * Honesty contract:
 *   - Every output number is derived directly from `journal_entries` rows.
 *   - Cohorts below the minimum-sample threshold are dropped, not faked.
 *   - When the global sample is too small, the report flags `reliable=false`
 *     and the UI is expected to render an insufficient-data state.
 */
import type { JournalEntry } from '@/lib/types'
import {
  assessEdge, EDGE_SURFACE_MIN, EDGE_MIN_TRADES,
  type EdgeConfidence, type EdgeVerdict,
} from './edge-confidence'

// ── V2 journal columns are present at runtime (the page does `select('*')`)
//    but the shared JournalEntry type still reflects the V1 surface. Widen
//    here so this module can safely read the richer behavioural fields.
export interface V2Entry extends JournalEntry {
  emotion_pre?:    string | null
  emotion_post?:   string | null
  session?:        string | null
  timeframe?:      string | null
  market_context?: string | null
  mistakes?:       string[] | null
  rule_violation?: boolean | null
  risk_pct?:       number | null
  ai_score?:       number | null
}

const HOT_EMOTIONS = new Set(['fomo', 'fearful', 'euphoric', 'angry', 'anxious'])
const MIN_TRADES_TOTAL  = 10
const MIN_TRADES_COHORT = 5
const MIN_LOSSES        = 5
const OVER_RISK_PCT     = 2.0 // flag any trade risking > 2 % of account

// ─── Loss Drivers ────────────────────────────────────────────────────────

export interface LossDriver {
  category:        string  // stable machine key — for icons / linking
  label:           string  // human caption
  losses:          number
  loss_share_pct:  number  // losses / total_losses × 100
  net_loss_usd:    number  // signed sum of pnl (always ≤ 0)
}

export interface LossDriversReport {
  reliable:             boolean
  total_losses:         number
  total_net_loss_usd:   number
  drivers:              LossDriver[]  // sorted by loss_share_pct desc
  insufficient_reason?: string
}

export function lossDrivers(entries: V2Entry[]): LossDriversReport {
  const losers = entries.filter((e) =>
    typeof e.pnl === 'number' && (e.pnl as number) < 0,
  )
  if (losers.length < MIN_LOSSES) {
    return {
      reliable:           false,
      total_losses:       losers.length,
      total_net_loss_usd: losers.reduce((s, e) => s + (e.pnl ?? 0), 0),
      drivers:            [],
      insufficient_reason:
        `Need at least ${MIN_LOSSES} losing trades to attribute drivers — currently ${losers.length}.`,
    }
  }

  type Bucket = { losses: number; net: number }
  const buckets = new Map<string, Bucket>()
  const labels  = new Map<string, string>()

  const bump = (key: string, label: string, pnl: number) => {
    labels.set(key, label)
    const b = buckets.get(key) ?? { losses: 0, net: 0 }
    b.losses += 1
    b.net    += pnl
    buckets.set(key, b)
  }

  for (const t of losers) {
    const pnl = t.pnl as number

    if (t.emotion_pre && HOT_EMOTIONS.has(t.emotion_pre.toLowerCase())) {
      bump(`emotion:${t.emotion_pre}`, `Entered ${t.emotion_pre}`, pnl)
    }
    if (t.rule_violation === true) {
      bump('rule_violation', 'Rule violation', pnl)
    }
    if (typeof t.risk_pct === 'number' && t.risk_pct > OVER_RISK_PCT) {
      bump('over_risk', `Risk above ${OVER_RISK_PCT}%`, pnl)
    }
    if (t.market_context === 'news') {
      bump('context:news', 'Traded into news', pnl)
    }
    if (t.market_context === 'volatile') {
      bump('context:volatile', 'Volatile regime', pnl)
    }
    if (t.market_context === 'ranging') {
      bump('context:ranging', 'Ranging market', pnl)
    }
    if (Array.isArray(t.mistakes)) {
      for (const m of t.mistakes) {
        if (typeof m === 'string' && m.trim()) {
          const tag = m.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 32)
          bump(`mistake:${tag}`, prettify(m), pnl)
        }
      }
    }
    if (!t.emotion_pre && !t.market_context && !t.rule_violation &&
        (!Array.isArray(t.mistakes) || t.mistakes.length === 0)) {
      bump('uncategorised', 'No context logged', pnl)
    }
  }

  const total = losers.length
  const totalNet = losers.reduce((s, e) => s + (e.pnl ?? 0), 0)

  const drivers: LossDriver[] = Array.from(buckets.entries())
    .map(([category, b]) => ({
      category,
      label:          labels.get(category) ?? category,
      losses:         b.losses,
      loss_share_pct: round1((b.losses / total) * 100),
      net_loss_usd:   round2(b.net),
    }))
    .sort((a, b) => b.loss_share_pct - a.loss_share_pct)

  return {
    reliable:           true,
    total_losses:       total,
    total_net_loss_usd: round2(totalNet),
    drivers,
  }
}

// ─── Condition Edges (Best / Worst contexts) ─────────────────────────────

export type CohortDim =
  | 'pair' | 'session' | 'market_context'
  | 'setup_tag' | 'timeframe' | 'emotion_pre'

export interface ConditionCohort {
  dim:         CohortDim
  key:         string
  label:       string  // e.g. "Pair · EURUSD"
  trades:      number
  wins:        number
  win_rate:    number  // 0..1
  expectancy:  number  // avg pnl per closed trade
  net_pnl:     number
  // Evidence-first (Phase 6): no cohort is called profitable/unprofitable
  // below EDGE_MIN_TRADES — it's 'insufficient_evidence' instead.
  confidence:  EdgeConfidence
  verdict:     EdgeVerdict
  win_rate_ci: { low: number; high: number }   // 95% Wilson interval
}

export interface ConditionsReport {
  reliable:             boolean
  total_closed:         number
  best:                 ConditionCohort[]
  worst:                ConditionCohort[]
  insufficient:         ConditionCohort[]   // surfaced but below the edge threshold
  insufficient_reason?: string
}

const DIM_LABEL: Record<CohortDim, string> = {
  pair:           'Pair',
  session:        'Session',
  market_context: 'Regime',
  setup_tag:      'Setup',
  timeframe:      'TF',
  emotion_pre:    'Emotion',
}

export function conditionEdges(entries: V2Entry[]): ConditionsReport {
  const closed = entries.filter(
    (e) => typeof e.pnl === 'number' && Number.isFinite(e.pnl),
  )
  if (closed.length < MIN_TRADES_TOTAL) {
    return {
      reliable: false, total_closed: closed.length, best: [], worst: [], insufficient: [],
      insufficient_reason:
        `Need ${MIN_TRADES_TOTAL}+ closed trades to surface condition edges — currently ${closed.length}.`,
    }
  }

  type Bucket = { trades: number; wins: number; net: number }
  const buckets = new Map<string, Bucket>()

  const bump = (dim: CohortDim, raw: string | null | undefined, pnl: number) => {
    if (!raw) return
    const key = raw.trim()
    if (!key) return
    const id = `${dim}::${key}`
    const b = buckets.get(id) ?? { trades: 0, wins: 0, net: 0 }
    b.trades += 1
    if (pnl > 0) b.wins += 1
    b.net    += pnl
    buckets.set(id, b)
  }

  for (const t of closed) {
    const pnl = t.pnl as number
    bump('pair',           t.pair,           pnl)
    bump('session',        t.session,        pnl)
    bump('market_context', t.market_context, pnl)
    bump('setup_tag',      t.setup_tag,      pnl)
    bump('timeframe',      t.timeframe,      pnl)
    bump('emotion_pre',    t.emotion_pre,    pnl)
  }

  // Surface cohorts from EDGE_SURFACE_MIN (so weak samples are shown as
  // "Insufficient Evidence", not silently dropped), and attach the evidence
  // verdict + Wilson CI to every one.
  const cohorts: ConditionCohort[] = Array.from(buckets.entries())
    .filter(([, b]) => b.trades >= EDGE_SURFACE_MIN)
    .map(([id, b]) => {
      const [dim, key] = id.split('::') as [CohortDim, string]
      const winRate    = b.wins / b.trades
      const expectancy = b.net  / b.trades
      const a = assessEdge({ trades: b.trades, expectancy, wins: b.wins })
      return {
        dim, key,
        label:      `${DIM_LABEL[dim]} · ${prettify(key)}`,
        trades:     b.trades,
        wins:       b.wins,
        win_rate:   round3(winRate),
        expectancy: round2(expectancy),
        net_pnl:    round2(b.net),
        confidence: a.confidence,
        verdict:    a.verdict,
        win_rate_ci: { low: round3(a.win_rate_ci!.low), high: round3(a.win_rate_ci!.high) },
      }
    })

  const score = (c: ConditionCohort) =>
    c.win_rate * Math.log1p(c.trades) * Math.sign(c.expectancy || 1) *
    (Math.abs(c.expectancy) ** 0.5 + 0.5)

  const ranked = cohorts.slice().sort((a, b) => score(b) - score(a))
  // Only EVIDENCED cohorts (confidence ≥ low) may be called best/worst.
  const evidenced = ranked.filter((c) => c.confidence !== 'insufficient')
  const best  = evidenced.filter((c) => c.verdict === 'profitable').slice(0, 5)
  const worst = evidenced.slice().reverse().filter((c) => c.verdict === 'unprofitable').slice(0, 5)
  // Weak-sample cohorts are SHOWN as Insufficient Evidence (not faked).
  const insufficient = ranked
    .filter((c) => c.confidence === 'insufficient')
    .sort((a, b) => b.trades - a.trades)
    .slice(0, 8)

  return {
    reliable:     best.length + worst.length > 0,
    total_closed: closed.length,
    best,
    worst,
    insufficient,
    insufficient_reason: best.length + worst.length === 0
      ? `No context has reached ${EDGE_MIN_TRADES}+ closed trades yet — edges stay "Insufficient Evidence" until the sample is statistically defensible.`
      : undefined,
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

function prettify(s: string): string {
  const trimmed = s.trim()
  if (!trimmed) return s
  return trimmed
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function round1(n: number): number { return Math.round(n * 10)   / 10  }
function round2(n: number): number { return Math.round(n * 100)  / 100 }
function round3(n: number): number { return Math.round(n * 1000) / 1000 }
