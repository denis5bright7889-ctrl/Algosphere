/**
 * Analyze-Mode intelligence grid — server composer (Reliability v2).
 *
 * Same Decision-Brain ingest as before, but the output is wrapped by
 * the reliability layer so user-facing surfaces NEVER expose:
 *
 *   - "Nansen 403: Insufficient credits"
 *   - "fetch failed: ECONNREFUSED"
 *   - "Awaiting" / "Unavailable" / "Excluded from vote"
 *
 * Instead each module carries `userStatus`, `source_quality`,
 * `freshness`, and a sanitized `reasoning` string. When an engine
 * fails on this pass, we serve the last successfully-cached read with
 * `userStatus: 'stale'` so the grid never goes blank.
 *
 * Engine internals (raw notes, provider names, error codes) are still
 * available on `module.insight` for the admin-side observability page
 * — those NEVER reach the user UI per the founder rule.
 */
import 'server-only'
import {
  gatherDecisionContext, buildMarketDecision, type NormalizedSignal,
} from '@/lib/decision-brain'
import { DECISION_CONFIG } from '@/lib/decision-brain/config'
import type {
  GridPayload, GridVerdict, IntelligenceModule, ModuleStatus,
} from './grid-types'
import {
  sanitizeReasoning, deriveSourceQuality, deriveUserStatus,
  freshnessLabel, ttlFor,
} from './reliability'
import { rememberModule, recallModule } from './reliability-cache'
import { recordEngineEvent, classifyError } from './engine-telemetry'

// Display names for the Bloomberg-style card headers.
const NAME: Record<string, string> = {
  regime:      'Market Regime',
  momentum:    'Momentum',
  breadth:     'Market Breadth',
  smartMoney:  'Smart Money',
  whaleFlow:   'Whale Flows',
  dominance:   'Dominance & Rotation',
  volatility:  'Volatility',
  correlation: 'Correlations',
  execution:   'Execution Quality',
}

// Stable display order — directional engines first (decision-bearing),
// then the risk-only engines (volatility, execution) last.
const ORDER = [
  'regime', 'momentum', 'breadth', 'smartMoney', 'whaleFlow',
  'dominance', 'correlation', 'volatility', 'execution',
]

function statusOf(s: NormalizedSignal): ModuleStatus {
  if (!s.available) return 'unavailable'
  if (!s.directional) return 'neutral'
  const band = DECISION_CONFIG.thresholds.neutralBand
  if (s.lean >  band) return 'bullish'
  if (s.lean < -band) return 'bearish'
  return 'neutral'
}

function toFreshModule(s: NormalizedSignal, generatedAt: string): IntelligenceModule {
  const ttl = ttlFor(s.engine)
  const ageMs = 0
  const fromHeuristic = s.provenance === 'heuristic'
  const sourceQuality = deriveSourceQuality({
    available:  s.available,
    strength01: s.strength ?? 0,
    ageMs, ttlMs: ttl,
    fromHeuristic,
  })
  return {
    key:             s.engine,
    name:            NAME[s.engine] ?? s.engine,
    status:          statusOf(s),
    userStatus:      deriveUserStatus({
      available: s.available, fromCache: false, fromHeuristic, ageMs, ttlMs: ttl,
    }),
    confidence:      Math.round((s.strength ?? 0) * 100),
    lean:            s.lean ?? 0,
    directional:     s.directional,
    available:       s.available,
    insight:         s.note,                              // raw — admin only
    reasoning:       sanitizeReasoning(s.engine, s.note),  // user-facing
    source_quality:  sourceQuality,
    freshness:       freshnessLabel(generatedAt),
    updatedAt:       generatedAt,
    data:            s.data,
  }
}

/** Re-stamp a cached module for display: keep its data + reasoning,
 *  but mark it 'stale' and recompute its freshness label against now.
 *  The cache TTL gate already happened in `recallModule`. */
function toStaleModule(m: IntelligenceModule, ageMs: number): IntelligenceModule {
  const ttl = ttlFor(m.key)
  return {
    ...m,
    userStatus:     deriveUserStatus({ available: false, fromCache: true, ageMs, ttlMs: ttl }),
    source_quality: deriveSourceQuality({
      available:  true, strength01: m.confidence / 100,
      ageMs, ttlMs: ttl,
    }),
    freshness:      freshnessLabel(m.updatedAt),
  }
}

/** Synthesize a 'building' module for an engine we've never seen.
 *  Keeps the grid populated rather than dropping an empty card. */
function toBuildingModule(engine: string, generatedAt: string): IntelligenceModule {
  return {
    key:             engine,
    name:            NAME[engine] ?? engine,
    status:          'unavailable',
    userStatus:      'building',
    confidence:      0,
    lean:            0,
    directional:     true,
    available:       false,
    insight:         '',                                    // empty raw
    reasoning:       sanitizeReasoning(engine, ''),         // canonical fallback
    source_quality:  'fallback',
    freshness:       freshnessLabel(generatedAt),
    updatedAt:       generatedAt,
  }
}


export async function composeIntelligenceGrid(): Promise<GridPayload> {
  const ctx = await gatherDecisionContext()
  const decision = buildMarketDecision(ctx)

  const byKey = new Map<string, NormalizedSignal>(ctx.signals.map((s) => [s.engine, s]))

  // For each engine in our canonical order, prefer the fresh signal;
  // fall back to the cache if the engine reported unavailable; finally
  // synthesize a 'building' placeholder so the card never goes blank.
  // Each resolution emits a telemetry event so the admin observability
  // page can show provider health, fallback activation, and recent
  // error classes.
  const now = ctx.generated_at
  const modules: IntelligenceModule[] = []
  for (const engine of ORDER) {
    const signal = byKey.get(engine)
    if (signal && signal.available) {
      const fresh = toFreshModule(signal, now)
      // Heuristic reads are NEVER cached — caching a fallback as
      // "high quality" later would corrupt the source_quality grade.
      // External reads still flow into the reliability cache.
      if (signal.provenance !== 'heuristic') rememberModule(fresh)
      modules.push(fresh)
      recordEngineEvent({
        at: now, engine,
        outcome:        signal.provenance === 'heuristic' ? 'heuristic' : 'live',
        source_quality: fresh.source_quality,
      })
      continue
    }
    const errClass = signal ? classifyError(signal.note) ?? undefined : undefined
    const cached = recallModule(engine)
    if (cached) {
      modules.push(toStaleModule(cached.module, cached.ageMs))
      recordEngineEvent({
        at: now, engine, outcome: 'stale',
        source_quality: 'low',
        error_class: errClass,
        cache_age_ms: cached.ageMs,
      })
      continue
    }
    modules.push(toBuildingModule(engine, now))
    recordEngineEvent({
      at: now, engine, outcome: 'building',
      source_quality: 'fallback',
      error_class: errClass,
    })
  }
  // Engines outside the canonical ORDER (rare — future additions) are
  // appended fresh-or-building, and still recorded.
  for (const s of ctx.signals) {
    if (ORDER.includes(s.engine)) continue
    const fresh = toFreshModule(s, now)
    if (s.available && s.provenance !== 'heuristic') rememberModule(fresh)
    modules.push(fresh)
    recordEngineEvent({
      at: now, engine: s.engine,
      outcome: s.available
        ? (s.provenance === 'heuristic' ? 'heuristic' : 'live')
        : 'building',
      source_quality: fresh.source_quality,
      error_class:    s.available ? undefined : classifyError(s.note) ?? undefined,
    })
  }

  return {
    verdict: buildVerdictHeader(decision, modules),
    modules,
    availableCount: modules.filter((m) => m.userStatus === 'live').length,
    generatedAt:    ctx.generated_at,
  }
}


/** Coverage / Reliability / Data-Quality derived from the module set. */
function buildVerdictHeader(
  decision: ReturnType<typeof buildMarketDecision>,
  modules:  IntelligenceModule[],
): GridVerdict {
  // Coverage counts engines that produced a usable read this cycle —
  // live, degraded, or internal-heuristic. Stale/building do not count.
  // Reliability counts only high/medium source-quality reads; heuristic
  // (source_quality: 'fallback') deliberately does NOT count, so
  // reliability honestly drops when externals are down.
  const total = modules.length || 1
  const usable = modules.filter((m) =>
    m.userStatus === 'live' || m.userStatus === 'degraded' || m.userStatus === 'fallback',
  ).length
  const highOrMedium = modules.filter(
    (m) => m.source_quality === 'high' || m.source_quality === 'medium',
  ).length
  const coverage    = Math.round((usable       / total) * 100)
  const reliability = Math.round((highOrMedium / total) * 100)
  const dq: GridVerdict['data_quality'] =
    reliability >= 70 ? 'high' :
    reliability >= 40 ? 'medium' : 'low'

  return {
    marketState:     decision.market_state,
    directionBias:   decision.direction_bias,
    confidence:      decision.confidence,
    riskLevel:       decision.risk_level,
    tradePermission: decision.trade_permission,
    mds:             decision.mds,
    explanation:     decision.explanation,
    coverage,
    reliability,
    data_quality:    dq,
  }
}
