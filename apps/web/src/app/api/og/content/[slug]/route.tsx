/**
 * /api/og/content/[slug] — branded OG card for a published blog post.
 *
 * Reads growth_content_items by slug (RLS allows anon SELECT on
 * status='published'). Renders the post title, kind, and a brand
 * footer. Used by /blog/[slug]'s OpenGraph metadata so X / LinkedIn /
 * Discord previews look intentional instead of "no image found".
 *
 * Edge runtime; 5-min ISR matches /blog/[slug].
 */
import { ImageResponse } from 'next/og'
import { createClient } from '@supabase/supabase-js'

export const runtime    = 'edge'
export const revalidate = 300

const KIND_LABEL: Record<string, string> = {
  strategy_of_the_week: 'Strategy',
  backtest_breakdown:   'Backtest',
  market_report:        'Market Report',
  product_update:       'Product Update',
  psychology_insight:   'Psychology',
  educational:          'Education',
  announcement:         'Announcement',
}

interface PostRow {
  slug:         string
  kind:         string
  title:        string
  summary:      string | null
  is_synthetic: boolean
  published_at: string | null
  tags:         string[]
}

async function fetchPost(slug: string): Promise<PostRow | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  const db = createClient(url, key)
  const { data } = await db
    .from('growth_content_items')
    .select('slug, kind, title, summary, is_synthetic, published_at, tags')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  return data as PostRow | null
}

export async function GET(
  _req: Request,
  ctx:  { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  const post = await fetchPost(slug)

  const kindLabel = post ? (KIND_LABEL[post.kind] ?? post.kind) : 'AlgoSphere'
  const title     = post?.title   ?? 'AlgoSphere Quant'
  const summary   = post?.summary ?? 'AI Trader Intelligence Operating System'
  const date      = post?.published_at
    ? new Date(post.published_at).toUTCString().replace('GMT', 'UTC')
    : ''

  return new ImageResponse(
    (
      <div style={{
        display:        'flex',
        width:          '100%',
        height:         '100%',
        background:     '#000',
        padding:        '64px 72px',
        fontFamily:     'system-ui, -apple-system, sans-serif',
        color:          '#fafafa',
        flexDirection:  'column',
        justifyContent: 'space-between',
      }}>
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 24, color: '#000',
          }}>A</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>AlgoSphere Quant</div>
            <div style={{ fontSize: 13, color: '#a1a1aa', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              {kindLabel}
            </div>
          </div>
          {post?.is_synthetic && (
            <div style={{
              marginLeft: 'auto', padding: '8px 14px', borderRadius: 999,
              border: '1px solid #f59e0b66', background: '#f59e0b1a',
              fontSize: 13, fontWeight: 700, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#fbbf24',
            }}>
              Backtest
            </div>
          )}
        </div>

        {/* Title + summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1000 }}>
          <div style={{
            fontSize: 60, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.01em',
          }}>
            {clamp(title, 110)}
          </div>
          {summary && (
            <div style={{ fontSize: 24, lineHeight: 1.35, color: '#d4d4d8' }}>
              {clamp(summary, 220)}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          paddingTop: 18, borderTop: '1px solid #27272a',
          fontSize: 16,
        }}>
          <span style={{ color: '#fbbf24', fontWeight: 700 }}>algospherequant.com</span>
          {date && <span style={{ color: '#71717a' }}>· {date}</span>}
          <span style={{ marginLeft: 'auto', color: '#71717a', fontSize: 12 }}>
            Past performance is not indicative of future results.
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
