/**
 * Attention Engine — social narrative-attention intelligence.
 *
 * Per the platform brief (Section 21): track narrative dominance, social
 * acceleration, attention concentration. Combines with smart money /
 * liquidity / momentum elsewhere; here it measures WHERE ATTENTION IS.
 *
 * Source: X (Twitter) API v2 `tweets/counts/recent` — returns time-bucketed
 * mention counts for a query over the last 7 days in ONE request (cheaper
 * than full search; no per-tweet payload). From the hourly buckets we
 * derive total mentions, 24h-vs-prior acceleration, and an attention state.
 *
 * Auth: TWITTER_BEARER_TOKEN (app-only).
 *
 * Credit model (important): X meters reads. When the account's credits are
 * depleted the API returns 402; rate-limit returns 429. Both are surfaced
 * honestly as available=false with a reason — never faked. The engine
 * resumes automatically when credits refresh.
 *
 * Anti-cloning: exposes attention STATE + acceleration + share — the exact
 * query strings and scoring weights stay server-side.
 */
import 'server-only'

const X_COUNTS = 'https://api.twitter.com/2/tweets/counts/recent'

export type AttentionState = 'Surging' | 'Rising' | 'Steady' | 'Cooling' | 'Quiet' | 'N/A'

export interface AttentionView {
  label:                 string          // asset / theme
  mentions_24h:          number
  /** Recent-24h vs prior-24h change, %. */
  acceleration_pct:      number
  state:                 AttentionState
  /** % of total attention across the tracked basket. */
  share_of_attention_pct: number
  narrative:             string
}

export interface AttentionBoard {
  views:                 AttentionView[]
  headline:              string
  dominant:              string | null
  surging:               string | null
  available:             boolean
  reason?:               string          // why unavailable (402 credits / 401 / 429 / no key)
  generated_at:          string
}

// Tracked attention targets. Queries kept server-side; exclude retweets +
// English-only for a cleaner attention signal. Small basket to respect the
// metered credit model.
const TARGETS: Array<{ label: string; query: string }> = [
  { label: 'Bitcoin',  query: '(bitcoin OR $BTC) -is:retweet lang:en' },
  { label: 'Ethereum', query: '(ethereum OR $ETH) -is:retweet lang:en' },
  { label: 'Solana',   query: '(solana OR $SOL) -is:retweet lang:en' },
  { label: 'AI',       query: '($TAO OR $FET OR "AI agents" crypto) -is:retweet lang:en' },
  { label: 'Memes',    query: '(memecoin OR $WIF OR $PEPE OR $DOGE) -is:retweet lang:en' },
  { label: 'RWA',      query: '($ONDO OR "real world assets" crypto OR RWA token) -is:retweet lang:en' },
]

interface CountBucket { start: string; end: string; tweet_count: number }
interface CountsResponse {
  data?:   CountBucket[]
  meta?:   { total_tweet_count?: number }
  status?: number
  title?:  string
  detail?: string
}

type FetchResult =
  | { ok: true; buckets: CountBucket[] }
  | { ok: false; code: number; reason: string }

function bearer(): string {
  return process.env.TWITTER_BEARER_TOKEN || ''
}

async function fetchCounts(query: string): Promise<FetchResult> {
  const url = `${X_COUNTS}?query=${encodeURIComponent(query)}&granularity=hour`
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${bearer()}` },
      // Aggressive cache — attention shifts over hours, not seconds, and the
      // X credit model is metered. 15 min keeps daily credit burn modest.
      next: { revalidate: 900 },
    })
    if (!r.ok) {
      const code = r.status
      const reason =
        code === 402 ? 'X API credits depleted' :
        code === 429 ? 'X API rate-limited' :
        code === 401 ? 'X bearer token rejected' :
        `X API error ${code}`
      return { ok: false, code, reason }
    }
    const j = (await r.json()) as CountsResponse
    return { ok: true, buckets: j.data ?? [] }
  } catch (e) {
    return { ok: false, code: 0, reason: e instanceof Error ? e.message : 'X request failed' }
  }
}

// ── Derivation ───────────────────────────────────────────────────────────

function sumWindow(buckets: CountBucket[], fromHoursAgo: number, toHoursAgo: number): number {
  const now = Date.now()
  const lo = now - fromHoursAgo * 3_600_000
  const hi = now - toHoursAgo   * 3_600_000
  return buckets
    .filter((b) => { const t = new Date(b.end).getTime(); return t > lo && t <= hi })
    .reduce((s, b) => s + (b.tweet_count || 0), 0)
}

function stateOf(accelPct: number, mentions24h: number): AttentionState {
  if (mentions24h < 50) return 'Quiet'
  if (accelPct >= 60)   return 'Surging'
  if (accelPct >= 15)   return 'Rising'
  if (accelPct <= -25)  return 'Cooling'
  return 'Steady'
}

function narrate(label: string, state: AttentionState, accelPct: number): string {
  switch (state) {
    case 'Surging': return `${label} attention surging (+${Math.round(accelPct)}% vs prior day) — narrative heating fast.`
    case 'Rising':  return `${label} attention rising (+${Math.round(accelPct)}%) — building social interest.`
    case 'Steady':  return `${label} attention steady — stable narrative presence.`
    case 'Cooling': return `${label} attention cooling (${Math.round(accelPct)}%) — interest fading.`
    case 'Quiet':   return `${label} attention quiet — limited social discussion.`
    case 'N/A':     return `${label} attention unavailable.`
  }
}

// ── Public composer ──────────────────────────────────────────────────────

export async function composeAttentionBoard(): Promise<AttentionBoard> {
  const generated_at = new Date().toISOString()
  if (!bearer()) {
    return emptyBoard('TWITTER_BEARER_TOKEN not configured', generated_at)
  }

  const results = await Promise.all(TARGETS.map(async (t) => ({ t, res: await fetchCounts(t.query) })))

  // If EVERY target failed with the same API-level reason, the whole board
  // is unavailable (credits/auth/rate-limit) — report it honestly.
  const anyOk = results.some((r) => r.res.ok)
  if (!anyOk) {
    const firstErr = results.find((r) => !r.res.ok)?.res as { reason: string } | undefined
    return emptyBoard(firstErr?.reason ?? 'X API unavailable', generated_at)
  }

  const rows = results.map(({ t, res }) => {
    if (!res.ok) {
      return { label: t.label, mentions_24h: 0, acceleration_pct: 0, state: 'N/A' as AttentionState, raw24: 0 }
    }
    const recent24 = sumWindow(res.buckets, 24, 0)
    const prior24  = sumWindow(res.buckets, 48, 24)
    const accel = prior24 > 0 ? ((recent24 - prior24) / prior24) * 100 : (recent24 > 0 ? 100 : 0)
    return {
      label: t.label,
      mentions_24h: recent24,
      acceleration_pct: Number(accel.toFixed(1)),
      state: stateOf(accel, recent24),
      raw24: recent24,
    }
  })

  const totalMentions = rows.reduce((s, r) => s + r.raw24, 0) || 1
  const views: AttentionView[] = rows.map((r) => ({
    label:                  r.label,
    mentions_24h:           r.mentions_24h,
    acceleration_pct:       r.acceleration_pct,
    state:                  r.state,
    share_of_attention_pct: Number(((r.raw24 / totalMentions) * 100).toFixed(1)),
    narrative:              narrate(r.label, r.state, r.acceleration_pct),
  })).sort((a, b) => b.mentions_24h - a.mentions_24h)

  const dominant = views[0]?.label ?? null
  const surging  = views.find((v) => v.state === 'Surging')?.label ?? null
  const headline = buildHeadline(views, dominant, surging)

  return { views, headline, dominant, surging, available: true, generated_at }
}

function buildHeadline(views: AttentionView[], dominant: string | null, surging: string | null): string {
  if (views.length === 0) return 'No attention data available.'
  const parts: string[] = []
  if (dominant) parts.push(`${dominant} leads social attention (${views[0]!.share_of_attention_pct.toFixed(0)}% share).`)
  if (surging && surging !== dominant) parts.push(`${surging} surging beneath it.`)
  const cooling = views.find((v) => v.state === 'Cooling')
  if (cooling) parts.push(`${cooling.label} cooling.`)
  return parts.join(' ')
}

function emptyBoard(reason: string, generated_at: string): AttentionBoard {
  return {
    views: [], headline: `Attention intelligence unavailable: ${reason}`,
    dominant: null, surging: null, available: false, reason, generated_at,
  }
}
