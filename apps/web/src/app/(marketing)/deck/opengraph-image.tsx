/**
 * Open Graph image for /deck — the preview card when the pitch link is
 * shared with an investor. Brand + the deck's one-line positioning.
 */
import { ImageResponse } from 'next/og'

export const runtime  = 'edge'
export const alt      = 'AlgoSphere Quant — investor pitch deck'
export const size     = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column',
          background: 'linear-gradient(135deg, #050507 0%, #0a0a12 100%)',
          color: '#f5f5f7', padding: '72px', justifyContent: 'space-between',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{
          fontSize: 20, color: '#f5b14c', letterSpacing: 4,
          textTransform: 'uppercase', fontWeight: 700,
        }}>
          Pitch deck · 12 slides
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.04, letterSpacing: '-0.02em', maxWidth: 1000 }}>
            Institutional market intelligence,{' '}
            <span style={{ color: '#f5b14c' }}>shipped end-to-end</span> by one founder.
          </div>
          <div style={{ fontSize: 26, color: '#a1a1aa', maxWidth: 920, lineHeight: 1.35 }}>
            12 slides · honest engineering · live system · open to first-believer support.
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderTop: '1px solid #27272a', paddingTop: 24,
        }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            AlgoSphere <span style={{ color: '#f5b14c' }}>Quant</span>
          </div>
          <div style={{ fontSize: 22, color: '#71717a' }}>algospherequant.com/deck</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
