/**
 * Dynamic sitemap. Lists every public marketing route + every
 * published blog slug. Updated on each request (force-dynamic) so
 * new blog posts appear immediately.
 */
import { createClient } from '@supabase/supabase-js'
import type { MetadataRoute } from 'next'

export const dynamic = 'force-dynamic'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://algospherequant.com'

// Public marketing routes worth indexing. Keep curated — dashboard /
// admin / api routes are excluded by design.
const STATIC_ROUTES: { path: string; changefreq: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }[] = [
  { path: '/',              changefreq: 'weekly',  priority: 1.0 },
  { path: '/blog',          changefreq: 'daily',   priority: 0.9 },
  { path: '/upgrade',       changefreq: 'weekly',  priority: 0.8 },
  { path: '/communities',   changefreq: 'weekly',  priority: 0.6 },
  { path: '/terms',         changefreq: 'yearly',  priority: 0.3 },
  { path: '/privacy',       changefreq: 'yearly',  priority: 0.3 },
  { path: '/data-deletion', changefreq: 'yearly',  priority: 0.3 },
  { path: '/login',         changefreq: 'monthly', priority: 0.5 },
  { path: '/signup',        changefreq: 'monthly', priority: 0.7 },
]

interface BlogSlugRow { slug: string; updated_at: string | null }

async function fetchBlogSlugs(): Promise<BlogSlugRow[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return []
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
  const { data } = await db
    .from('growth_content_items')
    .select('slug, updated_at')
    .eq('status', 'published')
    .not('slug', 'is', null)
    .order('published_at', { ascending: false })
    .limit(1000)
  return (data ?? []) as BlogSlugRow[]
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const slugs = await fetchBlogSlugs()

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url:            `${SITE}${r.path}`,
    lastModified:   now,
    changeFrequency: r.changefreq,
    priority:       r.priority,
  }))

  const blogEntries: MetadataRoute.Sitemap = slugs.map((s) => ({
    url:            `${SITE}/blog/${s.slug}`,
    lastModified:   s.updated_at ? new Date(s.updated_at) : now,
    changeFrequency: 'monthly',
    priority:       0.7,
  }))

  return [...staticEntries, ...blogEntries]
}
