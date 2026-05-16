import { NextResponse } from 'next/server'

/**
 * Trading news feed — pulls public RSS sources, caches 15 min.
 * Graceful empty-array fallback on fetch failure.
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

export async function GET() {
  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json({ items: cache.data, cached: true })
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
    const items = results
      .flat()
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      .slice(0, 40)

    cache = { at: Date.now(), data: items }
    return NextResponse.json({ items, cached: false })
  } catch (err) {
    console.error('news fetch error:', err)
    return NextResponse.json({
      items: cache?.data ?? [],
      cached: !!cache,
      degraded: true,
    })
  }
}
