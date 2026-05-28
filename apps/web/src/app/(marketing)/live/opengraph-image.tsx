/**
 * Open Graph image for /live — generated on the edge via next/og. Renders
 * when the URL is shared on X / Reddit / Telegram / iMessage / LinkedIn /
 * Discord etc. Brand + live-status pill + the single value prop.
 */
import { ImageResponse } from 'next/og'

export const runtime  = 'edge'
export const alt      = 'AlgoSphere Quant — live institutional signals'
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{
            display: 'flex', width: 14, height: 14, borderRadius: 9999,
            background: '#10b981', boxShadow: '0 0 18px #10b981',
          }} />
          <span style={{
            fontSize: 22, color: '#34d399', letterSpacing: 4,
            textTransform: 'uppercase', fontWeight: 700,
          }}>Engine live · scanning 25 instruments</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.02em' }}>
            Live institutional <span style={{ color: '#f5b14c' }}>signals.</span>
          </div>
          <div style={{ fontSize: 30, color: '#a1a1aa', maxWidth: 880, lineHeight: 1.3 }}>
            Regime · momentum · risk-gated. Forex, metals, indices, crypto.
            Free to watch.
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderTop: '1px solid #27272a', paddingTop: 24,
        }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            AlgoSphere <span style={{ color: '#f5b14c' }}>Quant</span>
          </div>
          <div style={{ fontSize: 22, color: '#71717a' }}>algospherequant.com/live</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
