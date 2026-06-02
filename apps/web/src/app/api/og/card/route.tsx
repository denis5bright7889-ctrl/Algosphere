/**
 * /api/og/card — generic branded card.
 *
 * Query params:
 *   title    (required, ≤ 110 chars)
 *   subtitle (optional, ≤ 220 chars)
 *   label    (optional, ≤ 24 chars — appears as the small pill above the title)
 *   tone     (optional: 'amber' | 'emerald' | 'rose' | 'sky' — accent colour)
 *
 * Used as a fallback OG image for ad-hoc landing pages, marketing
 * snippets, or any URL that needs branded social cards without a
 * dedicated route. Edge runtime + 1-hour ISR (cards are deterministic
 * per query string).
 */
import { ImageResponse } from 'next/og'

export const runtime    = 'edge'
export const revalidate = 3600

const TONES: Record<string, { fg: string; bg: string }> = {
  amber:   { fg: '#fbbf24', bg: '#f59e0b1a' },
  emerald: { fg: '#10b981', bg: '#10b9811a' },
  rose:    { fg: '#f43f5e', bg: '#f43f5e1a' },
  sky:     { fg: '#0ea5e9', bg: '#0ea5e91a' },
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const title    = clamp(url.searchParams.get('title')    ?? 'AlgoSphere Quant',  110)
  const subtitle = clamp(url.searchParams.get('subtitle') ?? '',                  220)
  const label    = clamp(url.searchParams.get('label')    ?? 'AlgoSphere',         24)
  const toneKey  = url.searchParams.get('tone') ?? 'amber'
  const tone     = TONES[toneKey] ?? TONES.amber!

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
            <div style={{
              fontSize: 13, color: tone.fg,
              letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700,
            }}>
              {label}
            </div>
          </div>
        </div>

        {/* Title + subtitle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1000 }}>
          <div style={{
            fontSize: 60, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.01em',
          }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 24, lineHeight: 1.35, color: '#d4d4d8' }}>{subtitle}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          paddingTop: 18, borderTop: '1px solid #27272a',
          fontSize: 16,
        }}>
          <span style={{ color: tone.fg, fontWeight: 700 }}>algospherequant.com</span>
          <span style={{ marginLeft: 'auto', color: '#71717a', fontSize: 12 }}>
            Trading involves risk · Not financial advice
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}

function clamp(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
