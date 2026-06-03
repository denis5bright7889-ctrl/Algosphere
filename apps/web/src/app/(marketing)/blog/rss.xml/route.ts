/**
 * /blog/rss.xml — RSS 2.0 feed of published blog posts.
 *
 * Reads the same source as /blog (growth_content_items, anon RLS), so the
 * feed and the site never drift. Cached for 10 min at the edge. Linked from
 * the blog index <head> via the `alternate` metadata there.
 */
import { createClient } from '@supabase/supabase-js'

export const revalidate = 600

const SITE = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://algospherequant.com').replace(/\/$/, '')

interface FeedRow {
  slug:         string
  title:        string
  summary:      string | null
  kind:         string
  published_at: string | null
}

// Minimal XML escaping for element text / attribute values.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const KIND_CATEGORY: Record<string, string> = {
  strategy_of_the_week: 'Strategy',
  backtest_breakdown:   'Backtest',
  market_report:        'Market Report',
  product_update:       'Product Update',
  psychology_insight:   'Psychology',
  educational:          'Education',
  announcement:         'Announcement',
}

export async function GET(): Promise<Response> {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  let rows: FeedRow[] = []
  if (url && anon) {
    const { data } = await createClient(url, anon)
      .from('growth_content_items')
      .select('slug, title, summary, kind, published_at')
      .eq('status', 'published')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(50)
    rows = (data ?? []) as FeedRow[]
  }

  const lastBuild = rows[0]?.published_at ?? new Date().toISOString()
  const items = rows.map((r) => {
    const link = `${SITE}/blog/${r.slug}`
    const date = r.published_at ? new Date(r.published_at).toUTCString() : new Date().toUTCString()
    const cat  = KIND_CATEGORY[r.kind] ?? r.kind
    return [
      '    <item>',
      `      <title>${esc(r.title)}</title>`,
      `      <link>${esc(link)}</link>`,
      `      <guid isPermaLink="true">${esc(link)}</guid>`,
      `      <category>${esc(cat)}</category>`,
      `      <pubDate>${date}</pubDate>`,
      r.summary ? `      <description><![CDATA[${r.summary}]]></description>` : '',
      '    </item>',
    ].filter(Boolean).join('\n')
  }).join('\n')

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>AlgoSphere Quant — Blog</title>',
    `    <link>${SITE}/blog</link>`,
    `    <atom:link href="${SITE}/blog/rss.xml" rel="self" type="application/rss+xml" />`,
    '    <description>AI trading research, strategy breakdowns, market reports, and platform updates.</description>',
    '    <language>en</language>',
    `    <lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>`,
    items,
    '  </channel>',
    '</rss>',
  ].filter(Boolean).join('\n')

  return new Response(xml, {
    headers: {
      'content-type':  'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=600, s-maxage=600',
    },
  })
}
