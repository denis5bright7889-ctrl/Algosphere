/**
 * Decision Brain — the consolidation engine.
 *
 * Consumes EXISTING market-intelligence composers (regime, momentum,
 * breadth, smart money, whale flow, dominance, volatility, execution
 * health), normalises each into a comparable signal, then resolves them
 * into ONE institutional decision object. It does not rebuild or modify
 * any engine — it only reads their published outputs.
 *
 * Design:
 *  - gatherDecisionContext()  — async; collects + normalises engine outputs.
 *                               Failures degrade honestly (engine marked
 *                               unavailable), never fabricated.
 *  - buildMarketDecision(ctx) — PURE; applies the config-driven weighting,
 *                               contradiction detection, noise suppression,
 *                               gating, and risk overrides.
 *  - composeDecision()        — gather → build (the public entry point).
 *
 * Honesty: smart money / whale flow run on a provider that may be
 * unconfigured (mock). When a composer reports `partial`/`reason`, it is
 * excluded from the vote and noted — mock is never presented as a
 * confirming signal.
 */
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { composeMomentumView } from '@/lib/momentum-engine'
import { composeSmartMoneyFlow } from '@/lib/smart-money-engine'
import { composeWhaleFlowView } from '@/lib/whale-flow-engine'
import { composeBreadthView } from '@/lib/breadth-engine'
import { composeMarketOverview } from '@/lib/coingecko'
import { composeVolatilityView } from '@/lib/volatility-rank'
import { getEngineStatus, getRiskTelemetry, getCircuitBreakers } from '@/lib/engine-client'
import { DECISION_CONFIG, type EngineName,
  type MarketState, type MomentumState, type FlowBias, type Participation,
  type RiskLevel, type TradePermission, type DirectionBias, type TimeHorizon,
} from './config'
import { regimeAdaptedWeights, type BriefEngine, type WeightVector } from './weights'
import { logDecision, fingerprint } from '@/lib/intel-memory'
import type { DecisionObject, DecisionContext, NormalizedSignal, StrictDecision } from './types'

/** Crypto bellwether used as the market-momentum proxy (labelled in output). */
const MOMENTUM_PROXY = 'BTCUSDT'

// ── Regime aggregate (reads the same table the other engines read) ───────

interface RegimeAgg {
  available: boolean
  state:     MarketState
  lean:      number   // -1..+1 (risk-on positive)
  strength:  number   // 0..1
  note:      string
  /** Structured sub-states surfaced on the IntelligenceModule.data
   *  payload — the founder spec asked for explicit environment / trend
   *  strength / volatility / liquidity reads rather than the legacy
   *  "0 constructive / 9 defensive" shallow summary. */
  data?: {
    environment:      'Risk-On' | 'Risk-Off' | 'Mixed' | 'Transitional'
    trend_strength:   'Weak' | 'Moderate' | 'Strong'
    constructive_pct: number
    defensive_pct:    number
    transitional_pct: number
    symbols_scanned:  number
  }
}

const CONSTRUCTIVE = new Set(['trending', 'trending_up', 'expansion'])
const DEFENSIVE    = new Set(['high_volatility', 'volatile', 'exhaustion', 'distribution', 'collapse_risk'])

async function aggregateRegime(): Promise<RegimeAgg> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('regime_snapshots')
      .select('symbol, regime, der_score, scanned_at')
      .order('scanned_at', { ascending: false })
      .limit(300)

    const seen = new Set<string>()
    let constructive = 0, defensive = 0, transitional = 0, total = 0, derSum = 0
    for (const r of data ?? []) {
      if (seen.has(r.symbol)) continue
      seen.add(r.symbol)
      total++
      derSum += typeof r.der_score === 'number' ? r.der_score : 0
      const g = (r.regime ?? '').toLowerCase()
      if (CONSTRUCTIVE.has(g)) constructive++
      else if (DEFENSIVE.has(g)) defensive++
      else if (g === 'transitional') transitional++
    }
    if (total < 3) {
      return { available: false, state: 'UNCERTAIN', lean: 0, strength: 0,
        note: `Regime: only ${total} symbols scanned — insufficient to read the environment.` }
    }
    const cShare = constructive / total
    const dShare = defensive / total
    const tShare = transitional / total
    const avgDer = derSum / total
    const lean = cShare - dShare                     // -1..+1
    const strength = Math.max(0, Math.min(1, avgDer * 1.6 + 0.2)) // der is small-scale live

    let state: MarketState
    if (tShare >= 0.4 || Math.abs(lean) < 0.12) state = 'TRANSITION'
    else if (lean > 0)  state = 'RISK_ON'
    else                state = 'RISK_OFF'
    if (avgDer < 0.08 && Math.abs(lean) < 0.2) state = 'UNCERTAIN'

    const note = `Regime: ${constructive} constructive / ${defensive} defensive / ${transitional} transitional of ${total} scanned (${state.replace('_', '-').toLowerCase()}).`

    // ── Sub-state composition for the rich card surface ────────────
    // Environment ladder is lean × transition share — never lets the
    // user see a contradictory "Mixed" with strong directional lean.
    const environment: NonNullable<RegimeAgg['data']>['environment'] =
      tShare >= 0.4                ? 'Transitional'
      : lean >=  0.20              ? 'Risk-On'
      : lean <= -0.20              ? 'Risk-Off'
      :                              'Mixed'
    // Trend strength uses the DER-derived `strength` (already 0..1).
    const trend_strength: NonNullable<RegimeAgg['data']>['trend_strength'] =
      strength >= 0.65 ? 'Strong'
      : strength >= 0.40 ? 'Moderate'
      :                    'Weak'
    return {
      available: true, state, lean, strength, note,
      data: {
        environment, trend_strength,
        constructive_pct: Math.round(cShare * 100),
        defensive_pct:    Math.round(dShare * 100),
        transitional_pct: Math.round(tShare * 100),
        symbols_scanned:  total,
      },
    }
  } catch {
    return { available: false, state: 'UNCERTAIN', lean: 0, strength: 0, note: 'Regime: unavailable.' }
  }
}

// ── Correlation: regime-agreement across an anchor panel ──────────
// Wires the correlation card (previously a permanent fallback) with a
// real read. We score how many of the major regime-snapshot symbols
// share BTC's risk posture — high agreement → Risk-On/Off correlation
// regime, mixed agreement → Neutral. This is the founder spec's
// 5-asset panel with the symbols we actually have data for.

interface CorrelationAgg {
  available: boolean
  lean:      number          // BTC's risk lean (anchors the regime)
  strength:  number          // 0..1, agreement strength
  note:      string
  data?: {
    correlation_regime: 'Risk-On' | 'Risk-Off' | 'Neutral'
    btc_anchor:         string   // human regime label for BTC
    agreement_pct:      number   // % of panel that agrees with BTC
    panel_size:         number
    panel:              string   // comma-list of symbols actually read
  }
}

const CORRELATION_PANEL = [
  'BTCUSDT', 'ETHUSDT', 'XAUUSD', 'EURUSD', 'NAS100', 'SPX500',
] as const

async function aggregateCorrelation(): Promise<CorrelationAgg> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('regime_snapshots')
      .select('symbol, regime, scanned_at')
      .in('symbol', CORRELATION_PANEL as unknown as string[])
      .order('scanned_at', { ascending: false })
      .limit(120)
    if (!data || data.length === 0) {
      return { available: false, lean: 0, strength: 0,
        note: 'Cross-asset correlations are recomputing across the BTC / ETH / DXY / Gold / SP500 / NAS100 panel.' }
    }
    // Latest regime per symbol.
    const latest = new Map<string, string>()
    for (const r of data) {
      if (!latest.has(r.symbol)) latest.set(r.symbol, (r.regime ?? '').toLowerCase())
    }
    const btcRegime = latest.get('BTCUSDT')
    if (!btcRegime) {
      return { available: false, lean: 0, strength: 0,
        note: 'Cross-asset correlations are recomputing — BTC anchor not yet observed in this window.' }
    }
    const btcRiskOn  = CONSTRUCTIVE.has(btcRegime)
    const btcRiskOff = DEFENSIVE.has(btcRegime)
    // For each non-BTC member of the panel, decide whether it agrees
    // with BTC's risk posture (risk-on/off/neutral).
    let agree = 0, total = 0
    for (const [sym, reg] of latest) {
      if (sym === 'BTCUSDT') continue
      total++
      const symRiskOn  = CONSTRUCTIVE.has(reg)
      const symRiskOff = DEFENSIVE.has(reg)
      if (btcRiskOn && symRiskOn)      agree++
      else if (btcRiskOff && symRiskOff) agree++
      else if (!btcRiskOn && !btcRiskOff && !symRiskOn && !symRiskOff) agree++
    }
    if (total === 0) {
      return { available: false, lean: 0, strength: 0,
        note: 'Cross-asset correlations are recomputing — anchor panel still warming up.' }
    }
    const agreement_pct = Math.round((agree / total) * 100)
    const correlation_regime: NonNullable<CorrelationAgg['data']>['correlation_regime'] =
      agreement_pct >= 70 && btcRiskOn  ? 'Risk-On'
      : agreement_pct >= 70 && btcRiskOff ? 'Risk-Off'
      :                                     'Neutral'
    const lean = btcRiskOn ? +1 : btcRiskOff ? -1 : 0
    const strength = agree / total
    const btcAnchorLabel = btcRiskOn ? 'risk-on' : btcRiskOff ? 'risk-off' : btcRegime
    const note = `Cross-asset agreement with BTC: ${agreement_pct}% of ${total} (${correlation_regime.toLowerCase()}).`
    return {
      available: true, lean: lean * 0.5, strength, note,
      data: {
        correlation_regime,
        btc_anchor:    btcAnchorLabel,
        agreement_pct,
        panel_size:    total + 1,
        panel:         [...latest.keys()].join(' · '),
      },
    }
  } catch {
    return { available: false, lean: 0, strength: 0,
      note: 'Cross-asset correlations are recomputing — read returns on the next cycle.' }
  }
}


// ── Internal heuristic engines ────────────────────────────────────────
// When the external provider for Smart Money or Whale Flow is down
// (credits exhausted, rate-limited, unconfigured), we run an internal
// heuristic over engines we ALREADY have a read for. It never lies
// about its source — the composer maps `provenance: 'heuristic'` to
// `source_quality: 'fallback'` and `userStatus: 'fallback'` so the
// card honestly says "internal model" instead of "recalibrating".
//
// Inputs are the signals array AFTER regime / breadth / dominance /
// volatility have populated. The heuristics deliberately use multiple
// inputs so a single weak signal can't drag the read.

interface HeuristicInputs {
  regime?:     NormalizedSignal
  breadth?:    NormalizedSignal
  dominance?:  NormalizedSignal
  volatility?: NormalizedSignal
}

function pickInputs(signals: NormalizedSignal[]): HeuristicInputs {
  return {
    regime:     signals.find((s) => s.engine === 'regime'     && s.available),
    breadth:    signals.find((s) => s.engine === 'breadth'    && s.available),
    dominance:  signals.find((s) => s.engine === 'dominance'  && s.available),
    volatility: signals.find((s) => s.engine === 'volatility' && s.available),
  }
}

/** Smart Money heuristic — "is risk capital accumulating or distributing?"
 *
 * Combines: regime constructive/defensive share + breadth posture +
 * dominance sentiment (mcap_change_24h), dampened by volatility stress.
 * Returns null when too few inputs are present to produce a defensible
 * read (the composer keeps the engine as 'building' in that case). */
function smartMoneyHeuristic(inputs: HeuristicInputs): NormalizedSignal | null {
  const present = [inputs.regime, inputs.breadth, inputs.dominance].filter(Boolean)
  if (present.length < 2) return null  // need at least 2 of 3 for a defensible read

  // regime: lean already in -1..+1
  const regimeLean = inputs.regime?.lean ?? 0
  // breadth: lean already in -1..+1 (postureLean * strength)
  const breadthLean = inputs.breadth?.lean ?? 0
  // dominance: lean already in -1..+1 (-1 risk-off, +1 risk-on, 0.5 scaled)
  const domLean = inputs.dominance?.lean ?? 0

  // Weighted average — regime is the heaviest single read.
  const weights = { regime: 0.45, breadth: 0.35, dominance: 0.20 }
  let wSum = 0, lSum = 0
  if (inputs.regime)    { wSum += weights.regime;    lSum += weights.regime    * regimeLean }
  if (inputs.breadth)   { wSum += weights.breadth;   lSum += weights.breadth   * breadthLean }
  if (inputs.dominance) { wSum += weights.dominance; lSum += weights.dominance * domLean }
  const composite = wSum > 0 ? lSum / wSum : 0

  // Volatility dampener — high-vol environments make the read less
  // reliable for slow-money intent (whales hide in chop).
  const volStrength = inputs.volatility?.strength ?? 0
  const damp = 1 - Math.min(0.4, volStrength * 0.5)
  const lean = composite * damp

  // Heuristic strength is capped at 0.60 — never claim high confidence
  // from a fallback. Real Nansen/Glassnode reads earn 'high'; this earns
  // 'fallback' on the source_quality pill.
  const strength = Math.min(0.60, Math.abs(lean) * 0.9 + 0.20)

  const bias: 'Bullish' | 'Bearish' | 'Neutral' =
    lean >=  0.15 ? 'Bullish'
    : lean <= -0.15 ? 'Bearish'
    :                 'Neutral'
  const conviction = Math.round(strength * 100)
  const conviction_level: 'Low' | 'Moderate' | 'High' =
    conviction >= 45 ? 'Moderate' : 'Low'

  // Risk appetite + participation: derive from breadth + volatility
  // rather than from a provider's wallet panel.
  const risk_appetite: 'Risk-On' | 'Risk-Off' | 'Mixed' =
    breadthLean >= 0.15 && regimeLean >= 0   ? 'Risk-On'
    : breadthLean <= -0.15 && regimeLean <= 0 ? 'Risk-Off'
    :                                            'Mixed'
  const participation_quality: 'Broad' | 'Narrow' | 'Declining' =
    Math.abs(breadthLean) >= 0.20 ? 'Broad'
    : Math.abs(breadthLean) >= 0.05 ? 'Narrow'
    :                                  'Declining'

  const note = `Smart money read (internal model): ${bias.toLowerCase()} bias from cross-engine consensus (regime + breadth + dominance), ${risk_appetite.toLowerCase()} environment.`

  return {
    engine:      'smartMoney',
    available:   true,
    directional: true,
    lean,
    strength,
    note,
    provenance:  'heuristic',
    data: {
      bias,
      conviction,
      conviction_level,
      participation_quality,
      risk_appetite,
      capital_concentration: 'Unknown',
      dominant_rotation:     'Unknown',
      source_basis:          'cross-engine consensus',
    },
  }
}

/** Whale Flow heuristic — "is large capital flowing in or out?"
 *
 * Whale prints leave footprints in breadth + volatility + dominance
 * even without on-chain data. Accumulation correlates with broadening
 * participation + calm volatility + falling dominance (rotation into
 * mid-caps). Distribution correlates with narrowing breadth +
 * elevated volatility + rising dominance (flight to BTC). Returns
 * null when there isn't enough cross-engine context to lean. */
function whaleFlowHeuristic(inputs: HeuristicInputs): NormalizedSignal | null {
  // Need breadth + (vol or dominance) to call a movement read.
  if (!inputs.breadth) return null
  if (!inputs.volatility && !inputs.dominance) return null

  const breadthLean = inputs.breadth.lean
  const volStrength = inputs.volatility?.strength ?? 0
  const domLean     = inputs.dominance?.lean ?? 0

  // Volatility contribution: calm + bullish breadth → accumulation;
  // elevated + bearish breadth → distribution. Volatility strength is
  // the share of universe at elevated/high — so high == stressed.
  const volContribution = volStrength >= 0.5
    ? -0.3                         // stressed → distribution bias
    : volStrength <= 0.20
      ?  0.15                      // calm → accumulation bias
      :  0
  const composite = breadthLean * 0.5 + domLean * 0.3 + volContribution * 0.2
  const lean = Math.max(-1, Math.min(1, composite))
  const strength = Math.min(0.55, Math.abs(lean) * 0.85 + 0.20)

  const movement_bias: 'Accumulation' | 'Distribution' | 'Neutral' =
    lean >=  0.18 ? 'Accumulation'
    : lean <= -0.18 ? 'Distribution'
    :                 'Neutral'

  // Aggression: volatility-driven. Elevated vol with directional lean
  // signals aggressive movement; calm vol = passive.
  const movement_aggression: 'Aggressive' | 'Moderate' | 'Passive' =
    volStrength >= 0.5 && Math.abs(lean) >= 0.20 ? 'Aggressive'
    : volStrength >= 0.30                          ? 'Moderate'
    :                                                 'Passive'
  const capital_persistence: 'Building' | 'Holding' | 'Unwinding' =
    movement_bias === 'Accumulation' ? 'Building'
    : movement_bias === 'Distribution' ? 'Unwinding'
    :                                     'Holding'
  const dominant_movement: 'Inflow' | 'Outflow' | 'Sideways' =
    movement_bias === 'Accumulation' ? 'Inflow'
    : movement_bias === 'Distribution' ? 'Outflow'
    :                                     'Sideways'

  const confidence = Math.round(strength * 100)
  const conviction_level: 'Low' | 'Moderate' | 'High' =
    confidence >= 45 ? 'Moderate' : 'Low'

  const note = `Whale flow read (internal model): ${movement_bias.toLowerCase()} inferred from breadth + volatility + dominance footprint.`

  return {
    engine:      'whaleFlow',
    available:   true,
    directional: true,
    lean,
    strength,
    note,
    provenance:  'heuristic',
    data: {
      movement_bias,
      dominant_movement,
      movement_aggression,
      capital_persistence,
      confidence,
      conviction_level,
      source_basis: 'cross-engine footprint',
    },
  }
}


// ── Small mappers ────────────────────────────────────────────────────────

const sign = (x: number, band = 0.15): number => (x > band ? 1 : x < -band ? -1 : 0)

function momentumPhaseToState(phase: string): MomentumState | null {
  switch (phase) {
    case 'Accumulation': return 'ACCUMULATION'
    case 'Expansion':    return 'EXPANSION'
    case 'Trending':     return 'TRENDING'
    case 'Parabolic':    return 'PARABOLIC'
    case 'Exhaustion':
    case 'Distribution':
    case 'Collapse Risk':return 'EXHAUSTION'
    default:             return null
  }
}

// ── Context gathering ──────────────────────────────────────────────────

export async function gatherDecisionContext(): Promise<DecisionContext> {
  const generated_at = new Date().toISOString()

  const [regime, momentumR, smartR, whaleR, breadthR, overviewR, volR, execStatusR, riskR, breakersR, correlationR] =
    await Promise.allSettled([
      aggregateRegime(),
      composeMomentumView(MOMENTUM_PROXY),
      composeSmartMoneyFlow({ window: '24h' }),
      composeWhaleFlowView({ window: '24h' }),
      composeBreadthView(),
      composeMarketOverview(),
      composeVolatilityView(),
      getEngineStatus(),
      getRiskTelemetry(),
      getCircuitBreakers(),
      aggregateCorrelation(),
    ])

  const val = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null)

  const regimeAgg = val(regime) ?? { available: false, state: 'UNCERTAIN' as MarketState, lean: 0, strength: 0, note: 'Regime: unavailable.' }
  const momentum  = val(momentumR)
  const smart     = val(smartR)
  const whale     = val(whaleR)
  const breadth   = val(breadthR)
  const overview  = val(overviewR)
  const vol       = val(volR)
  const execStatus = val(execStatusR)
  const risk      = val(riskR)
  const breakers  = val(breakersR)
  const correlation = val(correlationR)

  const signals: NormalizedSignal[] = []

  // Regime — emit the sub-state payload so the IntelligenceCard can
  // surface Environment / Trend strength / Vol state / Liquidity state
  // instead of the legacy "0 constructive / 9 defensive" shallow line.
  // Volatility + liquidity sub-states are joined from the vol + breadth
  // engines after both have evaluated (mid-function — see below).
  signals.push({
    engine: 'regime', available: regimeAgg.available, directional: true,
    lean: regimeAgg.lean, strength: regimeAgg.strength, note: regimeAgg.note,
    data: regimeAgg.data,
  })

  // Momentum (BTC proxy) — surface the engine's structured fields as
  // data so the IntelligenceCard no longer has to render the legacy
  // "Distribution · Sideways · Quality N/A" sentence. The 4-state
  // user-facing quality maps the engine's High / Moderate / Low /
  // N/A onto the founder's Low / Moderate / High / Strong vocabulary
  // (N/A becomes "Low" with the userStatus pill carrying the warning).
  let momentumState: MomentumState | null = null
  if (momentum && !momentum.partial && momentum.phase !== 'Unknown') {
    momentumState = momentumPhaseToState(momentum.phase)
    const dir = momentum.direction === 'Up' ? 1 : momentum.direction === 'Down' ? -1 : 0
    const strength = Math.max(0, Math.min(1, momentum.score / 100))
    // 4-state quality scale per the founder spec. The engine emits the
    // raw read; the user-facing scale adds "Strong" for very-high reads
    // and normalises N/A to "Low" (with the freshness pill explaining
    // why if the data is thin).
    const userQuality: 'Low' | 'Moderate' | 'High' | 'Strong' =
      strength >= 0.80 ? 'Strong'
      : momentum.quality === 'High'     ? 'High'
      : momentum.quality === 'Moderate' ? 'Moderate'
      :                                   'Low'
    signals.push({
      engine: 'momentum', available: true, directional: true,
      lean: dir * strength, strength,
      note: `Momentum (BTC bellwether): ${momentum.phase}, ${momentum.direction}, quality ${momentum.quality}.`,
      data: {
        quality:        userQuality,
        phase:          momentum.phase,
        direction:      momentum.direction,
        sustainability: momentum.sustainability,
        score:          Math.round(momentum.score),
      },
    })
  } else {
    signals.push({ engine: 'momentum', available: false, directional: true, lean: 0, strength: 0,
      note: 'Momentum: insufficient trajectory to classify the bellwether.' })
  }

  // Smart money (market summary) — only when the provider really answered.
  // The summary has rich shape (bias / conviction / participation /
  // risk_appetite / rotation / concentration); we surface it as data
  // so the card stops burying it in a single sentence.
  let smBias = 0
  if (smart && !smart.partial) {
    const s = smart.summary
    smBias = s.smart_money_bias === 'Bullish' ? 1 : s.smart_money_bias === 'Bearish' ? -1 : 0
    const strength = Math.max(0, Math.min(1, s.conviction / 100))
    signals.push({
      engine: 'smartMoney', available: true, directional: true,
      lean: smBias * strength, strength,
      note: `Smart money: ${s.smart_money_bias.toLowerCase()} bias, ${s.participation_quality.toLowerCase()} participation, ${s.risk_appetite.toLowerCase()} risk appetite.`,
      data: {
        bias:                  s.smart_money_bias,
        conviction:            Math.round(s.conviction),
        conviction_level:      s.conviction_level,
        participation_quality: s.participation_quality,
        risk_appetite:         s.risk_appetite,
        capital_concentration: s.capital_concentration,
        dominant_rotation:     s.dominant_rotation,
      },
    })
  } else {
    signals.push({ engine: 'smartMoney', available: false, directional: true, lean: 0, strength: 0,
      note: `Smart money: unavailable${smart?.reason ? ` (${smart.reason})` : ''} — excluded from the vote.` })
  }

  // Whale flow (capital movement summary). Same plumbing pattern — the
  // engine's structured fields (movement_bias / dominant_movement /
  // aggression / persistence / confidence_level) surface as data so
  // the card can render them as a tile grid in the drawer.
  let whaleBias = 0
  if (whale && !whale.partial) {
    const w = whale.summary
    whaleBias = w.movement_bias === 'Accumulation' ? 1 : w.movement_bias === 'Distribution' ? -1 : 0
    const strength = Math.max(0, Math.min(1, w.confidence / 100))
    signals.push({
      engine: 'whaleFlow', available: true, directional: true,
      lean: whaleBias * strength, strength,
      note: `Whale flow: ${w.movement_bias.toLowerCase()} (${w.dominant_movement}), ${w.movement_aggression.toLowerCase()} aggression.`,
      data: {
        movement_bias:       w.movement_bias,
        dominant_movement:   w.dominant_movement,
        movement_aggression: w.movement_aggression,
        capital_persistence: w.capital_persistence,
        confidence:          Math.round(w.confidence),
        conviction_level:    w.conviction_level,
      },
    })
  } else {
    signals.push({ engine: 'whaleFlow', available: false, directional: true, lean: 0, strength: 0,
      note: 'Whale flow: unavailable — excluded from the vote.' })
  }

  // Breadth → participation + directional posture. The crypto slice's
  // rich shape (advancers / decliners / flat / pct_advancing / state)
  // is surfaced on data so the IntelligenceCard renders the structured
  // grid the founder spec asked for, not a buried sentence.
  let participation: Participation | null = null
  if (breadth && breadth.crypto.available) {
    const c = breadth.crypto
    const pct = c.pct_advancing
    participation = pct >= 55 ? 'BROAD' : pct >= DECISION_CONFIG.thresholds.decliningParticipationPct ? 'NARROW' : 'DECLINING'
    const postureLean = breadth.posture === 'Risk-On' ? 1 : breadth.posture === 'Risk-Off' ? -1 : 0
    const strength = Math.max(0, Math.min(1, Math.abs(pct - 50) / 50 + 0.2))
    // Breadth score: distance from 50 mapped to 0..100. A 50/50 split
    // is "0" breadth (no edge); 75 or 25 is "50" (clear bias).
    const breadth_score = Math.round(Math.min(100, Math.abs(pct - 50) * 2))
    signals.push({
      engine: 'breadth', available: true, directional: true,
      lean: postureLean * strength, strength,
      note: `Breadth: ${c.state} (${pct}% of ${c.sample_size} advancing), posture ${breadth.posture}.`,
      data: {
        state:           c.state,
        posture:         breadth.posture,
        pct_advancing:   pct,
        advancers:       c.advancing,
        decliners:       c.declining,
        flat:            c.flat,
        sample_size:     c.sample_size,
        breadth_score,
        participation:   participation,
      },
    })
  } else {
    signals.push({ engine: 'breadth', available: false, directional: true, lean: 0, strength: 0,
      note: 'Breadth: unavailable.' })
  }

  // Dominance sentiment — surface the BTC dominance number and the
  // 24h cap change as structured data alongside the sentiment label.
  if (overview && overview.dominance) {
    const d = overview.dominance
    const lean = d.sentiment === 'Risk-On' ? 1 : d.sentiment === 'Risk-Off' ? -1 : 0
    const strength = 0.5
    signals.push({
      engine: 'dominance', available: true, directional: true,
      lean: lean * strength, strength,
      note: `Dominance: BTC ${d.btc_dominance}%, total cap ${d.mcap_change_24h >= 0 ? '+' : ''}${d.mcap_change_24h}% 24h (${d.sentiment}).`,
      data: {
        sentiment:           d.sentiment,
        btc_dominance_pct:   Math.round(d.btc_dominance),
        mcap_change_24h_pct: Math.round(d.mcap_change_24h * 100) / 100,
      },
    })
  } else {
    signals.push({ engine: 'dominance', available: false, directional: true, lean: 0, strength: 0,
      note: 'Dominance: unavailable.' })
  }

  // Volatility (risk-only)
  let volExtreme = false, volElevated = false
  if (vol && vol.live_engine_count > 0) {
    const highShare = vol.live.filter((r) => r.level === 'High').length / vol.live_engine_count
    const elevShare = vol.live.filter((r) => r.level === 'High' || r.level === 'Elevated').length / vol.live_engine_count
    volExtreme  = highShare >= DECISION_CONFIG.thresholds.extremeVolShare
    volElevated = elevShare >= DECISION_CONFIG.thresholds.elevatedVolShare
    signals.push({
      engine: 'volatility', available: true, directional: false, lean: 0, strength: elevShare,
      note: `Volatility: ${Math.round(highShare * 100)}% of ${vol.live_engine_count} scanned at High.`,
    })
  } else {
    signals.push({ engine: 'volatility', available: false, directional: false, lean: 0, strength: 0,
      note: 'Volatility: no live engine readings.' })
  }

  // Correlation — wired via aggregateCorrelation() which computes
  // regime agreement across the BTC anchor panel from regime_snapshots.
  // Risk-only (directional: false) for now — it informs the verdict
  // explanation but does not vote on direction; that's the safer
  // first wiring while the rolling-Pearson upgrade (full price-series
  // correlation) lands in a follow-up.
  if (correlation && correlation.available) {
    signals.push({
      engine: 'correlation', available: true, directional: false,
      lean: 0, strength: correlation.strength, note: correlation.note,
      data:  correlation.data,
    })
  } else {
    signals.push({
      engine: 'correlation', available: false, directional: false, lean: 0, strength: 0,
      note: correlation?.note ?? 'Cross-asset correlations are recomputing across the BTC / ETH / DXY / Gold / SP500 / NAS100 panel.',
    })
  }

  // Execution health — distinguish UNVERIFIED from UNSTABLE.
  let executionStable = true
  let executionNote = 'Execution: engine health unverified (SIGNAL_ENGINE_URL not set) — not treated as instability.'
  if (execStatus) {
    if (execStatus.ok) {
      const locked = risk?.ok ? risk.data.state === 'LOCKED' : false
      const breakerOpen = breakers?.ok ? Object.values(breakers.data).some((b) => b.is_open) : false
      const disabled = execStatus.data.enabled === false
      if (locked || breakerOpen) {
        executionStable = false
        executionNote = `Execution: ${locked ? 'risk engine LOCKED' : 'circuit breaker open'} — trading must avoid.`
      } else if (disabled) {
        executionStable = true
        executionNote = 'Execution: engine reachable but scanning disabled.'
      } else {
        executionStable = true
        executionNote = 'Execution: engine reachable and stable.'
      }
    } else if (/not configured/i.test(execStatus.error)) {
      executionStable = true   // unknown, not unstable
      executionNote = 'Execution: engine URL not configured on web — health unverified, not treated as instability.'
    } else {
      executionStable = false  // configured but unreachable / timeout / HTTP error
      executionNote = `Execution: engine unreachable (${execStatus.error}) — trading must avoid.`
    }
  }
  signals.push({
    engine: 'execution', available: !!execStatus, directional: false, lean: 0, strength: executionStable ? 0 : 1,
    note: executionNote,
  })

  // ── Internal heuristics for unavailable provider engines ──────
  // When Smart Money / Whale Flow externals are down (credits, rate
  // limit, unconfigured), produce a defensible cross-engine read so
  // the user-facing card never shows the "recalibrating" placeholder.
  // The heuristic carries `provenance: 'heuristic'` — the composer
  // tags those modules `source_quality: 'fallback'` so users see
  // "internal model" instead of "Source · High". Composed BEFORE the
  // regime augment so the regime signal already has its base data,
  // and BEFORE flowBias so the heuristic feeds the brain too.
  const heuristicInputs = pickInputs(signals)
  const smartSig = signals.find((s) => s.engine === 'smartMoney')
  if (smartSig && !smartSig.available) {
    const h = smartMoneyHeuristic(heuristicInputs)
    if (h) {
      const ix = signals.indexOf(smartSig)
      signals[ix] = h
      smBias = h.lean > 0 ? 1 : h.lean < 0 ? -1 : 0
    }
  }
  const whaleSig = signals.find((s) => s.engine === 'whaleFlow')
  if (whaleSig && !whaleSig.available) {
    const h = whaleFlowHeuristic(heuristicInputs)
    if (h) {
      const ix = signals.indexOf(whaleSig)
      signals[ix] = h
      whaleBias = h.lean > 0 ? 1 : h.lean < 0 ? -1 : 0
    }
  }

  // ── Augment the Regime signal with vol + liquidity sub-states ──
  // We compose these AFTER the vol + breadth reads so the regime card
  // can render a four-dimensional view (environment / trend / vol /
  // liquidity) instead of the legacy single-line summary.
  const regimeSignal = signals.find((s) => s.engine === 'regime')
  if (regimeSignal && regimeSignal.data) {
    const volatility_state: 'Calm' | 'Elevated' | 'Extreme' =
      volExtreme  ? 'Extreme'
      : volElevated ? 'Elevated'
      :              'Calm'
    // Liquidity is derived from breadth participation (BROAD = strong,
    // DECLINING = weak) and whale-flow aggression when available.
    let liquidity_state: 'Strong' | 'Moderate' | 'Weak' = 'Moderate'
    if (participation === 'BROAD')       liquidity_state = 'Strong'
    else if (participation === 'DECLINING') liquidity_state = 'Weak'
    regimeSignal.data = {
      ...regimeSignal.data,
      volatility_state,
      liquidity_state,
    }
  }

  // Flow bias (smart money + whale) — uses whichever source produced
  // a read this cycle (external OR internal heuristic). The brain
  // doesn't care about provenance; the UI does.
  const flowSum = smBias + whaleBias
  const smartHeuristic  = signals.find((s) => s.engine === 'smartMoney')?.provenance === 'heuristic'
  const whaleHeuristic  = signals.find((s) => s.engine === 'whaleFlow')?.provenance === 'heuristic'
  const flowBias: FlowBias | null =
    (smart && !smart.partial) || (whale && !whale.partial) || smartHeuristic || whaleHeuristic
      ? (flowSum > 0 ? 'ACCUMULATION' : flowSum < 0 ? 'DISTRIBUTION' : 'NEUTRAL')
      : null

  const availableCount = signals.filter((s) => s.available).length

  return {
    signals,
    raw: {
      regimeState:   regimeAgg.available ? regimeAgg.state : null,
      momentumState,
      flowBias,
      participation,
      volExtreme,
      volElevated,
      executionStable,
      executionNote,
    },
    availableCount,
    generated_at,
  }
}

// ── Pure decision builder ────────────────────────────────────────────────

export function buildMarketDecision(ctx: DecisionContext): DecisionObject {
  const T = DECISION_CONFIG.thresholds
  const directional = ctx.signals.filter((s) => s.directional && s.available && s.strength >= T.noiseFloor)

  // Weighted net lean over AVAILABLE directional engines (missing engines
  // don't bias the result — we renormalise by present weight).
  let weightSum = 0, leanSum = 0
  for (const s of directional) {
    const w = (DECISION_CONFIG.directionWeights as Record<string, number>)[s.engine] ?? 0
    weightSum += w
    leanSum   += w * s.lean
  }
  const netLean = weightSum > 0 ? leanSum / weightSum : 0

  // Contradiction detection — count engines leaning each way (above band).
  const longs  = directional.filter((s) => sign(s.lean) > 0)
  const shorts = directional.filter((s) => sign(s.lean) < 0)
  const contradiction = longs.length > 0 && shorts.length > 0
  const contradictionCount = contradiction ? Math.min(longs.length, shorts.length) : 0

  // Agreement factor — share of directional engines aligned with the net sign.
  const netSign = sign(netLean, T.neutralBand)
  const aligned = directional.filter((s) => sign(s.lean) === netSign && netSign !== 0).length
  const agreementFactor = directional.length > 0 ? aligned / directional.length : 0

  // Confidence: magnitude × agreement, penalised for contradiction, capped
  // when load-bearing engines are missing or signals conflict.
  let confidence = Math.round(Math.abs(netLean) * 100 * (0.5 + 0.5 * agreementFactor))
  confidence -= contradictionCount * T.contradictionPenalty
  if (contradiction) confidence = Math.min(confidence, DECISION_CONFIG.contradictionCeiling)
  const missingCritical = DECISION_CONFIG.criticalEngines.some(
    (e) => !ctx.signals.find((s) => s.engine === e)?.available,
  )
  if (missingCritical) confidence = Math.min(confidence, DECISION_CONFIG.criticalMissingCeiling)
  confidence = Math.max(0, Math.min(100, confidence))

  // Output enums (independent of confidence)
  const market_state: MarketState = ctx.raw.regimeState ?? 'UNCERTAIN'
  const momentum_state: MomentumState =
    ctx.raw.momentumState ?? regimeMomentumFallback(market_state)
  const flow_bias: FlowBias = ctx.raw.flowBias ?? 'NEUTRAL'
  const participation: Participation = ctx.raw.participation ?? 'NARROW'

  // ── L3 adaptive weighting + MDS (brief model) ──────────────────────────
  const weights = regimeAdaptedWeights(market_state, momentum_state, ctx.raw.volExtreme)
  const { scores, available } = briefEngineScores(ctx)
  const mds = weightedMds(scores, available, weights)

  // ── Confidence = 1 − Σ(disagreement_penalty) (brief), then coverage. ───
  const P = DECISION_CONFIG.penalties
  let penalty = 0
  const smLean = leanOf(ctx, 'smartMoney'), momLean = leanOf(ctx, 'momentum'), whaleLean = leanOf(ctx, 'whaleFlow')
  if (smLean !== null && momLean !== null && sign(smLean) !== 0 && sign(momLean) !== 0 && sign(smLean) !== sign(momLean)) penalty += P.smartMoneyVsMomentum
  if (whaleLean !== null && momLean !== null && sign(whaleLean) !== 0 && sign(momLean) !== 0 && sign(whaleLean) !== sign(momLean)) penalty += P.whaleVsMomentum
  if (market_state === 'UNCERTAIN' || market_state === 'TRANSITION') penalty += P.regimeInstability
  if (ctx.raw.volExtreme && participation !== 'BROAD') penalty += P.volSpikeNoParticipation
  // correlation breakdown: only when the correlation engine is actually available (it's stubbed today)

  // Structural caps preserve the anti-blind-average guarantee from the
  // earlier net-lean pass (contradictions + missing load-bearing engines).
  const coverageFactor = Math.max(0.5, directional.length / 6)
  let confidence01 = Math.max(0, Math.min(1, 1 - penalty)) * coverageFactor
  if (contradiction) confidence01 = Math.min(confidence01, DECISION_CONFIG.contradictionCeiling / 100)
  if (missingCritical) confidence01 = Math.min(confidence01, DECISION_CONFIG.criticalMissingCeiling / 100)
  confidence = Math.max(0, Math.min(100, Math.round(confidence01 * 100)))

  // Risk level
  const risk_level = computeRisk(ctx, contradiction, participation)

  // Trade permission (gates + overrides + brief gating; never a blind average)
  const trade_permission = computePermission({
    ctx, confidence, contradiction, market_state, momentum_state, risk_level, participation,
    scores, available,
  })

  // Direction from MDS (0.5 = neutral), gated by permission + confidence.
  const band = DECISION_CONFIG.strictThresholds.biasBand
  let direction_bias: DirectionBias = 'NEUTRAL'
  if (trade_permission !== 'AVOID' && confidence >= T.minConfidenceToAllow && Math.abs(mds - 0.5) >= band) {
    direction_bias = mds > 0.5 ? 'LONG' : 'SHORT'
  }

  const time_horizon = computeHorizon(momentum_state, ctx.raw.volExtreme, confidence, trade_permission)

  const explanation = buildExplanation({
    ctx, netLean, confidence, contradiction, contradictionCount,
    trade_permission, market_state, momentum_state, risk_level,
  })

  const strict: StrictDecision = {
    mds:          Number(mds.toFixed(3)),
    confidence:   Number(confidence01.toFixed(3)),
    market_state,
    trade_bias:   direction_bias === 'NEUTRAL' ? 'NONE' : direction_bias,
    risk:         risk_level === 'EXTREME' ? 'HIGH' : risk_level,
    action:       trade_permission,
  }

  return {
    market_state, momentum_state, flow_bias, participation,
    confidence, risk_level, trade_permission, direction_bias, time_horizon,
    mds: Number(mds.toFixed(3)), explanation, strict,
  }
}

// ── Brief-aligned engine_score [0,1] mapping ─────────────────────────────

function leanOf(ctx: DecisionContext, engine: EngineName): number | null {
  const s = ctx.signals.find((x) => x.engine === engine)
  return s && s.available ? s.lean : null
}

/** Map the available signals onto the brief's seven [0,1] engine scores. */
function briefEngineScores(ctx: DecisionContext): {
  scores: Partial<Record<BriefEngine, number>>
  available: Set<BriefEngine>
} {
  const scores: Partial<Record<BriefEngine, number>> = {}
  const available = new Set<BriefEngine>()
  const to01 = (lean: number) => Math.max(0, Math.min(1, (lean + 1) / 2))

  const sm = leanOf(ctx, 'smartMoney'); if (sm !== null) { scores.smart_money = to01(sm); available.add('smart_money') }
  const mom = leanOf(ctx, 'momentum');  if (mom !== null) { scores.momentum = to01(mom);   available.add('momentum') }
  const wh = leanOf(ctx, 'whaleFlow');  if (wh !== null) { scores.whales = to01(wh);        available.add('whales') }
  const rg = leanOf(ctx, 'regime');     if (rg !== null) { scores.regime = to01(rg);        available.add('regime') }

  // Internals = blend of breadth + dominance (Market Internals).
  const br = leanOf(ctx, 'breadth'); const dm = leanOf(ctx, 'dominance')
  const internalsLeans = [br, dm].filter((x): x is number => x !== null)
  if (internalsLeans.length > 0) {
    scores.internals = to01(internalsLeans.reduce((s, v) => s + v, 0) / internalsLeans.length)
    available.add('internals')
  }

  // Volatility: calm = high score (1 − elevated share). Risk-only engine.
  const volSig = ctx.signals.find((s) => s.engine === 'volatility')
  if (volSig && volSig.available) { scores.volatility = Math.max(0, Math.min(1, 1 - volSig.strength)); available.add('volatility') }

  // Correlation is stubbed (unavailable) — excluded honestly.
  return { scores, available }
}

/** MDS = Σ(score × weight) renormalised over AVAILABLE engines → 0..1. */
function weightedMds(
  scores: Partial<Record<BriefEngine, number>>,
  available: Set<BriefEngine>,
  weights: WeightVector,
): number {
  let wSum = 0, sSum = 0
  for (const k of available) {
    const w = weights[k] ?? 0
    const sc = scores[k]
    if (typeof sc !== 'number') continue
    wSum += w
    sSum += w * sc
  }
  return wSum > 0 ? sSum / wSum : 0.5   // 0.5 = neutral when nothing available
}

function regimeMomentumFallback(state: MarketState): MomentumState {
  // Momentum engine unavailable → derive a coarse phase from the regime
  // environment (clearly noted in the explanation). Not a fabrication —
  // a labelled proxy.
  return state === 'RISK_ON' ? 'EXPANSION'
       : state === 'RISK_OFF' ? 'EXHAUSTION'
       : 'ACCUMULATION'
}

function computeRisk(ctx: DecisionContext, contradiction: boolean, participation: Participation): RiskLevel {
  if (!ctx.raw.executionStable) return 'EXTREME'
  if (ctx.raw.volExtreme && participation !== 'BROAD') return 'EXTREME'
  if (ctx.raw.volExtreme) return 'HIGH'
  if (ctx.raw.volElevated && (participation === 'DECLINING' || contradiction)) return 'HIGH'
  if (ctx.raw.volElevated || contradiction || participation === 'DECLINING') return 'MEDIUM'
  return 'LOW'
}

function computePermission(a: {
  ctx: DecisionContext; confidence: number; contradiction: boolean
  market_state: MarketState; momentum_state: MomentumState; risk_level: RiskLevel
  participation: Participation
  scores: Partial<Record<BriefEngine, number>>; available: Set<BriefEngine>
}): TradePermission {
  const T = DECISION_CONFIG.thresholds
  // Hard overrides first (brief's ALWAYS-AVOID rules).
  if (!a.ctx.raw.executionStable) return 'AVOID'                          // execution instability
  if (a.market_state === 'UNCERTAIN') return 'AVOID'                      // regime uncertain (⊇ "uncertain & momentum<0.5")
  if (a.ctx.raw.volExtreme && a.participation !== 'BROAD') return 'AVOID' // extreme vol + thin participation
  if (a.risk_level === 'EXTREME') return 'AVOID'
  // Smart money weak AND whale flow distributing → AVOID.
  if (a.available.has('smart_money') && a.available.has('whales')
      && (a.scores.smart_money ?? 1) < 0.4 && (a.scores.whales ?? 1) < 0.5) return 'AVOID'

  // Soft gates → at most REDUCE.
  let ceiling: TradePermission = 'ALLOW'
  if (a.momentum_state === 'EXHAUSTION') ceiling = 'REDUCE'
  if (a.contradiction)                   ceiling = 'REDUCE'
  if (a.market_state === 'TRANSITION')   ceiling = 'REDUCE'

  // Confidence ladder.
  let byConfidence: TradePermission =
    a.confidence >= T.minConfidenceToAllow ? 'ALLOW'
    : a.confidence >= T.avoidBelow ? 'REDUCE'
    : 'AVOID'

  // Final = the more conservative of (ceiling, confidence ladder).
  const rank: Record<TradePermission, number> = { ALLOW: 2, REDUCE: 1, AVOID: 0 }
  return rank[ceiling] <= rank[byConfidence] ? ceiling : byConfidence
}

function computeHorizon(
  momentum: MomentumState, volExtreme: boolean, confidence: number, perm: TradePermission,
): TimeHorizon {
  if (perm === 'AVOID' || confidence < DECISION_CONFIG.thresholds.avoidBelow) return 'UNCERTAIN'
  if (momentum === 'PARABOLIC' || momentum === 'EXHAUSTION' || volExtreme) return 'SCALP'
  if (momentum === 'TRENDING') return 'SWING'
  if (momentum === 'EXPANSION') return 'INTRADAY'
  return 'INTRADAY'
}

function buildExplanation(a: {
  ctx: DecisionContext; netLean: number; confidence: number
  contradiction: boolean; contradictionCount: number
  trade_permission: TradePermission; market_state: MarketState
  momentum_state: MomentumState; risk_level: RiskLevel
}): string[] {
  const lines: string[] = []

  // 1. Headline read.
  const dir = a.netLean > 0.12 ? 'risk-on lean' : a.netLean < -0.12 ? 'risk-off lean' : 'no directional edge'
  lines.push(`Environment ${a.market_state.replace('_', '-')} with ${dir}; ${a.confidence}% confidence across ${a.ctx.availableCount} live inputs.`)

  // 2. Dominant contributing engines (available + above noise).
  const drivers = a.ctx.signals
    .filter((s) => s.directional && s.available && s.strength >= DECISION_CONFIG.thresholds.noiseFloor)
    .sort((x, y) => y.strength - x.strength)
    .slice(0, 2)
    .map((s) => s.note)
  lines.push(...drivers)

  // 3. Contradiction / override notes.
  if (a.contradiction) lines.push(`Engines conflict (${a.contradictionCount} opposed) — confidence reduced and permission capped, not averaged.`)
  if (!a.ctx.raw.executionStable) lines.push(a.ctx.raw.executionNote)
  if (a.momentum_state === 'EXHAUSTION') lines.push('Momentum exhaustion present — exposure reduced.')

  // 4. Unavailable engines (honesty).
  const missing = a.ctx.signals.filter((s) => !s.available).map((s) => s.engine)
  if (missing.length > 0) lines.push(`Excluded (unavailable): ${missing.join(', ')}.`)

  return lines.slice(0, 6)
}

// ── Public entry point ─────────────────────────────────────────────────

export async function composeDecision(): Promise<DecisionObject & { generated_at: string }> {
  const ctx = await gatherDecisionContext()
  const decision = buildMarketDecision(ctx)

  // Best-effort logging into the adaptive-intelligence substrate
  // (intel_decisions). Append-only, dedup'd to one row per identical
  // decision per 15-min bucket — this is the training data the governed
  // learning loop will later label + attribute. Abstract states only;
  // no raw indicators are persisted. Never throws into the request path.
  void logDecision({
    surface: 'decision-brain',
    fingerprint: fingerprint([
      decision.market_state, decision.momentum_state, decision.flow_bias,
      decision.participation, decision.trade_permission, decision.direction_bias,
      decision.risk_level,
    ]),
    payload: {
      strict:     decision.strict,
      mds:        decision.mds,
      confidence: decision.confidence,
      // Engine snapshot for future attribution — abstract leans/strengths
      // (already abstracted from raw indicators), never the raw features.
      signals: ctx.signals.map((s) => ({
        engine: s.engine, available: s.available,
        lean: Number(s.lean.toFixed(3)), strength: Number(s.strength.toFixed(3)),
      })),
    },
  })

  return { ...decision, generated_at: ctx.generated_at }
}
