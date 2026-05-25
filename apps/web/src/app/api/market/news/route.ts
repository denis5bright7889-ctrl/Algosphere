import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Trading news feed — merges two sources:
 *   • public RSS feeds (cached 15 min), and
 *   • stored news_items rows fed by the engine's inbound webhook consumer
 *     (Finnhub etc.) — read fresh on every request so pushed news surfaces
 *     immediately and survives an RSS outage.
 * Graceful empty-array fallback on failure.
 */

interface NewsItem {
  title:        string
  url:          string
  source:       string
  category:     'crypto' | 'forex' | 'macro' | 'equities'
  impact:       'high' | 'medium' | 'low'
  published_at: string
}

const SOURCES: { name: string; url: string; category: NewsItem['category'] }[] = [
  { name: 'Investing.com', url: 'https://www.investing.com/rss/news_25.rss', category: 'forex' },
  { name: 'CoinDesk',      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'crypto' },
  { name: 'Reuters Biz',   url: 'https://feeds.reuters.com/reuters/businessNews', category: 'macro' },
]

let cache: { at: number; data: NewsItem[] } | null = null
const TTL = 15 * 60 * 1000

// Minimal RSS parser — XML → items
function parseRSS(xml: string, source: string, category: NewsItem['category']): NewsItem[] {
  const items: NewsItem[] = []
  const itemRe = /<item\b[\s\S]*?<\/item>/gi
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))
    if (!m) return ''
    return m[1]!.replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1').trim()
  }
  for (const block of xml.match(itemRe) ?? []) {
    const title = tag(block, 'title')
    const link  = tag(block, 'link')
    const pub   = tag(block, 'pubDate')
    if (!title || !link) continue
    const date = pub ? new Date(pub).toISOString() : new Date().toISOString()
    items.push({
      title:    title.slice(0, 200),
      url:      link,
      source,
      category,
      impact:   /breaking|crash|surge|fed|cpi|nfp|rate/i.test(title) ? 'high' : 'medium',
      published_at: date,
    })
    if (items.length >= 15) break
  }
  return items
}

const CAT = new Set(['crypto', 'forex', 'macro', 'equities'])
const IMP = new Set(['high', 'medium', 'low'])

/** Webhook-fed news from news_items (service-role read; RLS service-only). */
async function fetchStoredNews(): Promise<NewsItem[]> {
  try {
    const svc = createServiceClient()
    const { data } = await svc
      .from('news_items')
      .select('title, url, source, category, impact, published_at')
      .order('published_at', { ascending: false })
      .limit(40)
    return ((data ?? []) as unknown as Array<{
      title: string; url: string; source: string
      category: string | null; impact: string | null; published_at: string
    }>).map(r => ({
      title:        String(r.title).slice(0, 200),
      url:          r.url,
      source:       r.source,
      category:     (CAT.has(r.category ?? '') ? r.category : 'equities') as NewsItem['category'],
      impact:       (IMP.has(r.impact ?? '') ? r.impact : 'medium') as NewsItem['impact'],
      published_at: r.published_at,
    }))
  } catch { return [] }
}

/** Merge sources, dedup by url, newest first, cap 40. */
function mergeNews(...lists: NewsItem[][]): NewsItem[] {
  const seen = new Set<string>()
  const out: NewsItem[] = []
  for (const item of lists.flat()) {
    if (!item.url || seen.has(item.url)) continue
    seen.add(item.url)
    out.push(item)
  }
  return out
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, 40)
}

export async function GET() {
  const stored = await fetchStoredNews()  // always fresh (webhook-fed)

  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json({ items: mergeNews(stored, cache.data), cached: true })
  }

  try {
    const results = await Promise.all(SOURCES.map(async s => {
      try {
        const res = await fetch(s.url, {
          headers: { 'User-Agent': 'AlgoSphereQuant/1.0' },
          signal: AbortSignal.timeout(6000),
          next: { revalidate: 900 },
        })
        if (!res.ok) return [] as NewsItem[]
        return parseRSS(await res.text(), s.name, s.category)
      } catch { return [] }
    }))
    const rss = results
      .flat()
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      .slice(0, 40)

    cache = { at: Date.now(), data: rss }
    return NextResponse.json({ items: mergeNews(stored, rss), cached: false })
  } catch (err) {
    console.error('news fetch error:', err)
    return NextResponse.json({
      items: mergeNews(stored, cache?.data ?? []),
      cached: !!cache,
      degraded: true,
    })
  }
}
