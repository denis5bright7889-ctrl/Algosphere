import React from 'react'
import { Composition, staticFile } from 'remotion'
import { Video } from './Video'
import { EventVideo } from './event_video'
import v2  from '../public/v2/timings.json'
import v49 from '../public/v49/timings.json'
import v58 from '../public/v58/timings.json'
import v69 from '../public/v69/timings.json'
import v82 from '../public/v82/timings.json'

const SHOWS = [v2, v49, v58, v69, v82]

// Generic dynamic-video composition used by the asset-worker.
// Timings are loaded at render time via staticFile lookup so a single
// composition serves every video asset_kind (signal_reel / trade_recap_video
// / weekly_recap_video / etc.) without rebuilding the bundle. Default
// duration is generous; the actual length is bounded by the audio
// sequences inside EventVideo itself.
const EVENT_VIDEO_FPS = 30
const EVENT_VIDEO_MAX_S = 90  // hard ceiling; per-kind narrations cap below this

export const Root: React.FC = () => (
  <>
    {SHOWS.map((t) => (
      <Composition
        key={t.id}
        id={t.id}
        component={Video as any}
        durationInFrames={Math.ceil(t.total_s * t.fps) + 45}
        fps={t.fps}
        width={t.width}
        height={t.height}
        defaultProps={{ timings: t as any }}
      />
    ))}
    <Composition
      id="event_video"
      component={EventVideo as any}
      durationInFrames={EVENT_VIDEO_FPS * EVENT_VIDEO_MAX_S}
      fps={EVENT_VIDEO_FPS}
      width={1080}
      height={1920}
      defaultProps={{ asset_kind: 'signal_reel' }}
    />
  </>
)

export { staticFile }
