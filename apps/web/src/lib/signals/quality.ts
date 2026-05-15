// =============================================================================
// AlgoSphere Quant — Trade Quality Scoring Engine
// Produces a 0–10 institutional grade for each signal
// =============================================================================

export interface QualityInputs {
  risk_reward: number
  confidence_score?: number
  trend_score?: number      // 0–30
  momentum_score?: number   // 0–25
  liquidity_score?: number  // 0–15
  rr_score?: number         // 0–20
  volatility_score?: number // 0–10
  regime?: string
}

export interface QualityResult {
  quality_score: number        // 0–10, 2dp
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F'
  label: string
  breakdown: {
    trend: number
    momentum: number
    liquidity: number
    rr: number
    volatility: number
  }
}

export function computeQualityScore(inputs: QualityInputs): QualityResult {
  // If individual scores are provided, use them directly
  const trend = Math.min(inputs.trend_score ?? scoreRR(inputs.risk_reward) * 0.6, 30)
  const momentum = Math.min(inputs.momentum_score ?? 15, 25)
  const liquidity = Math.min(inputs.liquidity_score ?? scoreRegime(inputs.regime), 15)
  const rr = scoreRR(inputs.risk_reward)
  const volatility = Math.min(inputs.volatility_score ?? 7, 10)

  const raw = trend + momentum + liquidity + rr + volatility  // max 100
  const quality = Math.round((raw / 100) * 10 * 100) / 100

  return {
    quality_score: quality,
    grade: toGrade(quality),
    label: toLabel(quality),
    breakdown: { trend, momentum, liquidity, rr, volatility },
  }
}

function scoreRR(rr: number): number {
  // R:R contributes up to 20 points
  if (rr >= 3.0) return 20
  if (rr >= 2.5) return 18
  if (rr >= 2.0) return 16
  if (rr >= 1.5) return 12
  if (rr >= 1.2) return 8
  return 4
}

function scoreRegime(regime: string | undefined): number {
  switch (regime) {
    case 'trending': return 15
    case 'breakout': return 13
    case 'ranging': return 8
    case 'volatile': return 6
    case 'compression': return 10
    case 'dead': return 2
    default: return 10
  }
}

function toGrade(score: number): QualityResult['grade'] {
  if (score >= 8.5) return 'A+'
  if (score >= 7.5) return 'A'
  if (score >= 6.5) return 'B+'
  if (score >= 5.5) return 'B'
  if (score >= 4.5) return 'C'
  if (score >= 3.0) return 'D'
  return 'F'
}

function toLabel(score: number): string {
  if (score >= 8.5) return 'Institutional Grade'
  if (score >= 7.5) return 'High Conviction'
  if (score >= 6.5) return 'Strong Setup'
  if (score >= 5.5) return 'Standard'
  if (score >= 4.5) return 'Below Average'
  return 'Low Conviction'
}

// Grade colour for UI
export const GRADE_COLORS: Record<QualityResult['grade'], string> = {
  'A+': 'bg-emerald-500 text-white',
  'A':  'bg-green-500 text-white',
  'B+': 'bg-blue-500 text-white',
  'B':  'bg-blue-400 text-white',
  'C':  'bg-yellow-500 text-black',
  'D':  'bg-orange-500 text-white',
  'F':  'bg-red-600 text-white',
}
