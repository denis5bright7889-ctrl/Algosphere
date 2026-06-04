/**
 * event_video — the generic dynamic-data video composition used by
 * the asset-worker. One composition serves every video asset_kind
 * (signal_reel, trade_recap_video, weekly_recap_video, etc.) — the
 * variant is driven by `timings.asset_kind` and the per-line scene
 * lookup table.
 *
 * The asset-worker writes timings.json into
 * public/event_video_<kind>/ then invokes
 *   npx remotion render event_video <out> --props '{"asset_kind":"signal_reel"}'
 *
 * defaultProps.asset_kind picks WHICH staticFile timings.json to load
 * at render time (since the composition itself is registered once
 * and we want one composition handling N kinds without rebuilding
 * the bundle each time).
 */
import React from 'react'
import {
  AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig,
  interpolate, spring, staticFile, delayRender, continueRender,
} from 'remotion'

export interface EventVideoTimings {
  id:         string
  title:      string
  voice:      string
  total_s:    number
  gap_s:      number
  fps:        number
  width:      number
  height:     number
  asset_kind: string
  payload:    Record<string, unknown>
  lines: Array<{
    id:       string
    text:     string
    mp3:      string
    start_s:  number
    dur_s:    number
  }>
}


const AMBER  = '#fcd34d'
const ROSE   = '#f43f5e'
const EMERALD = '#34d399'
const WHITE  = 'rgba(255,255,255,0.95)'
const MUTED  = 'rgba(255,255,255,0.55)'


export const EventVideo: React.FC<{ asset_kind: string }> = ({ asset_kind }) => {
  const [timings, setTimings] = React.useState<EventVideoTimings | null>(null)
  const handle = React.useMemo(() => delayRender('load-timings'), [])

  React.useEffect(() => {
    fetch(staticFile(`event_video_${asset_kind}/timings.json`))
      .then((r) => r.json() as Promise<EventVideoTimings>)
      .then((t) => { setTimings(t); continueRender(handle) })
      .catch(() => continueRender(handle))
  }, [asset_kind, handle])

  if (!timings) {
    return <AbsoluteFill style={{ backgroundColor: '#06070A' }} />
  }
  return <Rendered timings={timings} assetKind={asset_kind} />
}


const Rendered: React.FC<{ timings: EventVideoTimings; assetKind: string }> = ({
  timings, assetKind,
}) => {
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill style={{ backgroundColor: '#06070A' }}>
      <Backdrop />
      {timings.lines.map((line, i) => {
        const from = Math.round(line.start_s * fps)
        const dur  = Math.round(line.dur_s * fps) + 10
        return (
          <Sequence key={line.id} from={from} durationInFrames={dur}>
            <Audio src={staticFile(`event_video_${assetKind}/${line.mp3}`)} />
            <LineSlide
              text={line.text}
              kind={assetKind}
              lineIndex={i}
              total={timings.lines.length}
              payload={timings.payload}
            />
          </Sequence>
        )
      })}
      <Footer />
    </AbsoluteFill>
  )
}


const Backdrop: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const slow = (frame / fps) * 8
  return (
    <AbsoluteFill>
      <div style={{
        position: 'absolute', inset: -200,
        background:
          `radial-gradient(circle at ${50 + Math.sin(slow * 0.05) * 20}% ${30 + Math.cos(slow * 0.05) * 15}%, rgba(252,211,77,0.18), transparent 55%),` +
          `radial-gradient(circle at ${30 + Math.cos(slow * 0.03) * 20}% ${80 + Math.sin(slow * 0.03) * 10}%, rgba(244,63,94,0.10), transparent 50%)`,
      }} />
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.06 }}>
        <defs>
          <pattern id="g" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#fcd34d" strokeWidth="1"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
      </svg>
    </AbsoluteFill>
  )
}


const Header: React.FC = () => (
  <div style={{
    position: 'absolute', top: 60, left: 0, right: 0,
    display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14,
  }}>
    <div style={{
      width: 14, height: 14, borderRadius: 4,
      background: 'linear-gradient(135deg,#fcd34d 0%,#f59e0b 100%)',
      boxShadow: '0 0 16px rgba(252,211,77,0.6)',
    }}/>
    <div style={{
      fontSize: 26, fontWeight: 800, color: 'rgba(255,255,255,0.85)',
      letterSpacing: 3, fontFamily: 'system-ui,sans-serif',
    }}>
      ALGOSPHERE <span style={{ color: AMBER }}>QUANT</span>
    </div>
  </div>
)


const Footer: React.FC = () => (
  <div style={{
    position: 'absolute', bottom: 60, left: 0, right: 0,
    textAlign: 'center', color: MUTED,
    fontSize: 22, fontFamily: 'system-ui,sans-serif', letterSpacing: 2,
  }}>
    algospherequant.com
  </div>
)


const LineSlide: React.FC<{
  text: string; kind: string; lineIndex: number; total: number;
  payload: Record<string, unknown>
}> = ({ text, kind, lineIndex, total, payload }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const intro = spring({ frame, fps, config: { damping: 14, stiffness: 90 } })
  const opacity = interpolate(intro, [0, 1], [0, 1])
  const slideY  = interpolate(intro, [0, 1], [30, 0])

  // First slide gets the hero treatment per kind; middle slides
  // share the same big-text layout; last slide is the CTA.
  const isFirst = lineIndex === 0
  const isLast  = lineIndex === total - 1
  const accent  = (
    kind.includes('signal') ? AMBER
    : kind.includes('trade') ? EMERALD
    : kind.includes('weekly') || kind.includes('monthly') ? AMBER
    : kind.includes('feature') ? '#60a5fa'
    : kind.includes('achievement') ? AMBER
    : AMBER
  )

  return (
    <AbsoluteFill>
      <Header />
      <AbsoluteFill style={{
        opacity, transform: `translateY(${slideY}px)`,
        padding: '180px 90px 220px 90px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        alignItems: 'center', textAlign: 'center',
      }}>
        {isFirst && <HeroSlide text={text} accent={accent} payload={payload} kind={kind} />}
        {!isFirst && !isLast && <BodySlide text={text} accent={accent} />}
        {isLast && <CtaSlide text={text} accent={accent} />}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}


const HeroSlide: React.FC<{ text: string; accent: string; payload: Record<string, unknown>; kind: string }> =
  ({ text, accent, payload, kind }) => {
    const pair = String(payload.pair || payload.symbol || '')
    return (
      <>
        {pair && (kind.includes('signal') || kind.includes('trade')) ? (
          <div style={{
            fontSize: 160, fontWeight: 900, color: 'white',
            fontFamily: 'system-ui,sans-serif', lineHeight: 1, marginBottom: 40,
            textShadow: `0 0 40px ${accent}55`,
          }}>{pair.toUpperCase()}</div>
        ) : null}
        <div style={{
          fontSize: 64, fontWeight: 800, color: accent, fontFamily: 'system-ui,sans-serif',
          lineHeight: 1.15, maxWidth: 900, letterSpacing: 1,
        }}>{text}</div>
      </>
    )
  }


const BodySlide: React.FC<{ text: string; accent: string }> = ({ text, accent }) => (
  <div style={{
    fontSize: 68, fontWeight: 800, color: 'white',
    fontFamily: 'system-ui,sans-serif', lineHeight: 1.18,
    maxWidth: 900,
  }}>
    {text.split('. ').map((s, i) => (
      <div key={i} style={i === 0 ? { color: accent, marginBottom: 12 } : {}}>{s}</div>
    ))}
  </div>
)


const CtaSlide: React.FC<{ text: string; accent: string }> = ({ text, accent }) => {
  const frame = useCurrentFrame()
  const pulse = 1 + Math.sin(frame / 6) * 0.05
  return (
    <>
      <div style={{
        fontSize: 56, fontWeight: 700, color: WHITE,
        fontFamily: 'system-ui,sans-serif', marginBottom: 30, maxWidth: 900,
      }}>{text}</div>
      <div style={{
        marginTop: 30, padding: '24px 50px',
        background: `${accent}1f`, border: `3px solid ${accent}`,
        borderRadius: 100, fontSize: 38, fontWeight: 700, color: 'white',
        fontFamily: 'system-ui,sans-serif',
        boxShadow: `0 0 40px ${accent}55`,
        transform: `scale(${pulse})`,
      }}>algospherequant.com</div>
      <div style={{
        marginTop: 24, fontSize: 30, fontWeight: 600,
        color: MUTED, fontFamily: 'system-ui,sans-serif', letterSpacing: 2,
      }}>LINK IN BIO</div>
    </>
  )
}
