/**
 * Discovery scanner — finds public posts on Reddit that match the
 * AlgoSphere topic set, scores them, and persists to
 * growth_discovery_items for admin review.
 *
 * Reddit JSON is the MVP source — no auth, no rate-limit token, just
 * a user-agent header. Subreddits + queries are curated so the queue
 * stays trading-relevant.
 *
 * Compliance: this module ONLY ingests + ranks. Reply posting is
 * manual — the admin opens the original Reddit thread and posts from
 * the AlgoSphere brand account (no impersonation, no automation
 * against Reddit's ToS).
 */
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'

interface RedditPost {
  data: {
    id:           string
    name:         string             // 't3_<id>' fullname
    title:        string
    selftext?:    string
    permalink:    string
    url?:         string
    author?:      string
    created_utc?: number
    over_18?:     boolean
    subreddit?:   string
  }
}

interface RedditListing {
  data?: { children?: RedditPost[] }
}

interface DiscoveryRow {
  source:      'reddit'
  external_id: string
  url:         string
  title:       string
  snippet:     string | null
  author:      string | null
  posted_at:   string | null
  topic_tags:  string[]
  relevance:   number
}

// Curated subreddit + query list. Keep tight — the queue's signal-to-
// noise ratio depends on these. Add via PR, never via runtime config.
const REDDIT_QUERIES: Array<{
  subreddit: string
  query?:    string               // when set, use search.json; else hot.json
  tags:      string[]
}> = [
  { subreddit: 'algotrading',  query: 'backtest OR mt5 OR strategy', tags: ['algo', 'backtest'] },
  { subreddit: 'algotrading',  query: 'walk forward OR overfit',      tags: ['algo', 'overfit'] },
  { subreddit: 'Forex',        query: 'risk management OR psychology', tags: ['forex', 'risk'] },
  { subreddit: 'Forex',        query: 'journal OR drawdown',           tags: ['forex', 'journal'] },
  { subreddit: 'Daytrading',   query: 'trading psychology OR revenge', tags: ['psychology'] },
  { subreddit: 'TradingView',  query: 'indicator OR strategy',         tags: ['indicators'] },
  { subreddit: 'CryptoCurrency', query: 'algo trading OR bot',         tags: ['crypto', 'algo'] },
  { subreddit: 'options',      query: 'risk OR position sizing',       tags: ['risk', 'options'] },
]

// Keyword → score weights for relevance scoring.
const RELEVANCE_KEYWORDS: Array<{ rx: RegExp; weight: number }> = [
  { rx: /\bbacktest(ing|ed)?\b/i,     weight: 20 },
  { rx: /\bmt[45]\b|metatrader/i,     weight: 18 },
  { rx: /\b(quant|algo|automat)/i,    weight: 14 },
  { rx: /\bstrateg(y|ies)\b/i,        weight: 12 },
  { rx: /\b(journal|psychology|tilt|revenge)\b/i, weight: 12 },
  { rx: /\b(risk management|position siz|drawdown)\b/i, weight: 10 },
  { rx: /\b(walk[\s-]?forward|overfit|monte carlo)\b/i, weight: 18 },
  { rx: /\b(broker|tradingview|fxcm|oanda|binance|bybit|okx)\b/i, weight: 8 },
  { rx: /\b(profit factor|win rate|sharpe|sortino)\b/i, weight: 10 },
  // Negative — drop scammy/promotional posts.
  { rx: /\b(signal service|copy trade|telegram group|join my)\b/i, weight: -25 },
  { rx: /\b(\$\d{4,}|guaranteed|secret)\b/i,                       weight: -15 },
]

function score(post: RedditPost['data']): number {
  const text = `${post.title}\n${post.selftext ?? ''}`
  let s = 0
  for (const { rx, weight } of RELEVANCE_KEYWORDS) {
    if (rx.test(text)) s += weight
  }
  // Length bonus — substantial posts beat one-line questions.
  const len = (post.selftext ?? '').length
  if (len > 400) s += 5
  if (len > 1500) s += 5
  // Clamp.
  return Math.max(0, Math.min(100, s))
}

async function fetchSubreddit(
  subreddit: string,
  query: string | undefined,
): Promise<RedditPost[]> {
  const ua  = 'AlgoSphereDiscoveryBot/1.0 (+https://algospherequant.com)'
  const url = query
    ? `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=25`
    : `https://www.reddit.com/r/${subreddit}/hot.json?limit=25`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': ua, 'Accept': 'application/json' },
      cache:   'no-store',
    })
    if (!res.ok) return []
    const json = (await res.json()) as RedditListing
    return json.data?.children ?? []
  } catch {
    return []
  }
}

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface DiscoveryRunSummary {
  fetched:  number
  inserted: number
  skipped:  number
  byTopic:  Record<string, number>
}

/**
 * Run one full scan across all configured queries. Idempotent —
 * dedup is via UNIQUE (source, external_id), so re-running the same
 * day adds zero rows.
 */
export async function runDiscoveryScan(): Promise<DiscoveryRunSummary> {
  const db = svc()
  const summary: DiscoveryRunSummary = {
    fetched: 0, inserted: 0, skipped: 0, byTopic: {},
  }

  const seen = new Set<string>()
  const rows: DiscoveryRow[] = []

  for (const q of REDDIT_QUERIES) {
    const posts = await fetchSubreddit(q.subreddit, q.query)
    summary.fetched += posts.length

    for (const p of posts) {
      const d = p.data
      if (!d?.id || !d.title) continue
      if (d.over_18) continue
      const fullname = d.name ?? `t3_${d.id}`
      if (seen.has(fullname)) continue
      seen.add(fullname)

      const relevance = score(d)
      // Drop low-signal posts — keeps the queue useful instead of huge.
      if (relevance < 18) { summary.skipped += 1; continue }

      const permalink = d.permalink
        ? `https://www.reddit.com${d.permalink}`
        : (d.url ?? '')

      const postedAt = d.created_utc
        ? new Date(d.created_utc * 1000).toISOString()
        : null

      const snippet = (d.selftext ?? '').replace(/\s+/g, ' ').trim().slice(0, 600)

      rows.push({
        source:      'reddit',
        external_id: fullname,
        url:         permalink,
        title:       d.title.slice(0, 500),
        snippet:     snippet || null,
        author:      d.author ?? null,
        posted_at:   postedAt,
        topic_tags:  q.tags,
        relevance,
      })

      for (const t of q.tags) summary.byTopic[t] = (summary.byTopic[t] ?? 0) + 1
    }
  }

  if (rows.length === 0) return summary

  // Bulk upsert. ON CONFLICT (source, external_id) DO NOTHING via the
  // unique index — re-runs are idempotent. We don't update existing
  // rows; admin notes / status changes survive subsequent scans.
  const { error } = await db
    .from('growth_discovery_items')
    .upsert(rows, { onConflict: 'source,external_id', ignoreDuplicates: true })

  if (error) {
    return summary
  }
  summary.inserted = rows.length
  return summary
}
