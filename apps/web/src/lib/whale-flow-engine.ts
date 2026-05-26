/**
 * Whale Flow Intelligence Engine — institutional capital movement.
 *
 * Mirrors the smart-money-engine pattern (PR #26) but answers a different
 * question: "Where is large capital MOVING — accumulation vs distribution,
 * ecosystem rotation, defensive vs aggressive positioning, cross-chain
 * positioning?" — NOT "what wallets moved tokens."
 *
 * 4-layer composer:
 *   Layer 1  Capital Movement Summary     — universe-level movement metrics
 *   Layer 2  Capital Movement Categories  — classified flow types
 *   Layer 3  Significant Movements        — filtered, conviction-scored
 *   Layer 4  Movement Intelligence Table  — secondary, improved columns
 *
 * Same source (Nansen tokenScreener) as Smart Money, but ordered by
 * absolute netflow magnitude and filtered for significance (institutional
 * minimums, no micro flows). Movement-state classifications replace the
 * raw 'in/out' tags the old page used.
 *
 * Anti-cloning rules:
 *   - never expose raw netflow / wallet labels / FDV ratios
 *   - only expose MOVEMENT STATES, BIAS, AGGRESSION, CONFIDENCE, NARRATIVE
 *   - filtering thresholds live here, never in the response
 */
import 'server-only'
import { tokenScreener, isNansenConfigured, type NansenToken, type NansenChain } from '@/lib/nansen'
import { sectorOf, SECTOR_LABEL, type Sector } from '@/lib/token-sectors'

// ── Public types ─────────────────────────────────────────────────────────

export type MovementState =
  | 'Institutional Accumulation'   // very large, sustained, smart-money-aligned
  | 'Stealth Accumulation'         // sizable but quiet — high inflow, low price action
  | 'Ecosystem Rotation'           // intra-sector / intra-chain capital movement
  | 'Cross-chain Positioning'      // movement spanning chains (proxy: high volume across chains)
  | 'Aggressive Rotation'          // large directional movement with momentum
  | 'Momentum Chasing'             // movement following recent price action
  | 'Distribution Pressure'        // sustained net outflows
  | 'Defensive Capital Movement'   // movement into stables or established L1s
  | 'Speculative Risk'             // movement into low-liquidity speculative names
  | 'Capital Fragmentation'        // movement dispersed across many small destinations
  | 'Flat'

export type MovementBias = 'Accumulation' | 'Distribution' | 'Balanced'
export type Aggression   = 'Aggressive' | 'Moderate' | 'Measured' | 'Quiet'
export type Persistence  = 'Sustained' | 'Building' | 'Fading' | 'Sporadic'
export type ConvictionLevel = 'Very High' | 'High' | 'Moderate' | 'Weak'

export interface CapitalMovementSummary {
  movement_bias:           MovementBias
  dominant_movement:       MovementState
  movement_aggression:     Aggression
  capital_persistence:     Persistence
  /** % of universe netflow concentrated in the top 5 tokens. */
  concentration_pct:       number
  /** Distinct chains showing meaningful movement. */
  active_chains:           number
  /** 0..100 composite institutional-confidence score for the read. */
  confidence:              number
  conviction_level:        ConvictionLevel
}

export interface MovementCategoryRow {
  category:                MovementState
  share_of_flow_pct:       number               // 0..100
  capital_flow_usd:        number               // signed; positive = inflow, negative = outflow
  count:                   number               // number of tokens in this bucket
  /** Up to 3 representative tickers in this category. */
  top_tickers:             string[]
  narrative:               string
}

export interface SignificantMovement {
  symbol:                  string
  chain:                   string
  sector:                  string
  movement_state:          MovementState
  bias:                    'Inflow' | 'Outflow'
  conviction:              number               // 0..100
  conviction_level:        ConvictionLevel
  persistence:             Persistence
  aggression:              Aggression
  narrative:               string
}

export interface MovementTableRow {
  symbol:                  string
  chain:                   string
  sector:                  string
  movement_state:          MovementState
  bias:                    'Inflow' | 'Outflow'
  persistence:             Persistence
  /** Display-friendly scale label, never raw USD numbers. */
  size_scale:              'Mega' | 'Large' | 'Mid' | 'Small'
  confidence:              number
}

export interface WhaleFlowView {
  summary:                 CapitalMovementSummary
  categories:              MovementCategoryRow[]
  significant:             SignificantMovement[]
  movement_table:          MovementTableRow[]
  narrative:               string
  generated_at:            string
  partial:                 boolean
  reason?:                 string
}

// ── Tunable filters (hidden) ─────────────────────────────────────────────

const MIN_LIQUIDITY_USD       = 1_000_000     // higher floor than SM — these are whale flows
const MIN_ABS_NETFLOW_USD     = 250_000       // micro flows excluded
const TOP_TICKERS_PER_CAT     = 3
const SIGNIFICANT_MAX         = 8
const MOVEMENT_TABLE_MAX      = 30
const CONCENTRATION_TOP_N     = 5

// Conviction bands
const CONVICTION_VERY_HIGH    = 80
const CONVICTION_HIGH         = 65
const CONVICTION_MODERATE     = 45

// ── Helpers ──────────────────────────────────────────────────────────────

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)) }
function clamp100(v: number): number { return Math.max(0, Math.min(100, Math.round(v))) }
function convictionLevel(score: number): ConvictionLevel {
  if (score >= CONVICTION_VERY_HIGH) return 'Very High'
  if (score >= CONVICTION_HIGH)      return 'High'
  if (score >= CONVICTION_MODERATE)  return 'Moderate'
  return 'Weak'
}

const DEFENSIVE_TICKERS = new Set(['BTC', 'ETH', 'USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'PYUSD', 'USDE'])
const ECOSYSTEM_HUB_CHAINS = new Set<NansenChain>(['ethereum', 'solana', 'base'])

// ── Per-token movement classification ────────────────────────────────────

function classifyMovement(t: NansenToken): MovementState {
  const net      = t.netflow ?? 0
  const buy      = t.buy_volume ?? 0
  const sell     = t.sell_volume ?? 0
  const vol      = t.volume ?? 0
  const pc       = t.price_change ?? 0
  const inflow   = t.inflow_fdv_ratio  ?? 0
  const outflow  = t.outflow_fdv_ratio ?? 0
  const liquidity = t.liquidity ?? 0
  const tickerU  = (t.token_symbol ?? '').toUpperCase()
  const buyDom   = buy + sell > 0 ? (buy - sell) / (buy + sell) : 0
  const isDefensive = DEFENSIVE_TICKERS.has(tickerU)
  const isSpeculative = liquidity < 5_000_000

  // Order: most-specific first.
  if (net < -MIN_ABS_NETFLOW_USD * 2 && outflow > 0.005)
    return 'Distribution Pressure'
  if (inflow > 0.02 && net > 0 && buyDom > 0.2 && Math.abs(pc) < 0.08)
    return 'Institutional Accumulation'
  if (inflow > 0.01 && net > 0 && Math.abs(pc) < 0.03)
    return 'Stealth Accumulation'
  if (net > 0 && pc > 0.05 && buyDom > 0.15)
    return 'Aggressive Rotation'
  if (net > 0 && pc > 0.10 && buyDom < 0.1)
    return 'Momentum Chasing'
  if (net > 0 && isDefensive)
    return 'Defensive Capital Movement'
  if (net > 0 && isSpeculative)
    return 'Speculative Risk'
  if (net > 0 && Math.abs(pc) < 0.04 && vol > 0)
    return 'Ecosystem Rotation'
  if (Math.abs(net) > 0 && vol > 0)
    return 'Capital Fragmentation'
  return 'Flat'
}

function persistenceOf(t: NansenToken): Persistence {
  const inflow  = t.inflow_fdv_ratio  ?? 0
  const outflow = t.outflow_fdv_ratio ?? 0
  const ratio   = outflow > 0 ? inflow / outflow : (inflow > 0 ? 5 : 1)
  if (ratio >= 3 && inflow >= 0.01) return 'Sustained'
  if (ratio >= 1.5)                 return 'Building'
  if (ratio >= 0.7)                 return 'Sporadic'
  return 'Fading'
}

function aggressionOf(t: NansenToken): Aggression {
  const buy = t.buy_volume ?? 0; const sell = t.sell_volume ?? 0
  const dom = buy + sell > 0 ? Math.abs((buy - sell) / (buy + sell)) : 0
  if (dom >= 0.5) return 'Aggressive'
  if (dom >= 0.25) return 'Moderate'
  if (dom >= 0.1)  return 'Measured'
  return 'Quiet'
}

function sizeScaleOf(amountAbs: number, maxAbs: number): MovementTableRow['size_scale'] {
  if (maxAbs <= 0) return 'Small'
  const ratio = amountAbs / maxAbs
  if (ratio >= 0.5)  return 'Mega'
  if (ratio >= 0.15) return 'Large'
  if (ratio >= 0.04) return 'Mid'
  return 'Small'
}

function tokenConviction(t: NansenToken, state: MovementState, persistence: Persistence): number {
  const liquidityComp  = clamp01(Math.log10(Math.max(t.liquidity ?? 1, 1)) / 8)
  const inflowComp     = clamp01((t.inflow_fdv_ratio ?? 0) * 30)
  const breadthComp    = clamp01(Math.log10(Math.max(t.nof_traders ?? 1, 1)) / 4)
  const persistenceBonus = persistence === 'Sustained' ? 0.15 : persistence === 'Building' ? 0.08 : 0
  // Down-weight speculative-risk states — they're real movements but lower-conviction
  const stateBonus = (state === 'Institutional Accumulation' || state === 'Stealth Accumulation') ? 0.10 :
                     (state === 'Speculative Risk' || state === 'Capital Fragmentation') ? -0.05 : 0
  const raw = liquidityComp * 0.35 + inflowComp * 0.30 + breadthComp * 0.20 + 0.15
  return clamp100((raw + persistenceBonus + stateBonus) * 100)
}

// ── Narrative composition ────────────────────────────────────────────────

const CATEGORY_NARRATIVE: Record<MovementState, string> = {
  'Institutional Accumulation': 'Large, sustained inflows aligned with smart-money allocation.',
  'Stealth Accumulation':       'Sizable inflows with muted price action — quiet positioning.',
  'Ecosystem Rotation':         'Intra-ecosystem capital movement without strong directional bias.',
  'Cross-chain Positioning':    'Capital shifting across chains — reallocation in progress.',
  'Aggressive Rotation':        'Aggressive directional flows with price participation.',
  'Momentum Chasing':           'Flows following recent price action — quality variable.',
  'Distribution Pressure':      'Sustained outflows — net distribution behaviour.',
  'Defensive Capital Movement': 'Capital flowing toward established / risk-off names.',
  'Speculative Risk':           'Inflows concentrated in lower-liquidity names — risk elevated.',
  'Capital Fragmentation':      'Movement dispersed without coherent direction.',
  'Flat':                       'No notable movement.',
}

function flowNarrative(symbol: string, state: MovementState, sector: string, persistence: Persistence, aggression: Aggression): string {
  const tag = symbol.replace(/USDT$/, '')
  const intro: Record<MovementState, string> = {
    'Institutional Accumulation': `${tag} under institutional accumulation`,
    'Stealth Accumulation':       `${tag} showing stealth accumulation`,
    'Ecosystem Rotation':         `${tag} catching ecosystem rotation`,
    'Cross-chain Positioning':    `${tag} target of cross-chain positioning`,
    'Aggressive Rotation':        `${tag} attracting aggressive capital`,
    'Momentum Chasing':           `${tag} drawing momentum-chasing flows`,
    'Distribution Pressure':      `${tag} under distribution pressure`,
    'Defensive Capital Movement': `${tag} receiving defensive capital allocation`,
    'Speculative Risk':           `${tag} speculative inflows — caution`,
    'Capital Fragmentation':      `${tag} fragmented movement`,
    'Flat':                       `${tag} flows flat`,
  }
  const sectorClause = sector === 'Other' ? '' : ` in ${sector}`
  const persistClause = persistence === 'Sustained' ? '; sustained' : persistence === 'Building' ? '; building' : persistence === 'Fading' ? '; fading' : ''
  const aggClause = aggression === 'Aggressive' ? '; aggressively one-sided' : aggression === 'Moderate' ? '' : ''
  return `${intro[state]}${sectorClause}${persistClause}${aggClause}.`
}

function topNarrative(summary: CapitalMovementSummary): string {
  const biasWord =
    summary.movement_bias === 'Accumulation' ? 'accumulation-skewed' :
    summary.movement_bias === 'Distribution' ? 'distribution-skewed' : 'balanced'
  const conviction =
    summary.confidence >= CONVICTION_HIGH ? 'high-conviction' :
    summary.confidence >= CONVICTION_MODERATE ? 'moderate-conviction' : 'low-conviction'
  const dom = CATEGORY_NARRATIVE[summary.dominant_movement] ?? ''
  const persistClause =
    summary.capital_persistence === 'Sustained' ? ' Persistence is sustained.' :
    summary.capital_persistence === 'Building'  ? ' Persistence building.'     :
    summary.capital_persistence === 'Fading'    ? ' Persistence fading.'       :
                                                   ' Persistence sporadic.'
  return `Capital movement ${biasWord} with ${conviction} flows; dominant pattern: ${dom.toLowerCase()}${persistClause}`
}

// ── Layer composers ──────────────────────────────────────────────────────

function buildSummary(rows: NansenToken[]): CapitalMovementSummary {
  const known = rows.filter((r) => Math.abs(r.netflow ?? 0) >= MIN_ABS_NETFLOW_USD)
  if (known.length === 0) {
    return {
      movement_bias: 'Balanced', dominant_movement: 'Flat',
      movement_aggression: 'Quiet', capital_persistence: 'Sporadic',
      concentration_pct: 0, active_chains: 0,
      confidence: 0, conviction_level: 'Weak',
    }
  }
  const inflowSum  = known.reduce((s, t) => s + Math.max(0, t.netflow), 0)
  const outflowSum = known.reduce((s, t) => s + Math.max(0, -t.netflow), 0)
  const netRatio   = (inflowSum - outflowSum) / Math.max(inflowSum + outflowSum, 1)
  const bias: MovementBias = netRatio > 0.15 ? 'Accumulation' : netRatio < -0.15 ? 'Distribution' : 'Balanced'

  // Dominant movement: most common classification weighted by |netflow|
  const stateFlow = new Map<MovementState, number>()
  for (const t of known) {
    const s = classifyMovement(t)
    stateFlow.set(s, (stateFlow.get(s) ?? 0) + Math.abs(t.netflow))
  }
  const [domState] = [...stateFlow.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['Flat' as MovementState, 0]

  // Aggression: average per-token aggression converted to label
  const aggCount = { Aggressive: 0, Moderate: 0, Measured: 0, Quiet: 0 } as Record<Aggression, number>
  for (const t of known) aggCount[aggressionOf(t)] += 1
  const aggregateAggression: Aggression =
    aggCount.Aggressive > known.length * 0.3 ? 'Aggressive' :
    aggCount.Aggressive + aggCount.Moderate > known.length * 0.4 ? 'Moderate' :
    aggCount.Quiet > known.length * 0.5 ? 'Quiet' : 'Measured'

  // Persistence: average per-token persistence
  const persCount = { Sustained: 0, Building: 0, Fading: 0, Sporadic: 0 } as Record<Persistence, number>
  for (const t of known) persCount[persistenceOf(t)] += 1
  const aggregatePersistence: Persistence =
    persCount.Sustained > known.length * 0.3 ? 'Sustained' :
    persCount.Building  > known.length * 0.3 ? 'Building'  :
    persCount.Fading    > known.length * 0.4 ? 'Fading'    : 'Sporadic'

  // Concentration: top-5 share of total absolute flow
  const sorted = [...known].sort((a, b) => Math.abs(b.netflow) - Math.abs(a.netflow))
  const totalAbs = known.reduce((s, t) => s + Math.abs(t.netflow), 0)
  const topAbs   = sorted.slice(0, CONCENTRATION_TOP_N).reduce((s, t) => s + Math.abs(t.netflow), 0)
  const concentrationPct = totalAbs > 0 ? (topAbs / totalAbs) * 100 : 0

  // Active chains
  const activeChains = new Set(known.map((t) => t.chain)).size

  // Confidence: composite from liquidity quality + persistence + bias clarity
  const meanLiquidity = known.reduce((s, t) => s + (t.liquidity ?? 0), 0) / known.length
  const liqQuality    = clamp01(Math.log10(Math.max(meanLiquidity, 1)) / 8)
  const biasClarity   = Math.abs(netRatio)
  const persistQuality = aggregatePersistence === 'Sustained' ? 1 : aggregatePersistence === 'Building' ? 0.7 : 0.4
  const confidence    = clamp100((liqQuality * 0.35 + biasClarity * 0.35 + persistQuality * 0.30) * 100)

  return {
    movement_bias:        bias,
    dominant_movement:    domState,
    movement_aggression:  aggregateAggression,
    capital_persistence:  aggregatePersistence,
    concentration_pct:    Number(concentrationPct.toFixed(1)),
    active_chains:        activeChains,
    confidence,
    conviction_level:     convictionLevel(confidence),
  }
}

function buildCategories(rows: NansenToken[]): MovementCategoryRow[] {
  const agg = new Map<MovementState, { flow: number; count: number; tickers: string[] }>()
  for (const t of rows) {
    if (Math.abs(t.netflow ?? 0) < MIN_ABS_NETFLOW_USD) continue
    if ((t.liquidity ?? 0) < MIN_LIQUIDITY_USD)         continue
    const state = classifyMovement(t)
    const a = agg.get(state) ?? { flow: 0, count: 0, tickers: [] }
    a.flow  += t.netflow
    a.count += 1
    if (a.tickers.length < TOP_TICKERS_PER_CAT && t.token_symbol) a.tickers.push(t.token_symbol.toUpperCase())
    agg.set(state, a)
  }
  if (agg.size === 0) return []
  const totalAbs = [...agg.values()].reduce((s, v) => s + Math.abs(v.flow), 0)
  return [...agg.entries()].map<MovementCategoryRow>(([cat, v]) => ({
    category:            cat,
    share_of_flow_pct:   totalAbs > 0 ? Number((Math.abs(v.flow) / totalAbs * 100).toFixed(1)) : 0,
    capital_flow_usd:    Math.round(v.flow),
    count:               v.count,
    top_tickers:         v.tickers,
    narrative:           CATEGORY_NARRATIVE[cat],
  })).sort((a, b) => b.share_of_flow_pct - a.share_of_flow_pct)
}

function buildSignificantMovements(rows: NansenToken[]): SignificantMovement[] {
  const candidates = rows.filter((t) => {
    if ((t.liquidity ?? 0) < MIN_LIQUIDITY_USD) return false
    if (Math.abs(t.netflow ?? 0) < MIN_ABS_NETFLOW_USD) return false
    return true
  })
  // Score: abs(netflow) * persistence-quality * liquidity-quality
  return candidates.map((t) => {
    const state       = classifyMovement(t)
    const persistence = persistenceOf(t)
    const aggression  = aggressionOf(t)
    const conviction  = tokenConviction(t, state, persistence)
    const sectorName  = SECTOR_LABEL[sectorOf(t.token_symbol)]
    const bias: 'Inflow' | 'Outflow' = t.netflow >= 0 ? 'Inflow' : 'Outflow'
    return {
      symbol:           t.token_symbol.toUpperCase(),
      chain:            t.chain,
      sector:           sectorName,
      movement_state:   state,
      bias,
      conviction,
      conviction_level: convictionLevel(conviction),
      persistence,
      aggression,
      narrative:        flowNarrative(t.token_symbol, state, sectorName, persistence, aggression),
    }
  }).sort((a, b) => b.conviction - a.conviction).slice(0, SIGNIFICANT_MAX)
}

function buildMovementTable(rows: NansenToken[]): MovementTableRow[] {
  const filtered = rows
    .filter((t) => (t.liquidity ?? 0) >= MIN_LIQUIDITY_USD && Math.abs(t.netflow ?? 0) >= MIN_ABS_NETFLOW_USD)
    .slice(0, MOVEMENT_TABLE_MAX)
  const maxAbs = Math.max(...filtered.map((t) => Math.abs(t.netflow ?? 0)), 1)
  return filtered.map<MovementTableRow>((t) => {
    const state       = classifyMovement(t)
    const persistence = persistenceOf(t)
    const conviction  = tokenConviction(t, state, persistence)
    const sectorName  = SECTOR_LABEL[sectorOf(t.token_symbol)]
    const bias: 'Inflow' | 'Outflow' = t.netflow >= 0 ? 'Inflow' : 'Outflow'
    return {
      symbol:         t.token_symbol.toUpperCase(),
      chain:          t.chain,
      sector:         sectorName,
      movement_state: state,
      bias,
      persistence,
      size_scale:     sizeScaleOf(Math.abs(t.netflow ?? 0), maxAbs),
      confidence:     conviction,
    }
  }).sort((a, b) => b.confidence - a.confidence)
}

// ── Public composer ──────────────────────────────────────────────────────

export async function composeWhaleFlowView(opts: { window?: '1h' | '24h' | '7d' | '30d'; limit?: number } = {}): Promise<WhaleFlowView> {
  const generated_at = new Date().toISOString()
  if (!isNansenConfigured()) {
    return emptyView('NANSEN_API_KEY not configured', generated_at)
  }
  let tokens: NansenToken[] = []
  try {
    tokens = await tokenScreener({
      chains:    ['ethereum','solana','base'] as NansenChain[],
      timeframe: opts.window ?? '24h',
      orderBy:   'netflow',
      direction: 'DESC',
      limit:     opts.limit ?? 120,
    })
  } catch (e) {
    return emptyView(e instanceof Error ? e.message : 'Nansen unavailable', generated_at)
  }
  if (tokens.length === 0) {
    return emptyView('Nansen screener returned an empty universe for this window', generated_at)
  }

  const summary       = buildSummary(tokens)
  const categories    = buildCategories(tokens)
  const significant   = buildSignificantMovements(tokens)
  const movement_table = buildMovementTable(tokens)
  const narrative     = topNarrative(summary)

  return { summary, categories, significant, movement_table, narrative, generated_at, partial: false }
}

function emptyView(reason: string, generated_at: string): WhaleFlowView {
  return {
    summary: {
      movement_bias: 'Balanced', dominant_movement: 'Flat',
      movement_aggression: 'Quiet', capital_persistence: 'Sporadic',
      concentration_pct: 0, active_chains: 0,
      confidence: 0, conviction_level: 'Weak',
    },
    categories: [],
    significant: [],
    movement_table: [],
    narrative: `Capital movement intelligence unavailable: ${reason}`,
    generated_at,
    partial: true,
    reason,
  }
}
