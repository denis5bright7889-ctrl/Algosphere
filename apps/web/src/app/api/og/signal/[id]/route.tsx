/**
 * /api/og/signal/[id] — branded signal card.
 *
 * Renders a 1200×630 PNG/SVG via @vercel/og (built into next/og — no
 * dep install). Reads the signal row from Supabase (public.signals RLS
 * allows anon SELECT on rows where tier_required = 'free' or tier
 * matches; the card uses anon key + RLS — no service role here).
 *
 * Used by:
 *   - Growth Engine generators (hero_image_url for strategy_of_the_week
 *     content_items)
 *   - Social channel formatters (X, LinkedIn, FB attach this URL)
 *   - The /signals page can preview branded cards inline
 *
 * Edge runtime for fast cold start.
 */
import { ImageResponse } from 'next/og'
import { createClient } from '@supabase/supabase-js'

export const runtime    = 'edge'
export const revalidate = 300            // 5-minute ISR

interface SignalRow {
  id:               string
  pair:             string
  direction:        string
  entry_price:      number | null
  stop_loss:        number | null
  take_profit_1:    number | null
  risk_reward:      number | null
  confidence_score: number | null
  regime:           string | null
  tier_required:    string | null
  published_at:     string | null
}

async function fetchSignal(id: string): Promise<SignalRow | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  const db = createClient(url, key)
  const { data } = await db
    .from('signals')
    .select('id, pair, direction, entry_price, stop_loss, take_profit_1, risk_reward, confidence_score, regime, tier_required, published_at')
    .eq('id', id)
    .maybeSingle()
  return data as SignalRow | null
}

export async function GET(
  _req: Request,
  ctx:  { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const s = await fetchSignal(id)

  const symbol     = s?.pair ?? 'Signal'
  const isBuy      = (s?.direction ?? '').toLowerCase() === 'buy'
  const accent     = isBuy ? '#10B981' : '#EF4444'
  const arrow      = isBuy ? '↑ BUY' : '↓ SELL'
  const entry      = fmt(s?.entry_price)
  const sl         = fmt(s?.stop_loss)
  const tp         = fmt(s?.take_profit_1)
  const rr         = s?.risk_reward != null ? `1:${s.risk_reward.toFixed(1)}` : '—'
  const conf       = s?.confidence_score != null ? `${s.confidence_score}/100` : '—'
  const regime     = s?.regime ?? '—'

  return new ImageResponse(
    (
      <div
        style={{
          display:        'flex',
          width:          '100%',
          height:         '100%',
          background:     '#000',
          padding:        '56px',
          fontFamily:     'system-ui, -apple-system, sans-serif',
          color:          '#fafafa',
          flexDirection:  'column',
          justifyContent: 'space-between',
        }}
      >
        {/* Top — brand row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 22, color: '#000',
          }}>A</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.04em' }}>AlgoSphere Quant</div>
            <div style={{ fontSize: 13, color: '#a1a1aa', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              AI Signal
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 13, color: '#a1a1aa' }}>algospherequant.com</div>
            <div style={{ fontSize: 11, color: '#71717a' }}>
              {s?.published_at ? new Date(s.published_at).toUTCString().replace('GMT', 'UTC') : ''}
            </div>
          </div>
        </div>

        {/* Middle — symbol + direction */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <div style={{ fontSize: 88, fontWeight: 800, letterSpacing: '-0.02em' }}>{symbol}</div>
            <div style={{
              padding: '12px 24px', borderRadius: 18,
              background: accent + '22', border: `2px solid ${accent}`,
              color: accent, fontSize: 36, fontWeight: 800,
              letterSpacing: '0.06em',
            }}>{arrow}</div>
          </div>
          <div style={{ display: 'flex', gap: 36, marginTop: 14 }}>
            <Stat label="ENTRY"  value={entry} />
            <Stat label="SL"     value={sl}    tone="rose" />
            <Stat label="TP1"    value={tp}    tone="emerald" />
            <Stat label="R:R"    value={rr} />
          </div>
        </div>

        {/* Bottom — meta strip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 18,
          paddingTop: 16, borderTop: '1px solid #27272a',
          fontSize: 16,
        }}>
          <span style={{ color: '#fbbf24', fontWeight: 700 }}>Confidence</span>
          <span style={{ color: '#e4e4e7' }}>{conf}</span>
          <span style={{ color: '#3f3f46' }}>·</span>
          <span style={{ color: '#fbbf24', fontWeight: 700 }}>Regime</span>
          <span style={{ color: '#e4e4e7', textTransform: 'capitalize' }}>{regime}</span>
          <span style={{ marginLeft: 'auto', color: '#71717a', fontSize: 12 }}>
            Trading involves risk · Not financial advice
          </span>
        </div>
      </div>
    ),
    {
      width:  1200,
      height: 630,
    },
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'emerald' }) {
  const valueColor = tone === 'rose' ? '#fda4af' : tone === 'emerald' ? '#6ee7b7' : '#fafafa'
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 12, color: '#a1a1aa', letterSpacing: '0.16em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: valueColor }}>
        {value}
      </div>
    </div>
  )
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 100)  return n.toFixed(2)
  if (Math.abs(n) >= 1)    return n.toFixed(4)
  return n.toFixed(5)
}
