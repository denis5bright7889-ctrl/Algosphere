/**
 * Edge confidence tiers — the evidence-first foundation for ALL edge analytics
 * (pair / setup / session / strategy / per-symbol), mirroring Coach Eval v3:
 * a conclusion is only as strong as its sample, and below the minimum evidence
 * threshold NOTHING is labeled profitable or unprofitable — it is
 * "Insufficient Evidence".
 *
 * Used by journal-analytics (condition edges), signal-quality (per-symbol),
 * coach (segment insights), and the explainability layer.
 */

export type EdgeConfidence = 'insufficient' | 'low' | 'medium' | 'high'
export type EdgeVerdict = 'insufficient_evidence' | 'profitable' | 'unprofitable' | 'neutral'

/**
 * Minimum closed trades before a cohort may be CALLED an edge at all. Below
 * this the verdict is always 'insufficient_evidence' regardless of how good
 * the numbers look (a 5-trade 80% win rate is noise, not an edge).
 */
export const EDGE_MIN_TRADES = 10
/** Cohorts with at least this many trades are surfaced (labeled Insufficient
 *  if < EDGE_MIN_TRADES) rather than silently dropped. */
export const EDGE_SURFACE_MIN = 3

/** Sample size → confidence tier. */
export function edgeConfidence(trades: number): EdgeConfidence {
  if (!Number.isFinite(trades) || trades < EDGE_MIN_TRADES) return 'insufficient'
  if (trades < 20) return 'low'
  if (trades < 50) return 'medium'
  return 'high'
}

/** Expectancy + confidence → verdict. Insufficient sample never gets a
 *  profitable/unprofitable label. */
export function edgeVerdict(expectancy: number, conf: EdgeConfidence): EdgeVerdict {
  if (conf === 'insufficient') return 'insufficient_evidence'
  if (!Number.isFinite(expectancy) || expectancy === 0) return 'neutral'
  return expectancy > 0 ? 'profitable' : 'unprofitable'
}

const VERDICT_LABEL: Record<EdgeVerdict, string> = {
  insufficient_evidence: 'Insufficient Evidence',
  profitable:            'Profitable',
  unprofitable:          'Unprofitable',
  neutral:               'No clear edge',
}
export function edgeVerdictLabel(v: EdgeVerdict): string {
  return VERDICT_LABEL[v]
}

const CONFIDENCE_LABEL: Record<EdgeConfidence, string> = {
  insufficient: 'Insufficient',
  low:          'Low',
  medium:       'Medium',
  high:         'High',
}
export function edgeConfidenceLabel(c: EdgeConfidence): string {
  return CONFIDENCE_LABEL[c]
}

/**
 * Wilson score interval for a win rate — a statistically defensible 95% CI
 * that (unlike wins/n ± …) behaves well on small samples. Lets the UI show
 * "win rate 60% (95% CI 39–78%)" so the user sees the uncertainty, not just
 * a point estimate.
 */
export function wilsonInterval(wins: number, n: number, z = 1.96): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 0 }
  const p = wins / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = p + z2 / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)
  return {
    low:  Math.max(0, (centre - margin) / denom),
    high: Math.min(1, (centre + margin) / denom),
  }
}

/** One call → the full evidence verdict for a cohort. */
export interface EdgeAssessment {
  trades:      number
  confidence:  EdgeConfidence
  verdict:     EdgeVerdict
  verdict_label: string
  win_rate_ci?: { low: number; high: number }
}
export function assessEdge(args: { trades: number; expectancy: number; wins?: number }): EdgeAssessment {
  const confidence = edgeConfidence(args.trades)
  const verdict = edgeVerdict(args.expectancy, confidence)
  return {
    trades: args.trades,
    confidence,
    verdict,
    verdict_label: edgeVerdictLabel(verdict),
    win_rate_ci: args.wins != null ? wilsonInterval(args.wins, args.trades) : undefined,
  }
}
