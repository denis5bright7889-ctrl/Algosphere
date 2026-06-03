/**
 * /blog — public blog index.
 *
 * Reads from growth_content_items WHERE status='published' AND
 * slug IS NOT NULL. The RLS policy on growth_content_items already
 * allows anon reads of published rows, so no service-role client
 * needed.
 *
 * SEO: marketing-route group, fully crawlable, returns plain HTML.
 * Each item is a card linking to /blog/[slug].
 */
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'

const OG_FOR_INDEX = '/api/og/card?label=AlgoSphere%20Blog'
  + '&title=' + encodeURIComponent('Research, strategy and market intelligence')
  + '&subtitle=' + encodeURIComponent('Backtests on real OHLCV. Deterministic strategy grades. AI-driven trader analytics.')

export const metadata = {
  title:       'Blog — AlgoSphere Quant',
  description: 'AI trading research, strategy breakdowns, market reports, and educational content from the AlgoSphere team.',
  openGraph:   {
    title:       'AlgoSphere Blog',
    description: 'AI trading research, strategy breakdowns, market reports.',
    type:        'website',
    images:      [OG_FOR_INDEX],
  },
  twitter: {
    card:        'summary_large_image',
    title:       'AlgoSphere Blog',
    description: 'AI trading research, strategy breakdowns, market reports.',
    images:      [OG_FOR_INDEX],
  },
  alternates: {
    types: { 'application/rss+xml': '/blog/rss.xml' },
  },
}
export const revalidate = 300  // 5 min ISR — blog list refreshes every 5 minutes

const KIND_LABEL: Record<string, string> = {
  strategy_of_the_week: 'Strategy',
  backtest_breakdown:   'Backtest',
  market_report:        'Market Report',
  product_update:       'Product Update',
  psychology_insight:   'Psychology',
  educational:          'Education',
  announcement:         'Announcement',
}

interface BlogRow {
  id:            string
  slug:          string
  kind:          string
  title:         string
  summary:       string | null
  is_synthetic:  boolean
  published_at:  string | null
  tags:          string[]
  hero_image_url: string | null
}

function publicDb() {
  // anon key — the published row is world-readable via RLS.
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

export default async function BlogIndex({
  searchParams,
}: { searchParams: Promise<{ tag?: string; kind?: string; q?: string }> }) {
  const sp = await searchParams
  const tag  = sp.tag?.trim() || null
  const kind = sp.kind?.trim() || null
  // Sanitize free-text search — strip the chars PostgREST's `.or()` parses as
  // operators/delimiters so a query can't break the filter or inject one.
  const q = (sp.q ?? '').replace(/[,%()*]/g, ' ').trim() || null

  let query = publicDb()
    .from('growth_content_items')
    .select('id, slug, kind, title, summary, is_synthetic, published_at, tags, hero_image_url')
    .eq('status', 'published')
    .not('slug', 'is', null)
  if (kind) query = query.eq('kind', kind)
  if (tag)  query = query.contains('tags', [tag])
  if (q)    query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%`)

  const { data } = await query.order('published_at', { ascending: false }).limit(50)
  const posts = (data ?? []) as BlogRow[]

  const activeFilter = tag ? `#${tag}` : kind ? (KIND_LABEL[kind] ?? kind) : q ? `“${q}”` : null

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
      <header className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">AlgoSphere</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Research, strategy and market intelligence</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Backtests on real OHLCV, deterministic strategy grades, AI-driven trader analytics, and the platform updates behind them. Every numeric claim links back to its source data.
        </p>
      </header>

      {/* Search + category filters */}
      <div className="mb-8 space-y-3">
        <form action="/blog" method="get" className="flex gap-2">
          <input
            type="search" name="q" defaultValue={q ?? ''} placeholder="Search posts…"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-amber-500/40 focus:outline-none"
          />
          <button type="submit" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-500/15">
            Search
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Link href="/blog" className={`rounded-full border px-2.5 py-0.5 font-semibold ${!activeFilter ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-border text-muted-foreground hover:text-amber-300'}`}>All</Link>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <Link
              key={k}
              href={`/blog?kind=${k}`}
              className={`rounded-full border px-2.5 py-0.5 font-medium ${kind === k ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-border text-muted-foreground hover:text-amber-300'}`}
            >
              {label}
            </Link>
          ))}
          <a href="/blog/rss.xml" className="ml-auto rounded-full border border-border px-2.5 py-0.5 font-medium text-muted-foreground hover:text-amber-300">RSS</a>
        </div>
        {activeFilter && (
          <p className="text-[12px] text-muted-foreground">
            {posts.length} result{posts.length === 1 ? '' : 's'} for <span className="font-semibold text-foreground/85">{activeFilter}</span> · <Link href="/blog" className="text-amber-300 hover:underline">clear</Link>
          </p>
        )}
      </div>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-20 text-center text-sm text-muted-foreground">
          New posts land here every week. Subscribe below to get them in your inbox.
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2">
          {posts.map((p) => (
            <li key={p.id}>
              <Link
                href={`/blog/${p.slug}`}
                className="group block h-full rounded-2xl border border-border bg-card p-5 transition-colors hover:border-amber-500/40 hover:bg-card/80"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    {KIND_LABEL[p.kind] ?? p.kind}
                  </span>
                  {p.is_synthetic && (
                    <span className="rounded-full border border-zinc-500/40 bg-zinc-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                      Backtest
                    </span>
                  )}
                </div>
                <h2 className="mt-3 text-lg font-bold leading-snug tracking-tight group-hover:text-amber-200">
                  {p.title}
                </h2>
                {p.summary && (
                  <p className="mt-2 line-clamp-3 text-[13px] text-muted-foreground">{p.summary}</p>
                )}
                <p className="mt-3 text-[11px] tabular-nums text-muted-foreground">
                  {p.published_at ? new Date(p.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
