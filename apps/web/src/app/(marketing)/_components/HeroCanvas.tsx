'use client'

import { useEffect, useRef } from 'react'

/**
 * Animated institutional market visual — GPU-friendly Canvas.
 *
 * A streaming candlestick tape with a moving MA-20, a sweeping
 * telemetry scan-line, and a pulsing last-price node. Decorative
 * design surface — NOT a live price feed, NOT fabricated stats. The
 * series is a seeded random walk that scrolls forward in real time.
 *
 * Performance posture (on-brief):
 *   • DPR-aware backing store, capped at 2× for memory.
 *   • Throttled to ~40fps; pauses when tab hidden or scrolled off
 *     (IntersectionObserver) — zero work when not visible.
 *   • Honors prefers-reduced-motion: paints one static frame, no loop.
 */

interface Candle { o: number; h: number; l: number; c: number }

function makeRng(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COUNT = 60
const STEP_MS = 900       // new candle cadence
const FRAME_MS = 25       // ~40fps draw throttle

const GOLD = '#f5c842'
const GOLD_DIM = 'rgba(245, 200, 66, 0.55)'
const UP = '#10b981'
const UP_HI = '#34d399'
const DOWN = '#f43f5e'
const DOWN_HI = '#fb7185'

export default function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Seeded series — deterministic first paint, then it walks forward.
    const rnd = makeRng(20260518)
    const series: Candle[] = []
    let price = 100
    for (let i = 0; i < COUNT; i++) {
      const open = price
      const close = open + (rnd() - 0.485) * 2.4
      series.push({
        o: open,
        c: close,
        h: Math.max(open, close) + rnd() * 1.8,
        l: Math.min(open, close) - rnd() * 1.8,
      })
      price = close
    }
    const live = makeRng(98765)
    function pushCandle() {
      const open = series[series.length - 1]!.c
      const close = open + (live() - 0.485) * 2.6
      series.push({
        o: open,
        c: close,
        h: Math.max(open, close) + live() * 1.9,
        l: Math.min(open, close) - live() * 1.9,
      })
      series.shift()
    }

    let cssW = 0
    let cssH = 0
    function resize() {
      const rect = canvas!.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      cssW = rect.width
      cssH = rect.height
      canvas!.width = Math.round(cssW * dpr)
      canvas!.height = Math.round(cssH * dpr)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    function ma(period: number, upto: number): number {
      let sum = 0
      for (let k = upto - period + 1; k <= upto; k++) sum += series[k]!.c
      return sum / period
    }

    function draw(scan: number) {
      const padX = 10
      const padTop = 14
      const padBot = 16
      const innerW = cssW - padX * 2
      const innerH = cssH - padTop - padBot
      const colW = innerW / COUNT
      const bodyW = Math.max(2.4, colW * 0.6)

      let min = Infinity
      let max = -Infinity
      for (const c of series) { if (c.l < min) min = c.l; if (c.h > max) max = c.h }
      const span = max - min || 1
      const yOf = (p: number) => padTop + (1 - (p - min) / span) * innerH
      const xOf = (i: number) => padX + i * colW + colW / 2

      ctx!.clearRect(0, 0, cssW, cssH)

      // Grid
      ctx!.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx!.lineWidth = 1
      for (const g of [0.25, 0.5, 0.75]) {
        const y = padTop + innerH * g
        ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(cssW, y); ctx!.stroke()
      }

      // Candles
      for (let i = 0; i < series.length; i++) {
        const c = series[i]!
        const up = c.c >= c.o
        const x = xOf(i)
        ctx!.strokeStyle = up ? UP_HI : DOWN_HI
        ctx!.globalAlpha = 0.85
        ctx!.beginPath(); ctx!.moveTo(x, yOf(c.h)); ctx!.lineTo(x, yOf(c.l)); ctx!.stroke()
        ctx!.globalAlpha = 0.95
        ctx!.fillStyle = up ? UP : DOWN
        const top = Math.min(yOf(c.o), yOf(c.c))
        ctx!.fillRect(x - bodyW / 2, top, bodyW, Math.max(1, Math.abs(yOf(c.c) - yOf(c.o))))
      }
      ctx!.globalAlpha = 1

      // MA-20
      ctx!.strokeStyle = GOLD_DIM
      ctx!.lineWidth = 1.4
      ctx!.beginPath()
      for (let i = 19; i < series.length; i++) {
        const x = xOf(i)
        const y = yOf(ma(20, i))
        i === 19 ? ctx!.moveTo(x, y) : ctx!.lineTo(x, y)
      }
      ctx!.stroke()

      // Sweeping telemetry scan-line
      if (!reduceMotion) {
        const sx = padX + scan * innerW
        const grad = ctx!.createLinearGradient(sx - 30, 0, sx + 6, 0)
        grad.addColorStop(0, 'rgba(245,200,66,0)')
        grad.addColorStop(1, 'rgba(245,200,66,0.22)')
        ctx!.fillStyle = grad
        ctx!.fillRect(sx - 30, padTop, 36, innerH)
        ctx!.strokeStyle = 'rgba(245,200,66,0.5)'
        ctx!.lineWidth = 1
        ctx!.beginPath(); ctx!.moveTo(sx, padTop); ctx!.lineTo(sx, padTop + innerH); ctx!.stroke()
      }

      // Pulsing last-price node
      const lp = series[series.length - 1]!.c
      const lx = xOf(series.length - 1)
      const ly = yOf(lp)
      const pulse = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(scan * Math.PI * 2)
      ctx!.fillStyle = `rgba(245,200,66,${0.12 + pulse * 0.16})`
      ctx!.beginPath(); ctx!.arc(lx, ly, 7 + pulse * 4, 0, Math.PI * 2); ctx!.fill()
      ctx!.fillStyle = GOLD
      ctx!.beginPath(); ctx!.arc(lx, ly, 2.6, 0, Math.PI * 2); ctx!.fill()
    }

    if (reduceMotion) {
      draw(0.5)
      const ro = new ResizeObserver(() => { resize(); draw(0.5) })
      ro.observe(canvas)
      return () => ro.disconnect()
    }

    let raf = 0
    let lastFrame = 0
    let lastStep = 0
    let running = true
    function loop(ts: number) {
      if (!running) return
      if (ts - lastFrame >= FRAME_MS) {
        if (ts - lastStep >= STEP_MS) { pushCandle(); lastStep = ts }
        draw((ts % 4000) / 4000)
        lastFrame = ts
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    function setRunning(on: boolean) {
      if (on && !running) { running = true; raf = requestAnimationFrame(loop) }
      else if (!on && running) { running = false; cancelAnimationFrame(raf) }
    }
    const onVis = () => setRunning(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)

    const io = new IntersectionObserver(
      ([e]) => setRunning(!!e?.isIntersecting && document.visibilityState === 'visible'),
      { threshold: 0.01 },
    )
    io.observe(canvas)

    const ro = new ResizeObserver(() => { resize(); draw((performance.now() % 4000) / 4000) })
    ro.observe(canvas)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      io.disconnect()
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="block h-56 w-full sm:h-64"
      aria-hidden
      role="presentation"
    />
  )
}
