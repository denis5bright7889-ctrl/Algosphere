/**
 * Attention Engine — social narrative-attention intelligence (multi-source).
 *
 * Per the platform brief (Section 21): narrative dominance, social
 * acceleration, attention concentration. Measures WHERE ATTENTION IS,
 * to pair with Smart Money / Narrative and separate genuine flow from hype.
 *
 * Sources (used together when available, per target):
 *   • Reddit Data API  — FREE, unmetered (~100 req/min). The reliable
 *     baseline. App-only OAuth2 (client_credentials) on a 'script' app.
 *   • X (Twitter) v2 counts/recent — enriches when the metered account
 *     has credits; returns 402 when depleted (handled, not faked).
 *
 * For each target we count recent-24h vs prior-24h mentions across the
 * live sources, derive acceleration + an attention state, and report
 * which sources contributed. If NO source is available the board reports
 * available=false with the reason — never fabricated.
 *
 * Anti-cloning: exposes attention STATE + acceleration + share + which
 * sources were live. Query strings + thresholds stay server-side.
 */
import 'server-only'

const X_COUNTS       = 'https://api.twitter.com/2/tweets/counts/recent'
const REDDIT_TOKEN   = 'https://www.reddit.com/api/v1/access_token'
const REDDIT_SEARCH  = 'https://oauth.reddit.com/search'

export type AttentionState = 'Surging' | 'Rising' | 'Steady' | 'Cooling' | 'Quiet' | 'N/A'
export type AttentionSource = 'reddit' | 'x'

export interface AttentionView {
  label:                 string
  mentions_24h:          number
  acceleration_pct:      number
  state:                 AttentionState
  share_of_attention_pct: number
  /** Which sources contributed live data to this row. */
  sources:               AttentionSource[]
  narrative:             string
}

export interface AttentionBoard {
  views:                 AttentionView[]
  headline:              string
  dominant:              string | null
  surging:               string | null
  /** Sources that returned live data anywhere on the board. */
  active_sources:        AttentionSource[]
  available:             boolean
  reason?:               string
  generated_at:          string
}

// Tracked targets. X query uses X syntax; reddit query is plain boolean.
const TARGETS: Array<{ label: string; x: string; reddit: string }> = [
  { label: 'Bitcoin',  x: '(bitcoin OR $BTC) -is:retweet lang:en',                 reddit: 'bitcoin OR BTC' },
  { label: 'Ethereum', x: '(ethereum OR $ETH) -is:retweet lang:en',                reddit: 'ethereum OR ETH' },
  { label: 'Solana',   x: '(solana OR $SOL) -is:retweet lang:en',                  reddit: 'solana OR SOL' },
  { label: 'AI',       x: '($TAO OR $FET OR "AI agents" crypto) -is:retweet lang:en', reddit: '(AI agents OR $TAO OR $FET) crypto' },
  { label: 'Memes',    x: '(memecoin OR $WIF OR $PEPE OR $DOGE) -is:retweet lang:en', reddit: 'memecoin OR WIF OR PEPE OR DOGE' },
  { label: 'RWA',      x: '($ONDO OR "real world assets" crypto OR RWA token) -is:retweet lang:en', reddit: 'RWA OR real world assets crypto OR ONDO' },
]

interface WindowCounts { recent24: number; prior24: number }
type SourceResult =
  | { ok: true; counts: WindowCounts }
  | { ok: false; reason: string }

// ── Reddit source ────────────────────────────────────────────────────────

let redditToken: { value: string; exp: number } | null = null

function redditCreds(): { id: string; secret: string; ua: string } | null {
  const id = process.env.REDDIT_CLIENT_ID
  if (!id) return null
  // Installed (public) apps have no secret → empty string is valid; the
  // Basic-auth header becomes `id:` which Reddit accepts for public clients.
  const secret = process.env.REDDIT_CLIENT_SECRET ?? ''
  return { id, secret, ua: process.env.REDDIT_USER_AGENT || 'web:algosphere-attention:1.0 (by /u/algosphere)' }
}

/**
 * Resolves the OAuth body for whichever Reddit app type is configured:
 *   • script app    → password grant (needs REDDIT_USERNAME + REDDIT_PASSWORD)
 *   • installed app → installed_client grant (needs REDDIT_DEVICE_ID; app-only)
 *   • web app       → client_credentials (app-only)
 * Reddit script apps ONLY support the password grant — client_credentials
 * and installed_client both 403 on them.
 */
function redditGrantBody(): string {
  const user = process.env.REDDIT_USERNAME
  const pass = process.env.REDDIT_PASSWORD
  if (user && pass) {
    return `grant_type=password&username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`
  }
  const device = process.env.REDDIT_DEVICE_ID
  if (device) {
    return `grant_type=https://oauth.reddit.com/grants/installed_client&device_id=${encodeURIComponent(device)}`
  }
  return 'grant_type=client_credentials'
}

async function redditAccessToken(): Promise<string | null> {
  const c = redditCreds()
  if (!c) return null
  if (redditToken && redditToken.exp > Date.now() + 30_000) return redditToken.value
  try {
    const basic = Buffer.from(`${c.id}:${c.secret}`).toString('base64')
    const r = await fetch(REDDIT_TOKEN, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': c.ua,
      },
      body: redditGrantBody(),
      cache: 'no-store',
    })
    if (!r.ok) return null
    const j = (await r.json()) as { access_token?: string; expires_in?: number }
    if (!j.access_token) return null
    redditToken = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 }
    return redditToken.value
  } catch {
    return null
  }
}

const REDDIT_UA = () => process.env.REDDIT_USER_AGENT || 'web:algosphere-attention:1.0 (by /u/algosphere)'

/**
 * Reddit mention counts for a query. Two paths:
 *   • Authed (oauth.reddit.com) when an OAuth token is obtainable — only
 *     works for an 'installed app' (installed_client) or user-context creds.
 *     Higher rate limits.
 *   • Unauthenticated (www.reddit.com/search.json) otherwise — Reddit's
 *     public JSON, no app/credentials needed, just a descriptive UA. Works
 *     today with zero setup; lower rate limits (fine at 6 queries / 15-min
 *     cache). This is the default path so Attention runs out of the box.
 */
/** True only when a grant Reddit actually honours is configured. client_id +
 *  secret ALONE is not enough (script/web apps need user context; only an
 *  installed app's device_id, or username+password, yields an app/user token). */
function redditOAuthConfigured(): boolean {
  return Boolean((process.env.REDDIT_USERNAME && process.env.REDDIT_PASSWORD) || process.env.REDDIT_DEVICE_ID)
}

async function fetchReddit(query: string): Promise<SourceResult> {
  const ua = REDDIT_UA()
  // Only attempt OAuth when a viable grant is wired; otherwise go straight to
  // the public JSON endpoint (avoids a doomed 403 token call every request).
  const token = redditOAuthConfigured() ? await redditAccessToken() : null
  const qs = `q=${encodeURIComponent(query)}&sort=new&limit=100&t=week&type=link`
  try {
    const r = token
      ? await fetch(`${REDDIT_SEARCH}?${qs}`, {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua }, next: { revalidate: 900 },
        })
      : await fetch(`https://www.reddit.com/search.json?${qs}`, {
          headers: { 'User-Agent': ua }, next: { revalidate: 900 },
        })
    if (!r.ok) return { ok: false, reason: `Reddit ${r.status}` }
    const j = (await r.json()) as { data?: { children?: Array<{ data?: { created_utc?: number } }> } }
    const posts = j.data?.children ?? []
    const nowS = Date.now() / 1000
    let recent24 = 0, prior24 = 0
    for (const p of posts) {
      const t = p.data?.created_utc
      if (typeof t !== 'number') continue
      const ageH = (nowS - t) / 3600
      if (ageH <= 24) recent24 += 1
      else if (ageH <= 48) prior24 += 1
    }
    return { ok: true, counts: { recent24, prior24 } }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Reddit request failed' }
  }
}

// ── X source ─────────────────────────────────────────────────────────────

function xBearer(): string { return process.env.TWITTER_BEARER_TOKEN || '' }

async function fetchX(query: string): Promise<SourceResult> {
  if (!xBearer()) return { ok: false, reason: 'X not configured' }
  try {
    const url = `${X_COUNTS}?query=${encodeURIComponent(query)}&granularity=hour`
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${xBearer()}` },
      next: { revalidate: 900 },
    })
    if (!r.ok) {
      const reason = r.status === 402 ? 'X API credits depleted'
                   : r.status === 429 ? 'X API rate-limited'
                   : r.status === 401 ? 'X bearer rejected'
                   : `X API error ${r.status}`
      return { ok: false, reason }
    }
    const j = (await r.json()) as { data?: Array<{ end: string; tweet_count: number }> }
    const buckets = j.data ?? []
    const nowMs = Date.now()
    const win = (fromH: number, toH: number) => buckets
      .filter((b) => { const t = new Date(b.end).getTime(); return t > nowMs - fromH * 3.6e6 && t <= nowMs - toH * 3.6e6 })
      .reduce((s, b) => s + (b.tweet_count || 0), 0)
    return { ok: true, counts: { recent24: win(24, 0), prior24: win(48, 24) } }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'X request failed' }
  }
}

// ── Derivation ───────────────────────────────────────────────────────────

function stateOf(accelPct: number, mentions24h: number): AttentionState {
  if (mentions24h < 5) return 'Quiet'
  if (accelPct >= 60)  return 'Surging'
  if (accelPct >= 15)  return 'Rising'
  if (accelPct <= -25) return 'Cooling'
  return 'Steady'
}

function narrate(label: string, state: AttentionState, accelPct: number, sources: AttentionSource[]): string {
  const via = sources.length ? ` (${sources.join(' + ')})` : ''
  switch (state) {
    case 'Surging': return `${label} attention surging (+${Math.round(accelPct)}% vs prior day)${via} — narrative heating fast.`
    case 'Rising':  return `${label} attention rising (+${Math.round(accelPct)}%)${via} — building social interest.`
    case 'Steady':  return `${label} attention steady${via} — stable narrative presence.`
    case 'Cooling': return `${label} attention cooling (${Math.round(accelPct)}%)${via} — interest fading.`
    case 'Quiet':   return `${label} attention quiet${via} — limited social discussion.`
    case 'N/A':     return `${label} attention unavailable.`
  }
}

// ── Public composer ──────────────────────────────────────────────────────

export async function composeAttentionBoard(): Promise<AttentionBoard> {
  const generated_at = new Date().toISOString()
  // Reddit's public JSON needs no credentials, so it's always attempted
  // (degrades per-target if Reddit rate-limits/blocks the egress IP). X is
  // attempted only when a bearer token is present.
  const haveReddit = true
  const haveX = Boolean(xBearer())

  const perTarget = await Promise.all(TARGETS.map(async (t) => {
    const [redditRes, xRes] = await Promise.all([
      haveReddit ? fetchReddit(t.reddit) : Promise.resolve<SourceResult>({ ok: false, reason: 'Reddit not configured' }),
      haveX      ? fetchX(t.x)           : Promise.resolve<SourceResult>({ ok: false, reason: 'X not configured' }),
    ])
    const sources: AttentionSource[] = []
    let recent = 0, prior = 0
    if (redditRes.ok) { sources.push('reddit'); recent += redditRes.counts.recent24; prior += redditRes.counts.prior24 }
    if (xRes.ok)      { sources.push('x');      recent += xRes.counts.recent24;      prior += xRes.counts.prior24 }
    const firstErr = !redditRes.ok ? redditRes.reason : (!xRes.ok ? xRes.reason : '')
    return { label: t.label, sources, recent, prior, firstErr }
  }))

  const anyLive = perTarget.some((r) => r.sources.length > 0)
  if (!anyLive) {
    // Every source failed identically (credits/auth) — report honestly.
    const reason = perTarget[0]?.firstErr ?? 'Social sources unavailable'
    return emptyBoard(reason, generated_at)
  }

  const total = perTarget.reduce((s, r) => s + r.recent, 0) || 1
  const views: AttentionView[] = perTarget.map((r) => {
    const accel = r.prior > 0 ? ((r.recent - r.prior) / r.prior) * 100 : (r.recent > 0 ? 100 : 0)
    const state = r.sources.length ? stateOf(accel, r.recent) : 'N/A'
    return {
      label:                  r.label,
      mentions_24h:           r.recent,
      acceleration_pct:       Number(accel.toFixed(1)),
      state,
      share_of_attention_pct: Number(((r.recent / total) * 100).toFixed(1)),
      sources:                r.sources,
      narrative:              narrate(r.label, state, accel, r.sources),
    }
  }).sort((a, b) => b.mentions_24h - a.mentions_24h)

  const active = Array.from(new Set(perTarget.flatMap((r) => r.sources)))
  const dominant = views[0]?.label ?? null
  const surging  = views.find((v) => v.state === 'Surging')?.label ?? null
  return { views, headline: buildHeadline(views, dominant, surging, active), dominant, surging, active_sources: active, available: true, generated_at }
}

function buildHeadline(views: AttentionView[], dominant: string | null, surging: string | null, sources: AttentionSource[]): string {
  if (views.length === 0) return 'No attention data available.'
  const parts: string[] = []
  if (dominant) parts.push(`${dominant} leads social attention (${views[0]!.share_of_attention_pct.toFixed(0)}% share).`)
  if (surging && surging !== dominant) parts.push(`${surging} surging beneath it.`)
  const cooling = views.find((v) => v.state === 'Cooling')
  if (cooling) parts.push(`${cooling.label} cooling.`)
  parts.push(`Live via ${sources.join(' + ') || 'no source'}.`)
  return parts.join(' ')
}

function emptyBoard(reason: string, generated_at: string): AttentionBoard {
  return {
    views: [], headline: `Attention intelligence unavailable: ${reason}`,
    dominant: null, surging: null, active_sources: [], available: false, reason, generated_at,
  }
}
