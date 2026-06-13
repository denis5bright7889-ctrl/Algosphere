/**
 * Founder Audit Report (Phase 9).
 *
 * Aggregates the trust posture of the whole intelligence layer into one
 * forensic snapshot: platform trust %, per-module trust %, contradictions,
 * fabrication risks, missing-data risks, and a confidence distribution.
 *
 * Pure + type-only imports → node-testable. The caller assembles per-module
 * TrustResults (via trust-engine) and contradictions (via contradiction-engine)
 * and injects them, so this module has no runtime coupling and cannot itself
 * fabricate a score.
 */
import type { TrustResult, TrustLevel } from './trust-engine'
import type { Contradiction } from './contradiction-engine'

const TRUST_POINTS: Record<TrustLevel, number> = {
  'Verified': 100, 'High': 85, 'Medium': 65, 'Low': 40, 'Very Low': 10,
}

export interface ModuleTrust {
  module:       string
  trust_pct:    number | null   // null = no scored metrics (all Insufficient)
  scored:       number          // metrics with a value
  insufficient: number          // metrics shown as Insufficient Data
}

export interface FounderAuditReport {
  platform_trust_pct: number
  modules:            ModuleTrust[]
  contradictions:     Contradiction[]
  /** Shown numbers whose trust is Low/Very Low — they can mislead. */
  fabrication_risks:  { metric_id: string; value: number; trust_level: TrustLevel }[]
  /** Metrics correctly withheld as Insufficient Data (informational). */
  missing_data_risks: string[]
  confidence_levels:  Record<string, number>   // distribution count
  generated_at:       string
}

export interface AuditInput {
  modules:        Record<string, TrustResult[]>
  contradictions: Contradiction[]
  now?:           Date
}

export function buildFounderAuditReport(input: AuditInput): FounderAuditReport {
  const modules: ModuleTrust[] = []
  const fabrication_risks: FounderAuditReport['fabrication_risks'] = []
  const missing_data_risks: string[] = []
  const confidence_levels: Record<string, number> = {}

  for (const [module, results] of Object.entries(input.modules)) {
    let sumPts = 0, scored = 0, insufficient = 0
    for (const t of results) {
      confidence_levels[t.confidence] = (confidence_levels[t.confidence] ?? 0) + 1
      if (t.value == null) {
        insufficient++
        missing_data_risks.push(`${module}.${t.metric_id}`)
        continue
      }
      scored++
      sumPts += TRUST_POINTS[t.trust_level]
      // A SHOWN number on weak trust is the dangerous case — it looks real.
      if (t.trust_level === 'Low' || t.trust_level === 'Very Low') {
        fabrication_risks.push({ metric_id: `${module}.${t.metric_id}`, value: t.value, trust_level: t.trust_level })
      }
    }
    modules.push({
      module,
      trust_pct: scored > 0 ? Math.round(sumPts / scored) : null,
      scored, insufficient,
    })
  }

  // Platform trust = mean of scored module trust, minus contradiction penalty.
  const scoredModules = modules.filter((m) => m.trust_pct != null) as (ModuleTrust & { trust_pct: number })[]
  const base = scoredModules.length > 0
    ? scoredModules.reduce((s, m) => s + m.trust_pct, 0) / scoredModules.length
    : 0
  const penalty = input.contradictions.reduce((p, c) =>
    p + (c.severity === 'critical' ? 12 : c.severity === 'high' ? 6 : 2), 0)
  const platform_trust_pct = Math.max(0, Math.round(base - penalty))

  return {
    platform_trust_pct,
    modules,
    contradictions: input.contradictions,
    fabrication_risks,
    missing_data_risks,
    confidence_levels,
    generated_at: (input.now ?? new Date()).toISOString(),
  }
}
