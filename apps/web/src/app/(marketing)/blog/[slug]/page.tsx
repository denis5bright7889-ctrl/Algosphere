/**
 * /blog/[slug] — single blog post.
 *
 * Reads ONE growth_content_items row by slug, public (anon) RLS.
 * Renders markdown body inline; the disclaimer + provenance footer
 * are always visible so compliance reads as part of the article.
 */
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'

export const revalidate = 300  // 5 min ISR

interface BlogPost {
  id:             string
  slug:           string
  kind:           string
  title:          string
  summary:        string | null
  body_md:        string
  is_synthetic:   boolean
  disclaimer:     string | null
  cta_text:       string | null
  cta_url:        string | null
  hero_image_url: string | null
  tags:           string[]
  provenance:     Record<string, unknown>
  published_at:   string | null
}

function publicDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

async function fetchPost(slug: string): Promise<BlogPost | null> {
  const { data } = await publicDb()
    .from('growth_content_items')
    .select('id, slug, kind, title, summary, body_md, is_synthetic, disclaimer, cta_text, cta_url, hero_image_url, tags, provenance, published_at')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  return data as BlogPost | null
}

interface RelatedRow { slug: string; title: string; kind: string; published_at: string | null }

/** Up to 3 other published posts — same `kind` first, newest. The current
 *  post is excluded by id. Empty result is fine (renders nothing). */
async function fetchRelated(kind: string, excludeId: string): Promise<RelatedRow[]> {
  const db = publicDb()
  const same = await db
    .from('growth_content_items')
    .select('slug, title, kind, published_at')
    .eq('status', 'published').not('slug', 'is', null)
    .eq('kind', kind).neq('id', excludeId)
    .order('published_at', { ascending: false }).limit(3)
  let rows = (same.data ?? []) as RelatedRow[]
  if (rows.length < 3) {
    // Backfill with the newest posts of any kind so the rail is never thin.
    const more = await db
      .from('growth_content_items')
      .select('slug, title, kind, published_at')
      .eq('status', 'published').not('slug', 'is', null)
      .neq('id', excludeId)
      .order('published_at', { ascending: false }).limit(6)
    const seen = new Set(rows.map((r) => r.slug))
    for (const r of (more.data ?? []) as RelatedRow[]) {
      if (rows.length >= 3) break
      if (!seen.has(r.slug)) { rows.push(r); seen.add(r.slug) }
    }
  }
  return rows
}

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await fetchPost(slug)
  if (!post) return { title: 'Not found' }
  // Fall back to the branded OG card endpoint when the content_item
  // doesn't carry an explicit hero_image_url. Generates a 1200×630
  // PNG with title + summary + brand row — better than no preview.
  const site = process.env.NEXT_PUBLIC_APP_URL ?? 'https://algospherequant.com'
  const ogImage = post.hero_image_url ?? `${site}/api/og/content/${encodeURIComponent(slug)}`
  return {
    title:       `${post.title} — AlgoSphere`,
    description: post.summary ?? undefined,
    openGraph: {
      title:        post.title,
      description:  post.summary ?? undefined,
      type:         'article',
      publishedTime: post.published_at ?? undefined,
      images:       [ogImage],
    },
    twitter: {
      card:        'summary_large_image',
      title:       post.title,
      description: post.summary ?? undefined,
      images:      [ogImage],
    },
  }
}

export default async function BlogPostPage({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await fetchPost(slug)
  if (!post) notFound()

  const related = await fetchRelated(post.kind, post.id)

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <header className="mb-6">
        <Link href="/blog" className="text-[12px] font-semibold text-amber-300 hover:underline">
          ← All posts
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{post.title}</h1>
        {post.summary && (
          <p className="mt-3 text-base text-muted-foreground">{post.summary}</p>
        )}
        <p className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          {post.published_at && (
            <span>
              {new Date(post.published_at).toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </span>
          )}
          {post.is_synthetic && (
            <>
              <span>·</span>
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Backtest
              </span>
            </>
          )}
        </p>
      </header>

      <article className="prose prose-invert prose-sm sm:prose-base max-w-none whitespace-pre-wrap text-foreground/90">
        {post.body_md}
      </article>

      {(post.cta_text || post.disclaimer) && (
        <footer className="mt-10 space-y-4 border-t border-border pt-6">
          {post.cta_text && post.cta_url && (
            <a
              href={post.cta_url}
              className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400"
            >
              {post.cta_text} →
            </a>
          )}
          {post.disclaimer && (
            <p className="text-[11px] italic text-muted-foreground">{post.disclaimer}</p>
          )}
        </footer>
      )}

      {post.tags.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-2">
          {post.tags.map((t) => (
            <Link
              key={t}
              href={`/blog?tag=${encodeURIComponent(t)}`}
              className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-300"
            >
              #{t}
            </Link>
          ))}
        </div>
      )}

      {related.length > 0 && (
        <section className="mt-12 border-t border-border pt-8">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Related posts</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {related.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/blog/${r.slug}`}
                  className="group block h-full rounded-xl border border-border bg-card p-4 transition-colors hover:border-amber-500/40"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">{KIND_LABEL[r.kind] ?? r.kind}</span>
                  <p className="mt-1.5 text-[13px] font-semibold leading-snug group-hover:text-amber-200">{r.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  strategy_of_the_week: 'Strategy',
  backtest_breakdown:   'Backtest',
  market_report:        'Market Report',
  product_update:       'Product Update',
  psychology_insight:   'Psychology',
  educational:          'Education',
  announcement:         'Announcement',
}
