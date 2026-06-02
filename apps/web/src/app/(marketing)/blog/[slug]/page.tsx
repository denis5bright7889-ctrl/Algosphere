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

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await fetchPost(slug)
  if (!post) return { title: 'Not found' }
  return {
    title:       `${post.title} — AlgoSphere`,
    description: post.summary ?? undefined,
    openGraph: {
      title:        post.title,
      description:  post.summary ?? undefined,
      type:         'article',
      publishedTime: post.published_at ?? undefined,
      images:       post.hero_image_url ? [post.hero_image_url] : undefined,
    },
  }
}

export default async function BlogPostPage({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await fetchPost(slug)
  if (!post) notFound()

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
    </div>
  )
}
