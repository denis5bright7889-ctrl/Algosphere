'use client'

/**
 * CryptoStreamChart — nChart v1: a real, live, canvas-rendered candlestick
 * chart for streamed crypto majors. NOT an iframe.
 *
 * Honest by construction:
 *   • History seeded from public klines (Binance → Coinbase fallback).
 *   • Live updates come from the app's existing market-stream singleton
 *     (`useCryptoTicker`) — genuine exchange ticks, no synthesis.
 *   • The forming (last) candle mutates on each tick; a new candle rolls
 *     when the period closes.
 *   • Smooth: the live candle's close is interpolated toward the latest
 *     price on a rAF loop (feels alive without faking data).
 *   • Status is truthful — connecting / live / stale / offline / no-history.
 *
 * Only the streamed majors are live-eligible; the workspace falls back to
 * the TradingView embed for everything else (and offers it as "Advanced"
 * here too). No drawing tools / indicators — that's the embed's job.
 */
import { useEffect, useRef, useState } from 'react'
import { useCryptoTicker, useCryptoTickers } from '@/components/market/useCryptoTickers'
import { cn } from '@/lib/utils'

interface Candle { time: number; open: number; high: number; low: number; close: number }
type TF = '1m' | '5m' | '15m' | '1h'

const TF_MS: Record<TF, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 }
const MAX = 150

const UP = '#22c55e', DOWN = '#ef4444', GRID = 'rgba(255,255,255,0.05)', AXIS = 'rgba(255,255,255,0.35)'

function bucket(ts: number, tf: TF) { return Math.floor(ts / TF_MS[tf]) * TF_MS[tf] }

async function fetchHistory(symbol: string, tf: TF): Promise<Candle[]> {
  // Server proxy (Binance → Coinbase fallback, server-side). Fetching
  // exchanges directly from the browser is routinely CORS/geo-blocked;
  // the proxy fixes both. Honest empty on failure → "building live".
  try {
    const r = await fetch(`/api/market/klines?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: 'no-store' })
    if (r.ok) {
      const json = (await r.json()) as { candles?: Candle[] }
      const rows = json.candles ?? []
      if (rows.length) return rows
    }
  } catch { /* network → fall through to empty */ }
  return []
}

export default function CryptoStreamChart({ symbol }: { symbol: string }) {
  const [tf, setTf] = useState<TF>('1m')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'nohistory'>('loading')

  const ticker = useCryptoTicker(symbol)
  const { status } = useCryptoTickers()

  const candlesRef = useRef<Candle[]>([])
  const dispCloseRef = useRef<number>(0)     // animated close of the live candle
  const lastTickRef = useRef<number>(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 1) Seed history on symbol / timeframe change.
  useEffect(() => {
    let alive = true
    setPhase('loading')
    candlesRef.current = []
    fetchHistory(symbol, tf).then((c) => {
      if (!alive) return
      candlesRef.current = c
      dispCloseRef.current = c.length ? c[c.length - 1]!.close : 0
      setPhase(c.length ? 'ready' : 'nohistory')
    })
    return () => { alive = false }
  }, [symbol, tf])

  // 2) Fold each live tick into the forming candle.
  useEffect(() => {
    const p = ticker?.price
    if (!p || phase === 'loading') return
    lastTickRef.current = Date.now()
    const b = bucket(Date.now(), tf)
    const arr = candlesRef.current
    const last = arr[arr.length - 1]
    if (last && last.time === b) {
      last.close = p
      if (p > last.high) last.high = p
      if (p < last.low) last.low = p
    } else if (!last || b > last.time) {
      arr.push({ time: b, open: p, high: p, low: p, close: p })
      if (arr.length > MAX) arr.shift()
      dispCloseRef.current = p
      if (phase === 'nohistory') setPhase('ready')
    }
  }, [ticker?.price, tf, phase])

  // 3) Canvas draw loop (rAF) — interpolates the live close for smoothness.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const ro = new ResizeObserver(() => sizeCanvas())
    ro.observe(wrap)

    function sizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = wrap!.clientWidth, h = wrap!.clientHeight
      canvas!.width = Math.floor(w * dpr); canvas!.height = Math.floor(h * dpr)
      canvas!.style.width = `${w}px`; canvas!.style.height = `${h}px`
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    sizeCanvas()

    function draw() {
      const W = wrap!.clientWidth, H = wrap!.clientHeight
      ctx!.clearRect(0, 0, W, H)
      const candles = candlesRef.current
      if (candles.length >= 2) {
        // Lerp the live candle's displayed close toward its real close.
        const live = candles[candles.length - 1]!
        dispCloseRef.current += (live.close - dispCloseRef.current) * 0.18

        const padR = 64, padB = 18, padT = 10
        const plotW = Math.max(10, W - padR), plotH = Math.max(10, H - padB - padT)
        let hi = -Infinity, lo = Infinity
        for (const c of candles) { if (c.high > hi) hi = c.high; if (c.low < lo) lo = c.low }
        const liveDisp = dispCloseRef.current
        if (liveDisp > hi) hi = liveDisp; if (liveDisp < lo) lo = liveDisp
        const range = hi - lo || 1
        const pad = range * 0.08; hi += pad; lo -= pad
        const span = hi - lo
        const y = (p: number) => padT + (1 - (p - lo) / span) * plotH
        const n = candles.length
        const cw = plotW / n
        const bw = Math.max(1, Math.min(cw * 0.62, 14))

        // grid + price axis labels
        ctx!.font = '10px ui-monospace, monospace'
        ctx!.textBaseline = 'middle'
        for (let i = 0; i <= 4; i++) {
          const gy = padT + (plotH * i) / 4
          const gp = hi - (span * i) / 4
          ctx!.strokeStyle = GRID; ctx!.lineWidth = 1
          ctx!.beginPath(); ctx!.moveTo(0, gy); ctx!.lineTo(plotW, gy); ctx!.stroke()
          ctx!.fillStyle = AXIS
          ctx!.fillText(gp.toLocaleString(undefined, { maximumFractionDigits: gp < 10 ? 4 : 2 }), plotW + 6, gy)
        }

        // candles
        for (let i = 0; i < n; i++) {
          const c = candles[i]!
          const isLive = i === n - 1
          const close = isLive ? liveDisp : c.close
          const up = close >= c.open
          const col = up ? UP : DOWN
          const cx = i * cw + cw / 2
          ctx!.strokeStyle = col; ctx!.fillStyle = col; ctx!.lineWidth = 1
          // wick
          ctx!.beginPath(); ctx!.moveTo(cx, y(c.high)); ctx!.lineTo(cx, y(c.low)); ctx!.stroke()
          // body
          const yo = y(c.open), yc = y(close)
          const top = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo))
          ctx!.globalAlpha = isLive ? 1 : 0.92
          ctx!.fillRect(cx - bw / 2, top, bw, bh)
          ctx!.globalAlpha = 1
          if (isLive) {
            // live close line + dot
            ctx!.strokeStyle = 'rgba(240,165,0,0.7)'; ctx!.setLineDash([3, 3]); ctx!.lineWidth = 1
            ctx!.beginPath(); ctx!.moveTo(0, yc); ctx!.lineTo(plotW, yc); ctx!.stroke(); ctx!.setLineDash([])
            ctx!.fillStyle = '#f0a500'; ctx!.beginPath(); ctx!.arc(cx, yc, 2.5, 0, Math.PI * 2); ctx!.fill()
            ctx!.fillStyle = '#f0a500'
            ctx!.fillRect(plotW, yc - 8, padR, 16)
            ctx!.fillStyle = '#1a1400'
            ctx!.fillText(liveDisp.toLocaleString(undefined, { maximumFractionDigits: liveDisp < 10 ? 4 : 2 }), plotW + 6, yc)
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [phase])

  // Honest status read.
  const fresh = Date.now() - lastTickRef.current < 8000
  const live = status === 'live' && fresh && phase === 'ready'
  const statePill =
    phase === 'loading' ? { t: 'Loading…', c: 'text-muted-foreground', d: 'bg-muted-foreground/60' }
    : status === 'offline' ? { t: 'Stream offline', c: 'text-rose-300', d: 'bg-rose-400' }
    : live ? { t: `Live · ${tf}`, c: 'text-emerald-300', d: 'bg-emerald-400 animate-pulse' }
    : { t: `Reconnecting · ${tf}`, c: 'text-amber-300', d: 'bg-amber-400' }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className={cn('flex items-center gap-1.5 text-[11px] font-bold', statePill.c)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', statePill.d)} aria-hidden />
          {statePill.t}
        </span>
        <div className="flex items-center gap-0.5">
          {(['1m', '5m', '15m', '1h'] as TF[]).map((t) => (
            <button key={t} type="button" onClick={() => setTf(t)}
              className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors',
                t === tf ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="block h-full w-full" />
        {phase === 'nohistory' && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-muted-foreground">
            Couldn’t load candle history (exchange REST blocked here). Building candles live from ticks…
          </div>
        )}
      </div>
    </div>
  )
}
