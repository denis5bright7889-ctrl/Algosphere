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

  const [regime, momentumR, smartR, whaleR, breadthR, overviewR, volR, execStatusR, riskR, breakersR] =
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

  // Smart money (market summary) — only when the provider really answered
  let smBias = 0
  if (smart && !smart.partial) {
    const s = smart.summary
    smBias = s.smart_money_bias === 'Bullish' ? 1 : s.smart_money_bias === 'Bearish' ? -1 : 0
    const strength = Math.max(0, Math.min(1, s.conviction / 100))
    signals.push({
      engine: 'smartMoney', available: true, directional: true,
      lean: smBias * strength, strength,
      note: `Smart money: ${s.smart_money_bias.toLowerCase()} bias, ${s.participation_quality.toLowerCase()} participation, ${s.risk_appetite.toLowerCase()} risk appetite.`,
    })
  } else {
    signals.push({ engine: 'smartMoney', available: false, directional: true, lean: 0, strength: 0,
      note: `Smart money: unavailable${smart?.reason ? ` (${smart.reason})` : ''} — excluded from the vote.` })
  }

  // Whale flow (capital movement summary)
  let whaleBias = 0
  if (whale && !whale.partial) {
    const w = whale.summary
    whaleBias = w.movement_bias === 'Accumulation' ? 1 : w.movement_bias === 'Distribution' ? -1 : 0
    const strength = Math.max(0, Math.min(1, w.confidence / 100))
    signals.push({
      engine: 'whaleFlow', available: true, directional: true,
      lean: whaleBias * strength, strength,
      note: `Whale flow: ${w.movement_bias.toLowerCase()} (${w.dominant_movement}), ${w.movement_aggression.toLowerCase()} aggression.`,
    })
  } else {
    signals.push({ engine: 'whaleFlow', available: false, directional: true, lean: 0, strength: 0,
      note: 'Whale flow: unavailable — excluded from the vote.' })
  }

  // Breadth → participation + directional posture
  let participation: Participation | null = null
  if (breadth && breadth.crypto.available) {
    const pct = breadth.crypto.pct_advancing
    participation = pct >= 55 ? 'BROAD' : pct >= DECISION_CONFIG.thresholds.decliningParticipationPct ? 'NARROW' : 'DECLINING'
    const postureLean = breadth.posture === 'Risk-On' ? 1 : breadth.posture === 'Risk-Off' ? -1 : 0
    const strength = Math.max(0, Math.min(1, Math.abs(pct - 50) / 50 + 0.2))
    signals.push({
      engine: 'breadth', available: true, directional: true,
      lean: postureLean * strength, strength,
      note: `Breadth: ${breadth.crypto.state} (${pct}% of ${breadth.crypto.sample_size} advancing), posture ${breadth.posture}.`,
    })
  } else {
    signals.push({ engine: 'breadth', available: false, directional: true, lean: 0, strength: 0,
      note: 'Breadth: unavailable.' })
  }

  // Dominance sentiment
  if (overview && overview.dominance) {
    const d = overview.dominance
    const lean = d.sentiment === 'Risk-On' ? 1 : d.sentiment === 'Risk-Off' ? -1 : 0
    const strength = 0.5
    signals.push({
      engine: 'dominance', available: true, directional: true,
      lean: lean * strength, strength,
      note: `Dominance: BTC ${d.btc_dominance}%, total cap ${d.mcap_change_24h >= 0 ? '+' : ''}${d.mcap_change_24h}% 24h (${d.sentiment}).`,
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

  // Correlation — listed input not yet wired into the brain; honest about it.
  signals.push({
    engine: 'correlation', available: false, directional: false, lean: 0, strength: 0,
    note: 'Correlation breakdown detection is not yet wired into the brain — it does not affect this decision.',
  })

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

  // Flow bias (smart money + whale)
  const flowSum = smBias + whaleBias
  const flowBias: FlowBias | null =
    (smart && !smart.partial) || (whale && !whale.partial)
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
