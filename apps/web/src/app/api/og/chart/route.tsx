/**
 * /api/og/chart — server-rendered chart image (PNG, 1200×630).
 *
 * Produces equity-curve / drawdown / pnl chart cards on the same
 * next/og (satori) runtime as the other OG endpoints — no headless
 * browser, no extra deps. The content factory points an asset at this
 * URL with the series encoded in the query string; the result is a real
 * branded image suitable for social/blog/report embeds.
 *
 * Query params:
 *   type    'equity' | 'drawdown' | 'pnl'   (accent + framing)
 *   series  comma-separated numbers (the line)   e.g. 10000,10120,9980,10340
 *   title   headline (≤ 80)
 *   label   small pill (≤ 24)
 *   sub     subtitle / metric (≤ 80)
 */
import { ImageResponse } from 'next/og'

export const runtime    = 'edge'
export const revalidate = 3600

const W = 1200, H = 630
const PAD = { l: 80, r: 60, t: 170, b: 80 }
const PLOT_W = W - PAD.l - PAD.r
const PLOT_H = H - PAD.t - PAD.b

const TONES: Record<string, { fg: string; label: string }> = {
  equity:   { fg: '#10b981', label: 'Equity Curve' },
  drawdown: { fg: '#f43f5e', label: 'Drawdown' },
  pnl:      { fg: '#fbbf24', label: 'P&L' },
}

function clamp(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

function parseSeries(raw: string | null): number[] {
  if (!raw) return []
  return raw.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n)).slice(0, 400)
}

export async function GET(req: Request) {
  const url     = new URL(req.url)
  const typeKey = url.searchParams.get('type') ?? 'equity'
  const tone    = TONES[typeKey] ?? TONES.equity!
  const title   = clamp(url.searchParams.get('title') ?? 'Performance', 80)
  const label   = clamp(url.searchParams.get('label') ?? tone.label, 24)
  const sub     = clamp(url.searchParams.get('sub') ?? '', 80)
  const series  = parseSeries(url.searchParams.get('series'))

  // Coordinate mapping. Guard the degenerate (0/1 point or flat) cases so
  // the path math never divides by zero.
  const n = series.length
  const min = n ? Math.min(...series) : 0
  const max = n ? Math.max(...series) : 1
  const span = max - min || 1
  const xAt = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * PLOT_W)
  const yAt = (v: number) => PAD.t + PLOT_H - ((v - min) / span) * PLOT_H

  const linePath = n >= 2
    ? series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(' ')
    : ''
  const areaPath = n >= 2
    ? `${linePath} L ${xAt(n - 1).toFixed(1)} ${(PAD.t + PLOT_H).toFixed(1)} L ${xAt(0).toFixed(1)} ${(PAD.t + PLOT_H).toFixed(1)} Z`
    : ''
  // Zero baseline (only when the range straddles 0 — useful for pnl/drawdown).
  const zeroY = (min < 0 && max > 0) ? yAt(0) : null

  return new ImageResponse(
    (
      <div style={{
        display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
        background: '#000', color: '#fafafa', padding: '56px 64px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 24, color: '#000',
          }}>A</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>AlgoSphere Quant</div>
            <div style={{ fontSize: 12, color: tone.fg, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
          </div>
          {sub && <div style={{ marginLeft: 'auto', fontSize: 30, fontWeight: 800, color: tone.fg }}>{sub}</div>}
        </div>
        <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, marginTop: 14, letterSpacing: '-0.01em' }}>{title}</div>

        {/* Chart */}
        <div style={{ display: 'flex', flex: 1 }}>
          <svg width={W - 128} height={PLOT_H + 60} viewBox={`0 0 ${W} ${PLOT_H + PAD.t + 10}`}>
            <defs>
              <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tone.fg} stopOpacity="0.35" />
                <stop offset="100%" stopColor={tone.fg} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* frame baseline */}
            <line x1={PAD.l} y1={PAD.t + PLOT_H} x2={PAD.l + PLOT_W} y2={PAD.t + PLOT_H} stroke="#27272a" strokeWidth="2" />
            {zeroY != null && (
              <line x1={PAD.l} y1={zeroY} x2={PAD.l + PLOT_W} y2={zeroY} stroke="#3f3f46" strokeWidth="1.5" strokeDasharray="6 6" />
            )}
            {areaPath && <path d={areaPath} fill="url(#area)" />}
            {linePath && <path d={linePath} fill="none" stroke={tone.fg} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />}
            {n >= 1 && <circle cx={xAt(n - 1)} cy={yAt(series[n - 1]!)} r="7" fill={tone.fg} />}
          </svg>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 15, color: '#71717a', borderTop: '1px solid #27272a', paddingTop: 14 }}>
          <span style={{ color: tone.fg, fontWeight: 700 }}>algospherequant.com</span>
          <span style={{ marginLeft: 'auto' }}>
            {n >= 2 ? `${n} points · ${min.toLocaleString()} – ${max.toLocaleString()}` : 'Trading involves risk · Not financial advice'}
          </span>
        </div>
      </div>
    ),
    { width: W, height: H },
  )
}
