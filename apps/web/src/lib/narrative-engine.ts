/**
 * Narrative Intelligence Engine — institutional theme tracker.
 *
 * Per the brief (Section 7): track ecosystem narratives, AI themes, meme
 * speculation, ETF narratives, macro narratives, stablecoin expansion,
 * sector rotations — exposing STRENGTH / ACCELERATION / FATIGUE /
 * INSTITUTIONAL PARTICIPATION / CROWDING per theme.
 *
 * Differs from Capital Rotation: rotation asks "where is capital flowing
 * RIGHT NOW?" Narrative asks "which themes are gathering attention, which
 * are fading, where is the crowd, and where is institutional capital
 * actually validating the story?"
 *
 * Composition:
 *   - Pulls Nansen tokenScreener (same source as SM / Rotation / Whale)
 *   - Buckets tokens into themes via token-sectors map
 *   - For each theme: derives strength (flow share), acceleration (price-
 *     change spread), fatigue (sustainability ratio), institutional
 *     participation (smart-money allocation share), crowding (top-token
 *     concentration within the theme)
 *
 * Anti-cloning: never exposes raw flows / FDV ratios / weights. Only
 * institutional STATE labels + composite scores.
 */
import 'server-only'
import { tokenScreener, isNansenConfigured, type NansenToken, type NansenChain } from '@/lib/nansen'
import { sectorOf, SECTOR_LABEL, type Sector } from '@/lib/token-sectors'

// ── Public types ─────────────────────────────────────────────────────────

export type NarrativeStrength    = 'Dominant' | 'Strong' | 'Building' | 'Quiet' | 'N/A'
export type NarrativeAcceleration = 'Accelerating' | 'Steady' | 'Decelerating' | 'Fading' | 'N/A'
export type NarrativeFatigue     = 'Fresh' | 'Healthy' | 'Stretched' | 'Exhausted' | 'N/A'
export type InstitutionalParticipation = 'Heavy' | 'Active' | 'Light' | 'Absent' | 'N/A'
export type CrowdingRisk         = 'Crowded' | 'Active' | 'Balanced' | 'Quiet' | 'N/A'

export interface NarrativeView {
  theme:                   string          // sector label
  /** 0..100 composite — how loud the narrative is RIGHT NOW. */
  strength_score:          number
  strength:                NarrativeStrength
  acceleration:            NarrativeAcceleration
  fatigue:                 NarrativeFatigue
  institutional_participation: InstitutionalParticipation
  crowding:                CrowdingRisk
  /** % of total universe inflow this theme represents. */
  share_of_flow_pct:       number
  /** Up to 4 tickers driving the theme. */
  top_tickers:             string[]
  narrative:               string
}

export interface NarrativeBoard {
  /** Themes sorted by strength_score descending. */
  themes:                  NarrativeView[]
  /** Top-of-page composed institutional narrative. */
  headline:                string
  /** Theme currently 'leading' the narrative landscape. */
  dominant_theme:          string
  /** Theme with the most accelerating signal (rising fastest). */
  accelerating_theme:      string | null
  /** Theme showing the most fatigue — caution flag. */
  exhausting_theme:        string | null
  generated_at:            string
  partial:                 boolean
  reason?:                 string
}

// ── Tunable thresholds ──────────────────────────────────────────────────

const MIN_LIQUIDITY_USD  = 500_000
const MIN_THEME_TOKENS   = 2          // theme needs at least N tokens to be classified

// ── Per-theme derivation ─────────────────────────────────────────────────

interface ThemeAgg {
  tokens:      NansenToken[]
  buy:         number
  sell:        number
  netflow:     number
  inflow_fdv:  number
  outflow_fdv: number
  meanPriceChange:  number
  pcCount:     number
}

function bucketize(tokens: NansenToken[]): Map<Sector, ThemeAgg> {
  const out = new Map<Sector, ThemeAgg>()
  for (const t of tokens) {
    if ((t.liquidity ?? 0) < MIN_LIQUIDITY_USD) continue
    const sec = sectorOf(t.token_symbol)
    const a = out.get(sec) ?? { tokens: [], buy: 0, sell: 0, netflow: 0, inflow_fdv: 0, outflow_fdv: 0, meanPriceChange: 0, pcCount: 0 }
    a.tokens.push(t)
    a.buy        += t.buy_volume   || 0
    a.sell       += t.sell_volume  || 0
    a.netflow    += t.netflow      || 0
    a.inflow_fdv += t.inflow_fdv_ratio  || 0
    a.outflow_fdv+= t.outflow_fdv_ratio || 0
    if (Number.isFinite(t.price_change)) { a.meanPriceChange += t.price_change; a.pcCount += 1 }
    out.set(sec, a)
  }
  // Drop themes with too few tokens — single-token themes aren't narratives
  for (const [sec, a] of out) if (a.tokens.length < MIN_THEME_TOKENS) out.delete(sec)
  return out
}

function strengthLabel(score: number): NarrativeStrength {
  if (score >= 75) return 'Dominant'
  if (score >= 55) return 'Strong'
  if (score >= 30) return 'Building'
  if (score > 0)   return 'Quiet'
  return 'N/A'
}

function accelerationLabel(meanPc: number, buyDom: number): NarrativeAcceleration {
  if (meanPc >=  0.08 && buyDom > 0.15) return 'Accelerating'
  if (meanPc >=  0.02 && buyDom > 0)    return 'Steady'
  if (meanPc <= -0.05)                  return 'Fading'
  if (meanPc < 0 || buyDom < -0.1)      return 'Decelerating'
  return 'Steady'
}

function fatigueLabel(inflowFdv: number, outflowFdv: number, meanPc: number): NarrativeFatigue {
  const ratio = outflowFdv > 0 ? inflowFdv / outflowFdv : (inflowFdv > 0 ? 5 : 0)
  if (ratio >= 3 && meanPc < 0.05)   return 'Fresh'
  if (ratio >= 1.5)                  return 'Healthy'
  if (ratio >= 0.7)                  return 'Stretched'
  return 'Exhausted'
}

function participationLabel(inflowFdv: number, themeTokens: number): InstitutionalParticipation {
  // inflow_fdv aggregated across the theme; normalised by token count
  const perToken = themeTokens > 0 ? inflowFdv / themeTokens : 0
  if (perToken >= 0.015) return 'Heavy'
  if (perToken >= 0.005) return 'Active'
  if (perToken >  0)     return 'Light'
  return 'Absent'
}

function crowdingLabel(agg: ThemeAgg): CrowdingRisk {
  // Crowding = top-token share of theme's net inflow. High = a single coin
  // is carrying the narrative (concentrated risk); Balanced = breadth.
  const flows = agg.tokens.map((t) => Math.max(0, t.netflow || 0))
  const sum = flows.reduce((a, b) => a + b, 0)
  if (sum === 0) return 'Quiet'
  const top = Math.max(...flows)
  const share = top / sum
  if (share >= 0.70) return 'Crowded'
  if (share >= 0.45) return 'Active'
  if (share >= 0.25) return 'Balanced'
  return 'Quiet'
}

function buildNarrativeView(sec: Sector, agg: ThemeAgg, totalInflow: number): NarrativeView {
  const themeName = SECTOR_LABEL[sec]
  const meanPc = agg.pcCount > 0 ? agg.meanPriceChange / agg.pcCount : 0
  const buyDom = agg.buy + agg.sell > 0 ? (agg.buy - agg.sell) / (agg.buy + agg.sell) : 0
  const inflowPositive = agg.tokens.reduce((s, t) => s + Math.max(0, t.netflow || 0), 0)
  const share = totalInflow > 0 ? (inflowPositive / totalInflow) * 100 : 0

  // Strength score: weighted of share + acceleration + participation
  const accel = accelerationLabel(meanPc, buyDom)
  const accelComp = accel === 'Accelerating' ? 1.0 : accel === 'Steady' ? 0.6 : accel === 'Decelerating' ? 0.3 : 0.1
  const partComp = (() => {
    const p = participationLabel(agg.inflow_fdv, agg.tokens.length)
    return p === 'Heavy' ? 1.0 : p === 'Active' ? 0.7 : p === 'Light' ? 0.4 : 0.1
  })()
  const strengthScore = Math.round(
    Math.min(100, (share * 0.5) + (accelComp * 30) + (partComp * 20))
  )

  // Top tickers by net inflow within the theme
  const topTickers = agg.tokens
    .sort((a, b) => (b.netflow || 0) - (a.netflow || 0))
    .slice(0, 4)
    .map((t) => t.token_symbol.toUpperCase())

  const fatigue = fatigueLabel(agg.inflow_fdv, agg.outflow_fdv, meanPc)
  const participation = participationLabel(agg.inflow_fdv, agg.tokens.length)
  const crowding = crowdingLabel(agg)

  const narrative = composeThemeNarrative({
    theme: themeName, strength: strengthLabel(strengthScore), acceleration: accel,
    fatigue, participation, crowding,
  })

  return {
    theme:                       themeName,
    strength_score:              strengthScore,
    strength:                    strengthLabel(strengthScore),
    acceleration:                accel,
    fatigue,
    institutional_participation: participation,
    crowding,
    share_of_flow_pct:           Number(share.toFixed(1)),
    top_tickers:                 topTickers,
    narrative,
  }
}

// ── Narrative copy generation ────────────────────────────────────────────

function composeThemeNarrative(v: {
  theme: string; strength: NarrativeStrength; acceleration: NarrativeAcceleration;
  fatigue: NarrativeFatigue; participation: InstitutionalParticipation; crowding: CrowdingRisk;
}): string {
  const headParts: string[] = []
  if (v.strength === 'Dominant')       headParts.push(`${v.theme} dominating the narrative landscape`)
  else if (v.strength === 'Strong')    headParts.push(`${v.theme} narrative strong`)
  else if (v.strength === 'Building')  headParts.push(`${v.theme} narrative building`)
  else                                  headParts.push(`${v.theme} narrative quiet`)

  if (v.acceleration === 'Accelerating') headParts.push('accelerating fast')
  else if (v.acceleration === 'Fading')  headParts.push('fading')
  else if (v.acceleration === 'Decelerating') headParts.push('decelerating')

  const tail: string[] = []
  if (v.participation === 'Heavy')   tail.push('heavy institutional participation')
  else if (v.participation === 'Active') tail.push('active institutional participation')
  else if (v.participation === 'Absent') tail.push('institutional capital absent')

  if (v.fatigue === 'Exhausted') tail.push('flow exhausted')
  else if (v.fatigue === 'Stretched') tail.push('flow stretched')
  else if (v.fatigue === 'Fresh') tail.push('flow fresh')

  if (v.crowding === 'Crowded') tail.push('crowding risk elevated')

  const head = headParts.join(', ')
  return tail.length > 0 ? `${head}; ${tail.join(', ')}.` : `${head}.`
}

function buildHeadline(themes: NarrativeView[]): string {
  if (themes.length === 0) return 'No narrative read available — Nansen returned an empty universe.'
  const dominant = themes[0]!
  const accelerating = themes.find((t) => t.acceleration === 'Accelerating' && t.theme !== dominant.theme)
  const exhausting   = themes.find((t) => t.fatigue === 'Exhausted')
  const crowded      = themes.find((t) => t.crowding === 'Crowded')
  const parts: string[] = []
  parts.push(`${dominant.theme} is leading the narrative landscape (${dominant.strength_score}% strength, ${dominant.share_of_flow_pct.toFixed(1)}% of universe inflow).`)
  if (accelerating) parts.push(`${accelerating.theme} accelerating beneath it.`)
  if (exhausting)   parts.push(`${exhausting.theme} showing exhaustion.`)
  if (crowded && crowded.theme !== dominant.theme) parts.push(`Crowding risk in ${crowded.theme}.`)
  return parts.join(' ')
}

// ── Public composer ──────────────────────────────────────────────────────

export async function composeNarrativeBoard(opts: { window?: '1h' | '24h' | '7d' | '30d' } = {}): Promise<NarrativeBoard> {
  const generated_at = new Date().toISOString()
  if (!isNansenConfigured()) {
    return emptyBoard('NANSEN_API_KEY not configured', generated_at)
  }
  let tokens: NansenToken[] = []
  try {
    tokens = await tokenScreener({
      chains:    ['ethereum','solana','base'] as NansenChain[],
      timeframe: opts.window ?? '24h',
      orderBy:   'buy_volume',
      direction: 'DESC',
      limit:     150,
    })
  } catch (e) {
    return emptyBoard(e instanceof Error ? e.message : 'Nansen unavailable', generated_at)
  }
  if (tokens.length === 0) {
    return emptyBoard('Nansen screener returned an empty universe for this window', generated_at)
  }

  const buckets = bucketize(tokens)
  if (buckets.size === 0) {
    return emptyBoard('No themes meet the minimum token / liquidity thresholds in this window', generated_at)
  }

  const totalInflow = [...buckets.values()].reduce((s, a) => s + a.tokens.reduce((p, t) => p + Math.max(0, t.netflow || 0), 0), 0)
  const themes = [...buckets.entries()]
    .map(([sec, agg]) => buildNarrativeView(sec, agg, totalInflow))
    .sort((a, b) => b.strength_score - a.strength_score)

  const dominantTheme    = themes[0]?.theme ?? '—'
  const acceleratingTheme = themes.find((t) => t.acceleration === 'Accelerating' && t.theme !== dominantTheme)?.theme ?? null
  const exhaustingTheme  = themes.find((t) => t.fatigue === 'Exhausted')?.theme ?? null
  const headline         = buildHeadline(themes)

  return {
    themes,
    headline,
    dominant_theme:        dominantTheme,
    accelerating_theme:    acceleratingTheme,
    exhausting_theme:      exhaustingTheme,
    generated_at,
    partial:               false,
  }
}

function emptyBoard(reason: string, generated_at: string): NarrativeBoard {
  return {
    themes:             [],
    headline:           `Narrative intelligence unavailable: ${reason}`,
    dominant_theme:     '—',
    accelerating_theme: null,
    exhausting_theme:   null,
    generated_at,
    partial:            true,
    reason,
  }
}
