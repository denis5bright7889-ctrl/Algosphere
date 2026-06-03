import React from 'react'
import { Composition, staticFile } from 'remotion'
import { Video } from './Video'
import v2  from '../public/v2/timings.json'
import v49 from '../public/v49/timings.json'
import v58 from '../public/v58/timings.json'
import v69 from '../public/v69/timings.json'
import v82 from '../public/v82/timings.json'

const SHOWS = [v2, v49, v58, v69, v82]

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
  </>
)

export { staticFile }
