import React from 'react'
import {
  AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig,
  interpolate, spring, staticFile,
} from 'remotion'
import { resolveScene } from './scenes'

export interface Timings {
  id:      string
  title:   string
  voice:   string
  total_s: number
  gap_s:   number
  fps:     number
  width:   number
  height:  number
  lines: Array<{
    id:      string
    text:    string
    mp3:     string
    start_s: number
    dur_s:   number
  }>
}


export const Video: React.FC<{ timings: Timings }> = ({ timings }) => {
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill style={{ backgroundColor: '#06070A' }}>
      <BrandBackdrop />
      {timings.lines.map((line, i) => {
        const fromFrame = Math.round(line.start_s * fps)
        const durFrames = Math.round(line.dur_s * fps) + 10
        return (
          <Sequence key={line.id} from={fromFrame} durationInFrames={durFrames}>
            <Audio src={staticFile(line.mp3)} />
            <LineScene videoId={timings.id} line={line} index={i} total={timings.lines.length} />
          </Sequence>
        )
      })}
      <BrandFooter />
    </AbsoluteFill>
  )
}


// ─── Backdrop — animated gradient + grid overlay (on-brand) ─────────

const BrandBackdrop: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const slow = (frame / fps) * 8
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          inset:    -200,
          background:
            `radial-gradient(circle at ${50 + Math.sin(slow * 0.05) * 20}% ${30 + Math.cos(slow * 0.05) * 15}%, rgba(252, 211, 77, 0.18), transparent 55%),` +
            `radial-gradient(circle at ${30 + Math.cos(slow * 0.03) * 20}% ${80 + Math.sin(slow * 0.03) * 10}%, rgba(244, 63, 94, 0.10), transparent 50%)`,
        }}
      />
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


const BrandHeader: React.FC = () => (
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
      ALGOSPHERE <span style={{ color: '#fcd34d' }}>QUANT</span>
    </div>
  </div>
)


const BrandFooter: React.FC = () => (
  <div style={{
    position: 'absolute', bottom: 60, left: 0, right: 0,
    textAlign: 'center', color: 'rgba(255,255,255,0.4)',
    fontSize: 22, fontFamily: 'system-ui,sans-serif', letterSpacing: 2,
  }}>
    algospherequant.com
  </div>
)


const LineScene: React.FC<{
  videoId: string; line: Timings['lines'][number]; index: number; total: number
}> = ({ videoId, line }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const intro = spring({ frame, fps, config: { damping: 14, stiffness: 90 } })
  const opacity = interpolate(intro, [0, 1], [0, 1])
  const slideY  = interpolate(intro, [0, 1], [30, 0])

  const sceneEl = resolveScene(videoId, line.id, line.text)

  return (
    <AbsoluteFill>
      <BrandHeader />
      <AbsoluteFill style={{
        opacity, transform: `translateY(${slideY}px)`,
        padding: '180px 90px 220px 90px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        alignItems: 'center', textAlign: 'center',
      }}>
        {sceneEl}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
