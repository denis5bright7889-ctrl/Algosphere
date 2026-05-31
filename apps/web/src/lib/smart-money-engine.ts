/**
 * Smart Money Flow Intelligence Engine.
 *
 * Institutional capital-flow composer. Answers: "Where is intelligent
 * capital moving, how sustainable is participation, what narratives are
 * strengthening, and where is asymmetric opportunity forming?" — NOT
 * "what tokens were bought."
 *
 * The engine composes a 4-layer view from data we already pull:
 *   Layer 1  Market Flow Summary    (8 universe-level metrics)
 *   Layer 2  Sector / Narrative     (rotation by curated sector buckets)
 *   Layer 3  High Conviction Flows  (filtered, fused with Momentum)
 *   Layer 4  Flow Intelligence Table (improved columns, secondary)
 *
 * Anti-cloning rules:
 *   - never expose raw screener numbers (buy_volume / netflow / FDV ratios)
 *   - only expose STATES, BIAS, STRENGTH, CONVICTION, NARRATIVE
 *   - filtering thresholds live here, never in the response
 *
 * Honesty rules (consistent with the rest of the intel layer):
 *   - missing Nansen / Momentum data → marked with reason, not faked
 *   - Layer 1 metrics computed only over data we actually have
 *   - 'Other' sector deliberately kept in rotation when it has signal,
 *     but filtered OUT of High Conviction (no long-tail noise in cards)
 */
import 'server-only'
import { tokenScreener, isNansenConfigured, type NansenToken, type NansenChain } from '@/lib/nansen'
import { sectorOf, SECTOR_LABEL, type Sector } from '@/lib/token-sectors'
import { composeMomentumView, type MomentumView, type MomentumPhase } from '@/lib/momentum-engine'
import { composeBreadthView } from '@/lib/breadth-engine'
import { composeMarketOverview } from '@/lib/coingecko'
import { createClient } from '@/lib/supabase/server'
import { logDecision, fingerprint } from '@/lib/intel-memory'

// ── Public types ─────────────────────────────────────────────────────────

export type FlowState =
  | 'Accumulation'
  | 'Expansion'
  | 'Aggressive Rotation'
  | 'Institutional Build-Up'
  | 'Distribution'
  | 'Speculative Spike'
  | 'Weak Participation'
  | 'Exhaustion'
  | 'Collapse Risk'

/** Dominant wallet-cohort tier active in a token RIGHT NOW (per the brief).
 *  Derived from the token's profile — Nansen screener is aggregated, so we
 *  classify the cohort character rather than per-wallet identities. */
export type WalletTier =
  | 'Institutional'      // high liquidity + SM allocation + low vol + sustained
  | 'Smart Capital'      // strong SM allocation + buy dominance
  | 'Momentum Capital'   // chasing price; high volume, lower SM share
  | 'Speculative'        // low liquidity + extreme moves
  | 'Retail Whale'       // large flow but unsophisticated profile
  | 'Ecosystem Wallet'   // SM-backed in L1/L2/ecosystem token
  | 'Unclassified'

export type ConvictionLevel = 'Very High' | 'High' | 'Moderate' | 'Weak'
export type SmartMoneyBias  = 'Bullish' | 'Bearish' | 'Neutral'
export type RiskAppetite    = 'Defensive' | 'Measured' | 'Elevated' | 'Aggressive'
export type FlowSustainability = 'High' | 'Moderate' | 'Fragile' | 'Weakening'
export type ParticipationQuality = 'Strong' | 'Moderate' | 'Weak' | 'N/A'

export interface MarketFlowSummary {
  smart_money_bias:        SmartMoneyBias
  dominant_rotation:       string                  // sector label, e.g. 'AI'
  capital_concentration:   'Concentrated' | 'Balanced' | 'Dispersed'
  participation_quality:   ParticipationQuality
  risk_appetite:           RiskAppetite
  conviction:              number                  // 0..100 composite
  conviction_level:        ConvictionLevel
  flow_sustainability:     FlowSustainability
  market_aggression:       number                  // 0..100 (one-sidedness of order flow)
}

export interface SectorRotationRow {
  sector:                  string                  // institutional label
  direction:               'Strong Inflows' | 'Inflows' | 'Outflows' | 'Weakening' | 'Flat'
  acceleration:            'Accelerating' | 'Steady' | 'Decelerating' | 'N/A'
  participation_quality:   ParticipationQuality
  share_of_flow_pct:       number                  // 0..100 — % of total universe flow
  narrative:               string
  top_tickers:             string[]                // up to 3 representative tickers
}

export interface HighConvictionFlow {
  symbol:                  string
  chain:                   string
  sector:                  string
  flow_state:              FlowState
  momentum_phase:          MomentumPhase | 'Unknown'
  conviction:              number                  // 0..100
  conviction_level:        ConvictionLevel
  smart_money_quality:     number                  // 0..100
  participation_quality:   ParticipationQuality
  /** Dominant wallet-cohort character active in this token RIGHT NOW. */
  wallet_tier:             WalletTier
  risk_label:              'Low' | 'Moderate' | 'Elevated' | 'High'
  confidence:              number                  // 0..100 — composite signal confidence
  narrative:               string                  // composed institutional sentence
  fusion_aligned:          boolean                 // SM + Momentum + Regime all aligned
}

export interface FlowIntelligenceRow {
  symbol:                  string
  chain:                   string
  sector:                  string
  flow_state:              FlowState
  smart_money_quality:     number
  sustainability:          FlowSustainability
  narrative:               string                  // short — 1 clause
  confidence:              number
  rotation_alignment:      'Aligned' | 'Mixed' | 'Counter'
}

export interface SmartMoneyFlowView {
  summary:                 MarketFlowSummary
  sectors:                 SectorRotationRow[]
  high_conviction:         HighConvictionFlow[]
  flow_table:              FlowIntelligenceRow[]
  /** Top-of-page institutional AI narrative — composed from summary + sector signals.
   *  ALREADY SANITIZED — never carries provider names, HTTP codes, or credit wording.
   *  Safe to render directly. */
  narrative:               string
  generated_at:            string
  partial:                 boolean
  /** RAW reason (provider error, HTTP code, etc.) — for admin/telemetry only.
   *  NEVER render this directly on the user surface. */
  reason?:                 string
  /** True when summary + narrative came from the internal cross-engine
   *  heuristic rather than the first-party provider. UI should pill this
   *  as "internal model" so users honestly weight the read. */
  fromHeuristic?:          boolean
}

// ── Tunable filters (live here, not exposed in response) ────────────────

const MIN_LIQUIDITY_USD     = 500_000          // institutional minimum
const MIN_VOLUME_USD        = 100_000          // 24h
const MIN_ABS_NETFLOW_USD   = 50_000           // cuts noise
const TOP_TICKERS_PER_SECTOR = 3
const HIGH_CONVICTION_MAX   = 8                // never more than this on the cards
const FLOW_TABLE_MAX        = 30               // secondary table cap

// Convictions
const CONVICTION_VERY_HIGH  = 80
const CONVICTION_HIGH       = 65
const CONVICTION_MODERATE   = 45

// ── Helpers ──────────────────────────────────────────────────────────────

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)) }
function clamp100(v: number): number { return Math.max(0, Math.min(100, Math.round(v))) }
function gini(values: number[]): number {
  // Concentration measure 0..1 — 0 fully dispersed, 1 fully concentrated
  const vs = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (vs.length === 0) return 0
  const n = vs.length
  let cum = 0, weighted = 0
  for (let i = 0; i < n; i++) { cum += vs[i]!; weighted += (i + 1) * vs[i]! }
  const sum = cum || 1
  return clamp01((2 * weighted) / (n * sum) - (n + 1) / n)
}

function convictionLevel(score: number): ConvictionLevel {
  if (score >= CONVICTION_VERY_HIGH) return 'Very High'
  if (score >= CONVICTION_HIGH)      return 'High'
  if (score >= CONVICTION_MODERATE)  return 'Moderate'
  return 'Weak'
}

// ── Per-token derivations ────────────────────────────────────────────────

function smartMoneyQuality(t: NansenToken): number {
  // Composite 0..100 — sustainability, allocation strength, persistence proxy.
  // We deliberately do NOT surface the formula in the response.
  const inflow  = clamp01(t.inflow_fdv_ratio  ?? 0)   // 0..(very small) typically
  const outflow = clamp01(t.outflow_fdv_ratio ?? 0)
  const allocStrength    = clamp01(inflow * 60)
  const buyDominance     = clamp01((t.buy_volume - t.sell_volume) / Math.max(t.buy_volume + t.sell_volume, 1) * 0.5 + 0.5)
  const liquidityQuality = clamp01(Math.log10(Math.max(t.liquidity ?? 1, 1)) / 8)   // log-scaled; $100M liquidity ~ 1.0
  const traderBreadth    = clamp01(Math.log10(Math.max(t.nof_traders ?? 1, 1)) / 4) // log-scaled; ~10k traders ~ 1.0
  const score = (
    allocStrength       * 0.40 +
    buyDominance        * 0.20 +
    liquidityQuality    * 0.20 +
    traderBreadth       * 0.10 +
    clamp01(Math.max(0, -outflow * 10)) * 0.10  // penalise heavy outflow
  ) * 100
  return clamp100(score)
}

function flowState(t: NansenToken): FlowState {
  const buy   = t.buy_volume   ?? 0
  const sell  = t.sell_volume  ?? 0
  const net   = t.netflow      ?? 0
  const vol   = t.volume       ?? 0
  const pc    = t.price_change ?? 0       // ratio: 0.12 = +12%
  const inflowRatio = t.inflow_fdv_ratio ?? 0
  const buyDom = buy + sell > 0 ? (buy - sell) / (buy + sell) : 0   // -1..+1

  // Order matters — most-specific first
  if (net < 0 && pc <= -0.05 && vol > 0) return 'Collapse Risk'
  if (pc <= -0.03 && sell > buy)         return 'Distribution'
  if (pc >= 0.10 && buyDom < 0.1)        return 'Speculative Spike'
  if (pc >= 0.04 && buyDom > 0.2 && inflowRatio > 0.005)
                                          return 'Aggressive Rotation'
  if (inflowRatio > 0.01 && buyDom > 0.15 && Math.abs(pc) < 0.08)
                                          return 'Institutional Build-Up'
  if (buyDom > 0.05 && pc >= 0.01 && pc < 0.06) return 'Expansion'
  if (buyDom > 0 && Math.abs(pc) < 0.02 && vol > 0) return 'Accumulation'
  if (vol > 0 && buy + sell < vol * 0.3) return 'Weak Participation'
  if (pc < 0.005 && buyDom < 0.05)       return 'Exhaustion'
  return 'Weak Participation'
}

function riskLabel(t: NansenToken, quality: number): 'Low' | 'Moderate' | 'Elevated' | 'High' {
  const liq = t.liquidity ?? 0
  const age = t.token_age_days ?? 0
  if (liq < 1_000_000 || age < 30) return 'High'
  if (liq < 10_000_000 || age < 90) return 'Elevated'
  if (liq < 50_000_000 || quality < 50) return 'Moderate'
  return 'Low'
}

/** Classify the dominant wallet-cohort character active in a token RIGHT NOW.
 *  Nansen screener is aggregated (no per-wallet data here), so we classify
 *  the cohort PROFILE — not individual wallets. Same honesty rule as
 *  everywhere else: no per-wallet attribution is fabricated. */
function walletTierOf(t: NansenToken, sector: Sector, smQuality: number): WalletTier {
  const liq      = t.liquidity ?? 0
  const inflow   = t.inflow_fdv_ratio  ?? 0
  const breadth  = t.nof_traders ?? 0
  const pcAbs    = Math.abs(t.price_change ?? 0)
  const buy      = t.buy_volume ?? 0; const sell = t.sell_volume ?? 0
  const buyDom   = buy + sell > 0 ? Math.abs((buy - sell) / (buy + sell)) : 0
  const ecosystem = sector === 'L1' || sector === 'L2'

  // Order most-specific first.
  if (liq >= 50_000_000 && smQuality >= 70 && inflow >= 0.015 && pcAbs < 0.06)
    return 'Institutional'
  if (smQuality >= 65 && inflow >= 0.010 && buyDom >= 0.20)
    return 'Smart Capital'
  if (ecosystem && smQuality >= 55 && inflow >= 0.005)
    return 'Ecosystem Wallet'
  if (liq < 5_000_000 && pcAbs >= 0.08)
    return 'Speculative'
  if (pcAbs >= 0.04 && smQuality < 50 && buy + sell > 0)
    return 'Momentum Capital'
  if (breadth < 200 && liq >= 5_000_000)
    return 'Retail Whale'
  return 'Unclassified'
}

function participationQualityOf(t: NansenToken): ParticipationQuality {
  const breadth = t.nof_traders ?? 0
  const liqOk   = (t.liquidity ?? 0) >= MIN_LIQUIDITY_USD
  if (!liqOk) return 'Weak'
  if (breadth >= 1000)  return 'Strong'
  if (breadth >= 250)   return 'Moderate'
  if (breadth >= 50)    return 'Weak'
  return 'N/A'
}

function sustainabilityOf(t: NansenToken): FlowSustainability {
  const inflow  = t.inflow_fdv_ratio  ?? 0
  const outflow = t.outflow_fdv_ratio ?? 0
  const ratio   = outflow > 0 ? inflow / outflow : (inflow > 0 ? 5 : 1)
  if (ratio >= 3 && inflow >= 0.01)  return 'High'
  if (ratio >= 1.5)                  return 'Moderate'
  if (ratio >= 0.7)                  return 'Fragile'
  return 'Weakening'
}

// ── Narrative composition (rule-based; institutional voice) ─────────────

function flowNarrative(symbol: string, state: FlowState, sector: string, momentumPhase: MomentumPhase | 'Unknown', sus: FlowSustainability, qual: ParticipationQuality): string {
  const tag = symbol.replace(/USDT$/, '')
  const fused = momentumPhase === 'Trending' || momentumPhase === 'Expansion'
  const intro: Record<FlowState, string> = {
    'Accumulation':           `${tag} showing quiet accumulation`,
    'Expansion':              `${tag} expanding with constructive participation`,
    'Aggressive Rotation':    `${tag} attracting aggressive capital rotation`,
    'Institutional Build-Up': `${tag} under sustained institutional build-up`,
    'Distribution':           `${tag} showing distribution behaviour`,
    'Speculative Spike':      `${tag} in speculative-spike pricing`,
    'Weak Participation':     `${tag} flows weak — low conviction window`,
    'Exhaustion':             `${tag} momentum exhausting`,
    'Collapse Risk':          `${tag} carries collapse risk — defensive only`,
  }
  const sectorClause = sector === 'Other' ? '' : ` (${sector})`
  const sustainClause =
    sus === 'High'      ? '; sustainability strong' :
    sus === 'Moderate'  ? '; sustainability moderate' :
    sus === 'Fragile'   ? '; sustainability fragile' :
                          '; sustainability weakening'
  const qualClause =
    qual === 'Strong'   ? ', broad participation' :
    qual === 'Moderate' ? ', moderate participation' :
                          ''
  const fusionClause = fused && (state === 'Institutional Build-Up' || state === 'Expansion' || state === 'Aggressive Rotation')
    ? '. Momentum + flow aligned.' : '.'
  return `${intro[state]}${sectorClause}${sustainClause}${qualClause}${fusionClause}`
}

function topNarrative(summary: MarketFlowSummary, topSector: string): string {
  const biasWord =
    summary.smart_money_bias === 'Bullish' ? 'constructive' :
    summary.smart_money_bias === 'Bearish' ? 'defensive'    : 'mixed'
  const conviction =
    summary.conviction >= CONVICTION_HIGH ? 'high-conviction' :
    summary.conviction >= CONVICTION_MODERATE ? 'moderate-conviction' :
    'low-conviction'
  const risk =
    summary.risk_appetite === 'Aggressive' ? 'aggressive risk-on positioning' :
    summary.risk_appetite === 'Elevated'   ? 'elevated risk appetite'         :
    summary.risk_appetite === 'Measured'   ? 'measured risk appetite'         :
                                              'defensive positioning'
  const sustain =
    summary.flow_sustainability === 'High'      ? ' Flow sustainability strong.'      :
    summary.flow_sustainability === 'Moderate'  ? ' Flow sustainability moderate.'    :
    summary.flow_sustainability === 'Fragile'   ? ' Flow sustainability fragile.'     :
                                                   ' Flow sustainability weakening.'
  return `Smart money positioning ${biasWord} with ${conviction} flows; dominant rotation into ${topSector}, ${risk}.${sustain}`
}

// ── Layer composers ──────────────────────────────────────────────────────

function buildSummary(rows: NansenToken[], byTokenQuality: Map<string, number>): MarketFlowSummary {
  const known = rows.filter((r) => r.buy_volume + r.sell_volume > 0)
  if (known.length === 0) {
    return {
      smart_money_bias: 'Neutral', dominant_rotation: 'Other',
      capital_concentration: 'Dispersed', participation_quality: 'N/A',
      risk_appetite: 'Defensive', conviction: 0, conviction_level: 'Weak',
      flow_sustainability: 'Weakening', market_aggression: 0,
    }
  }
  // Bias: net inflow-vs-outflow ratio across the universe
  const inflowSum  = known.reduce((s, t) => s + Math.max(0, t.netflow), 0)
  const outflowSum = known.reduce((s, t) => s + Math.max(0, -t.netflow), 0)
  const netBias    = (inflowSum - outflowSum) / Math.max(inflowSum + outflowSum, 1)
  const bias: SmartMoneyBias = netBias >  0.15 ? 'Bullish' : netBias < -0.15 ? 'Bearish' : 'Neutral'

  // Dominant rotation by sector inflow share
  const sectorFlow = new Map<Sector, number>()
  for (const t of known) {
    const sec = sectorOf(t.token_symbol)
    sectorFlow.set(sec, (sectorFlow.get(sec) ?? 0) + Math.max(0, t.netflow))
  }
  const [domSector] = [...sectorFlow.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['Other' as Sector, 0]
  const dominantRotation = SECTOR_LABEL[domSector] ?? 'Other'

  // Concentration via Gini on net inflows
  const giniScore = gini(known.map((t) => Math.max(0, t.netflow)))
  const concentration: MarketFlowSummary['capital_concentration'] =
    giniScore >= 0.65 ? 'Concentrated' :
    giniScore >= 0.45 ? 'Balanced'     : 'Dispersed'

  // Participation quality: average breadth across top tokens
  const meanBreadth = known.reduce((s, t) => s + (t.nof_traders || 0), 0) / known.length
  const partQual: ParticipationQuality =
    meanBreadth >= 1500 ? 'Strong' :
    meanBreadth >= 400  ? 'Moderate' :
    meanBreadth > 0     ? 'Weak'   : 'N/A'

  // Risk appetite — concentration + bias + price-change spread
  const priceVariance = (() => {
    const pcs = known.map((t) => t.price_change || 0)
    const mean = pcs.reduce((a, b) => a + b, 0) / pcs.length
    return pcs.reduce((s, v) => s + (v - mean) ** 2, 0) / pcs.length
  })()
  const risk: RiskAppetite =
    bias === 'Bullish' && priceVariance > 0.02 ? 'Aggressive' :
    bias === 'Bullish'                          ? 'Elevated'   :
    bias === 'Neutral'                          ? 'Measured'   :
                                                  'Defensive'

  // Conviction = mean SM quality across top half
  const qualities = [...byTokenQuality.values()].sort((a, b) => b - a)
  const top = qualities.slice(0, Math.max(1, Math.floor(qualities.length / 2)))
  const meanQuality = top.reduce((a, b) => a + b, 0) / Math.max(top.length, 1)
  const conviction = clamp100(meanQuality)

  // Sustainability — inflow_fdv vs outflow_fdv aggregates
  const inflowFdv  = known.reduce((s, t) => s + (t.inflow_fdv_ratio  || 0), 0)
  const outflowFdv = known.reduce((s, t) => s + (t.outflow_fdv_ratio || 0), 0)
  const susRatio = outflowFdv > 0 ? inflowFdv / outflowFdv : (inflowFdv > 0 ? 5 : 0)
  const sustainability: FlowSustainability =
    susRatio >= 3 ? 'High'      :
    susRatio >= 1.5 ? 'Moderate' :
    susRatio >= 0.7 ? 'Fragile'  : 'Weakening'

  // Aggression — universe buy-side dominance
  const totalBuy  = known.reduce((s, t) => s + (t.buy_volume  || 0), 0)
  const totalSell = known.reduce((s, t) => s + (t.sell_volume || 0), 0)
  const aggression = clamp100(Math.abs((totalBuy - totalSell) / Math.max(totalBuy + totalSell, 1)) * 100)

  return {
    smart_money_bias:        bias,
    dominant_rotation:       dominantRotation,
    capital_concentration:   concentration,
    participation_quality:   partQual,
    risk_appetite:           risk,
    conviction,
    conviction_level:        convictionLevel(conviction),
    flow_sustainability:     sustainability,
    market_aggression:       aggression,
  }
}

function buildSectorRotation(rows: NansenToken[]): SectorRotationRow[] {
  // Aggregate per sector; compute direction + acceleration + share + narrative
  const agg = new Map<Sector, { inflow: number; outflow: number; netflow: number; buy: number; sell: number; n: number; tickers: string[]; meanPc: number; pcCount: number }>()
  for (const t of rows) {
    const sec = sectorOf(t.token_symbol)
    const a = agg.get(sec) ?? { inflow: 0, outflow: 0, netflow: 0, buy: 0, sell: 0, n: 0, tickers: [], meanPc: 0, pcCount: 0 }
    a.inflow  += Math.max(0, t.netflow || 0)
    a.outflow += Math.max(0, -(t.netflow || 0))
    a.netflow += t.netflow || 0
    a.buy     += t.buy_volume  || 0
    a.sell    += t.sell_volume || 0
    a.n       += 1
    if (a.tickers.length < TOP_TICKERS_PER_SECTOR && t.token_symbol) a.tickers.push(t.token_symbol.toUpperCase())
    if (typeof t.price_change === 'number' && Number.isFinite(t.price_change)) { a.meanPc += t.price_change; a.pcCount += 1 }
    agg.set(sec, a)
  }
  if (agg.size === 0) return []
  const totalInflow = [...agg.values()].reduce((s, v) => s + v.inflow, 0)

  return [...agg.entries()].map<SectorRotationRow>(([sec, v]) => {
    const sharePct = totalInflow > 0 ? (v.inflow / totalInflow) * 100 : 0
    const meanPc   = v.pcCount > 0 ? v.meanPc / v.pcCount : 0
    const buyDom   = v.buy + v.sell > 0 ? (v.buy - v.sell) / (v.buy + v.sell) : 0
    const direction: SectorRotationRow['direction'] =
      sharePct >= 25 && buyDom > 0.1 ? 'Strong Inflows' :
      buyDom > 0.05 && v.netflow > 0  ? 'Inflows'        :
      buyDom < -0.05 && v.netflow < 0 ? 'Outflows'       :
      v.netflow < 0                   ? 'Weakening'      : 'Flat'
    const acceleration: SectorRotationRow['acceleration'] =
      meanPc >=  0.04 ? 'Accelerating' :
      meanPc <= -0.04 ? 'Decelerating' :
      Math.abs(meanPc) < 0.01 ? 'Steady' : 'N/A'
    const meanBreadth = v.n > 0 ? v.buy / v.n : 0
    const partQual: ParticipationQuality =
      meanBreadth >= 5_000_000 ? 'Strong'   :
      meanBreadth >= 1_000_000 ? 'Moderate' :
      meanBreadth >  0         ? 'Weak'     : 'N/A'
    const sectorName = SECTOR_LABEL[sec]
    const narrative =
      direction === 'Strong Inflows'  ? `${sectorName} attracting strong institutional inflows.` :
      direction === 'Inflows'         ? `${sectorName} seeing constructive inflows.` :
      direction === 'Outflows'        ? `${sectorName} under net distribution.` :
      direction === 'Weakening'       ? `${sectorName} flows weakening.` :
                                         `${sectorName} flows flat — awaiting catalyst.`
    return {
      sector: sectorName,
      direction,
      acceleration,
      participation_quality: partQual,
      share_of_flow_pct: Number(sharePct.toFixed(1)),
      narrative,
      top_tickers: v.tickers,
    }
  }).sort((a, b) => b.share_of_flow_pct - a.share_of_flow_pct)
}

async function buildHighConvictionFlows(rows: NansenToken[], byTokenQuality: Map<string, number>): Promise<HighConvictionFlow[]> {
  // Filter the noise BEFORE composing — institutional minimums.
  const candidates = rows.filter((t) => {
    if ((t.liquidity ?? 0) < MIN_LIQUIDITY_USD) return false
    if ((t.volume    ?? 0) < MIN_VOLUME_USD)    return false
    if (Math.abs(t.netflow ?? 0) < MIN_ABS_NETFLOW_USD) return false
    const sec = sectorOf(t.token_symbol)
    if (sec === 'Other' && (byTokenQuality.get(t.token_symbol) ?? 0) < 60) return false
    return true
  })

  // Score: SM quality × (1 + alignment bonus). Top N only.
  const scored = candidates.map((t) => {
    const q = byTokenQuality.get(t.token_symbol) ?? smartMoneyQuality(t)
    return { t, q }
  }).sort((a, b) => b.q - a.q).slice(0, HIGH_CONVICTION_MAX)

  // Fuse with Momentum for each. Momentum keyed by USDT pair symbol where possible.
  // For tokens not in our scanned regime universe, Momentum will return 'Unknown'
  // — that's fine, the fusion is informational not gating.
  const fused = await Promise.all(scored.map(async ({ t, q }) => {
    const pair = `${t.token_symbol.toUpperCase()}USDT`
    let mv: MomentumView | null = null
    try { mv = await composeMomentumView(pair) } catch { mv = null }
    const state = flowState(t)
    const phase: MomentumPhase | 'Unknown' = (mv?.phase ?? 'Unknown')
    const aligned = (state === 'Institutional Build-Up' || state === 'Expansion' || state === 'Aggressive Rotation')
                 && (phase === 'Trending' || phase === 'Expansion')
    const partQual = participationQualityOf(t)
    const sus = sustainabilityOf(t)
    const sec = sectorOf(t.token_symbol)
    const tier = walletTierOf(t, sec, q)
    // Conviction = SM quality + fusion alignment bonus + sustainability bonus
    const fusionBonus = aligned ? 12 : 0
    const susBonus    = sus === 'High' ? 5 : sus === 'Moderate' ? 2 : 0
    const tierBonus   = tier === 'Institutional' ? 6 : tier === 'Smart Capital' ? 4 : 0
    const conviction  = clamp100(q + fusionBonus + susBonus + tierBonus)
    const sectorName  = SECTOR_LABEL[sec]
    const narrative   = flowNarrative(t.token_symbol, state, sectorName, phase, sus, partQual)
    return {
      symbol:                t.token_symbol.toUpperCase(),
      chain:                 t.chain,
      sector:                sectorName,
      flow_state:            state,
      momentum_phase:        phase,
      conviction,
      conviction_level:      convictionLevel(conviction),
      smart_money_quality:   q,
      participation_quality: partQual,
      wallet_tier:           tier,
      risk_label:            riskLabel(t, q),
      confidence:            conviction,                 // alias; UI uses both
      narrative,
      fusion_aligned:        aligned,
    }
  }))
  return fused
}

function buildFlowTable(rows: NansenToken[], byTokenQuality: Map<string, number>, dominantSector: string): FlowIntelligenceRow[] {
  // Apply same liquidity/volume floors so the table is meaningful, but allow
  // 'Other' here (the user can scan more broadly via the Advanced surface).
  const filtered = rows
    .filter((t) => (t.liquidity ?? 0) >= MIN_LIQUIDITY_USD && (t.volume ?? 0) >= MIN_VOLUME_USD)
    .slice(0, FLOW_TABLE_MAX)
  return filtered.map<FlowIntelligenceRow>((t) => {
    const state = flowState(t)
    const q     = byTokenQuality.get(t.token_symbol) ?? smartMoneyQuality(t)
    const sus   = sustainabilityOf(t)
    const sec   = SECTOR_LABEL[sectorOf(t.token_symbol)]
    const rotationAlignment: FlowIntelligenceRow['rotation_alignment'] =
      sec === dominantSector ? 'Aligned' :
      sec === 'Other'         ? 'Mixed'   :
      ['Distribution','Collapse Risk','Weak Participation','Exhaustion'].includes(state) ? 'Counter' : 'Mixed'
    return {
      symbol:              t.token_symbol.toUpperCase(),
      chain:               t.chain,
      sector:              sec,
      flow_state:          state,
      smart_money_quality: q,
      sustainability:      sus,
      narrative:           shortNarrative(state, sus),
      confidence:          clamp100(q + (sus === 'High' ? 5 : sus === 'Weakening' ? -10 : 0)),
      rotation_alignment:  rotationAlignment,
    }
  }).sort((a, b) => b.confidence - a.confidence)
}

function shortNarrative(state: FlowState, sus: FlowSustainability): string {
  const sustainTag = sus === 'High' ? ' · sustainable' : sus === 'Weakening' ? ' · weakening' : ''
  return `${state}${sustainTag}`
}

// ── Public composer ──────────────────────────────────────────────────────

export async function composeSmartMoneyFlow(opts: { window?: '1h' | '24h' | '7d' | '30d'; limit?: number } = {}): Promise<SmartMoneyFlowView> {
  const generated_at = new Date().toISOString()
  if (!isNansenConfigured()) {
    return await emptyView('Smart money provider unconfigured', generated_at)
  }
  let tokens: NansenToken[] = []
  try {
    tokens = await tokenScreener({
      chains:    ['ethereum','solana','base'] as NansenChain[],
      timeframe: opts.window ?? '24h',
      orderBy:   'buy_volume',
      direction: 'DESC',
      limit:     opts.limit ?? 100,
    })
  } catch (e) {
    return await emptyView(e instanceof Error ? e.message : 'Smart money provider unavailable', generated_at)
  }
  if (tokens.length === 0) {
    return await emptyView('Smart money provider returned an empty universe for this window', generated_at)
  }

  // Pre-compute SM quality once per token (used in all layers).
  const byTokenQuality = new Map<string, number>()
  for (const t of tokens) byTokenQuality.set(t.token_symbol, smartMoneyQuality(t))

  const summary    = buildSummary(tokens, byTokenQuality)
  const sectors    = buildSectorRotation(tokens)
  const highConv   = await buildHighConvictionFlows(tokens, byTokenQuality)
  const flow_table = buildFlowTable(tokens, byTokenQuality, summary.dominant_rotation)
  const narrative  = topNarrative(summary, summary.dominant_rotation)

  // Adaptive Phase A — record the market-flow summary (universe-level).
  await logDecision({
    surface:     'smart-money',
    fingerprint: fingerprint([
      summary.smart_money_bias, summary.dominant_rotation, summary.conviction_level,
      summary.risk_appetite, summary.flow_sustainability,
    ]),
    payload:     summary,
  })

  return { summary, sectors, high_conviction: highConv, flow_table, narrative, generated_at, partial: false }
}

/**
 * Empty / fallback view when the external Smart Money provider is down.
 *
 * The user-facing surface (narrative + summary) is populated by an
 * internal cross-engine heuristic over regime + breadth + dominance —
 * the same shape used by the Decision-Brain composer. When even the
 * cross-engine inputs are unavailable, we fall back to a clean
 * canonical narrative (NEVER the raw provider error).
 *
 * Raw `reason` is preserved on the response for telemetry, but it must
 * NEVER reach the user UI — the page renders `narrative` only.
 */
async function emptyView(reason: string, generated_at: string): Promise<SmartMoneyFlowView> {
  const heur = await composeSmartMoneyHeuristic()
  if (heur) {
    return {
      summary:         heur.summary,
      sectors:         [],
      high_conviction: [],
      flow_table:      [],
      narrative:       heur.narrative,
      generated_at,
      partial:         true,    // still partial — heuristic, not provider
      reason,                   // raw — admin/telemetry only, not rendered
      fromHeuristic:   true,
    }
  }
  // Heuristic inputs also unavailable — fall back to canonical
  // narrative. The page still pills "internal model" so the user knows
  // this is a defensible fallback, not a fake "everything ok" read.
  return {
    summary: {
      smart_money_bias: 'Neutral', dominant_rotation: 'Other',
      capital_concentration: 'Dispersed', participation_quality: 'N/A',
      risk_appetite: 'Defensive', conviction: 0, conviction_level: 'Weak',
      flow_sustainability: 'Weakening', market_aggression: 0,
    },
    sectors: [],
    high_conviction: [],
    flow_table: [],
    narrative: 'Large-wallet positioning data is recalibrating. Cross-engine inputs are also warming up — read will resume on the next cycle.',
    generated_at,
    partial: true,
    reason,
    fromHeuristic: true,
  }
}


// ── Cross-engine heuristic (internal Smart Money model) ──────────────
// Mirrors the composer in `lib/decision-brain/engine.ts` so the
// standalone /intelligence/smart-money page renders a defensible read
// instead of zero-default placeholders when the provider is unavailable.
// Honest about provenance — caller marks `fromHeuristic: true` and the
// UI surfaces "internal model" rather than "Source · High".

const CONSTRUCTIVE_REGIMES = new Set(['trending', 'trending_up', 'expansion'])
const DEFENSIVE_REGIMES    = new Set(['high_volatility', 'volatile', 'exhaustion', 'distribution', 'collapse_risk'])

interface HeuristicResult {
  summary:   MarketFlowSummary
  narrative: string
}

async function composeSmartMoneyHeuristic(): Promise<HeuristicResult | null> {
  // Pull regime + breadth + dominance in parallel. None throw — failures
  // collapse to null and we degrade rather than fabricate.
  const [regimeRes, breadthRes, overviewRes] = await Promise.allSettled([
    readRegimeShare(),
    composeBreadthView(),
    composeMarketOverview(),
  ])
  const regime   = regimeRes.status   === 'fulfilled' ? regimeRes.value   : null
  const breadth  = breadthRes.status  === 'fulfilled' ? breadthRes.value  : null
  const overview = overviewRes.status === 'fulfilled' ? overviewRes.value : null

  // Need at least two inputs to compose a defensible read.
  const presentCount = [regime, breadth?.crypto.available, overview?.dominance].filter(Boolean).length
  if (presentCount < 2) return null

  // Each component lean is in -1..+1.
  const regimeLean   = regime ? regime.constructive_pct / 100 - regime.defensive_pct / 100 : 0
  const breadthLean  = breadth && breadth.crypto.available
    ? Math.max(-1, Math.min(1, (breadth.crypto.pct_advancing - 50) / 50))
    : 0
  const domLean = overview && overview.dominance
    ? (overview.dominance.sentiment === 'Risk-On' ? 0.5
       : overview.dominance.sentiment === 'Risk-Off' ? -0.5 : 0)
    : 0

  const weights = { regime: 0.45, breadth: 0.35, dominance: 0.20 }
  let wSum = 0, lSum = 0
  if (regime)                         { wSum += weights.regime;    lSum += weights.regime    * regimeLean }
  if (breadth?.crypto.available)      { wSum += weights.breadth;   lSum += weights.breadth   * breadthLean }
  if (overview?.dominance)            { wSum += weights.dominance; lSum += weights.dominance * domLean }
  const composite = wSum > 0 ? lSum / wSum : 0

  // Volatility/stress dampener via breadth state when extreme.
  // Narrow / Weak breadth states proxy distribution/exhaustion conditions.
  const stressed = breadth?.crypto.state === 'Narrow' || breadth?.crypto.state === 'Weak'
  const lean = stressed ? composite * 0.7 : composite
  // Cap conviction at 60 — heuristic is never institutional-grade.
  const conviction = Math.min(60, Math.round(Math.abs(lean) * 100 * 0.85 + 20))

  const smart_money_bias: SmartMoneyBias =
    lean >=  0.15 ? 'Bullish'
    : lean <= -0.15 ? 'Bearish'
    :                 'Neutral'
  const conviction_level: ConvictionLevel =
    conviction >= 50 ? 'Moderate' : 'Weak'

  // Risk appetite: derive from breadth + regime.
  const risk_appetite: RiskAppetite =
    breadthLean >= 0.25 && regimeLean >= 0.10  ? 'Aggressive'
    : breadthLean >= 0.10 && regimeLean >= 0   ? 'Elevated'
    : breadthLean <= -0.10                      ? 'Defensive'
    :                                             'Measured'
  // Participation quality: breadth magnitude.
  const participation_quality: ParticipationQuality =
    Math.abs(breadthLean) >= 0.30 ? 'Strong'
    : Math.abs(breadthLean) >= 0.10 ? 'Moderate'
    : breadth?.crypto.available    ? 'Weak'
    :                                 'N/A'
  // Capital concentration: BTC dominance level.
  const btcDom = overview?.dominance?.btc_dominance ?? 50
  const capital_concentration: MarketFlowSummary['capital_concentration'] =
    btcDom >= 55 ? 'Concentrated'
    : btcDom >= 45 ? 'Balanced'
    :                'Dispersed'
  // Flow sustainability: regime trend strength + breadth direction.
  const flow_sustainability: FlowSustainability =
    Math.abs(lean) >= 0.35 && breadthLean >= 0.15 ? 'High'
    : Math.abs(lean) >= 0.20                       ? 'Moderate'
    : stressed                                     ? 'Weakening'
    :                                                 'Fragile'
  // Aggression: mcap 24h move magnitude.
  const mcapMove = overview?.dominance?.mcap_change_24h ?? 0
  const market_aggression = Math.min(100, Math.round(Math.abs(mcapMove) * 20))

  // Dominant rotation: borrow breadth posture as the rotation label.
  const dominant_rotation: string =
    breadth?.posture === 'Risk-On'  ? 'Major / Layer 1s'
    : breadth?.posture === 'Risk-Off' ? 'Defensive / Stables'
    :                                    'Mixed'

  const narrativeParts: string[] = []
  narrativeParts.push(
    smart_money_bias === 'Bullish'  ? 'Internal model reads constructive positioning.'
    : smart_money_bias === 'Bearish' ? 'Internal model reads defensive positioning.'
    :                                   'Internal model reads balanced positioning.',
  )
  if (regime) {
    narrativeParts.push(
      `Regime shows ${regime.constructive_pct}% constructive vs ${regime.defensive_pct}% defensive across ${regime.symbols_scanned} symbols.`,
    )
  }
  if (breadth?.crypto.available) {
    narrativeParts.push(
      `Breadth at ${breadth.crypto.pct_advancing}% advancing — ${breadth.posture.toLowerCase()} posture.`,
    )
  }
  if (overview?.dominance) {
    narrativeParts.push(
      `BTC dominance ${overview.dominance.btc_dominance.toFixed(1)}%, total cap ${overview.dominance.mcap_change_24h >= 0 ? '+' : ''}${overview.dominance.mcap_change_24h.toFixed(2)}% 24h.`,
    )
  }
  narrativeParts.push('Heuristic confidence intentionally capped — primary provider still recalibrating.')
  const narrative = narrativeParts.join(' ')

  return {
    summary: {
      smart_money_bias, dominant_rotation, capital_concentration,
      participation_quality, risk_appetite, conviction, conviction_level,
      flow_sustainability, market_aggression,
    },
    narrative,
  }
}

interface RegimeShare {
  constructive_pct: number
  defensive_pct:    number
  transitional_pct: number
  symbols_scanned:  number
}

async function readRegimeShare(): Promise<RegimeShare | null> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('regime_snapshots')
      .select('symbol, regime, scanned_at')
      .order('scanned_at', { ascending: false })
      .limit(300)
    const seen = new Set<string>()
    let constructive = 0, defensive = 0, transitional = 0, total = 0
    for (const r of data ?? []) {
      if (seen.has(r.symbol)) continue
      seen.add(r.symbol)
      total++
      const g = (r.regime ?? '').toLowerCase()
      if (CONSTRUCTIVE_REGIMES.has(g)) constructive++
      else if (DEFENSIVE_REGIMES.has(g)) defensive++
      else if (g === 'transitional') transitional++
    }
    if (total < 3) return null
    return {
      constructive_pct: Math.round((constructive / total) * 100),
      defensive_pct:    Math.round((defensive    / total) * 100),
      transitional_pct: Math.round((transitional / total) * 100),
      symbols_scanned:  total,
    }
  } catch {
    return null
  }
}
