'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  value:           number
  duration?:       number          // ms — full count animation
  prefix?:         string
  suffix?:         string
  decimals?:       number
  className?:      string
}

/**
 * Smoothly counts from previous value to current value.
 * GPU-friendly: no layout thrash, only text content updates.
 * Respects `prefers-reduced-motion`.
 */
export default function AnimatedNumber({
  value,
  duration  = 900,
  prefix    = '',
  suffix    = '',
  decimals  = 0,
  className,
}: Props) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const start    = prev.current
    const delta    = value - start
    const reduced  = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || delta === 0) {
      setDisplay(value)
      prev.current = value
      return
    }

    const t0 = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - t0) / duration)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - elapsed, 3)
      setDisplay(start + delta * eased)
      if (elapsed < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        prev.current = value
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value, duration])

  const formatted = Number(display).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return <span className={className}>{prefix}{formatted}{suffix}</span>
}
