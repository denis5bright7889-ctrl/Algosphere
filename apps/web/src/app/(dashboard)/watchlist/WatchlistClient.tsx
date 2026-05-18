'use client'

import { useMemo, useState, useTransition } from 'react'
import { Plus, X, Radio, CircleSlash } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCryptoTickerForPair } from '@/components/market/useCryptoTickers'

interface UniInstrument {
  symbol:     string
  label:      string
  group:      string | null
  dataSource: 'crypto-stream' | null
}
interface UniCategory {
  assetClass: string
  label:      string
  instruments: UniInstrument[]
}
interface WatchItem {
  symbol:      string
  asset_class: string
  added_at:    string
}

interface Props {
  initial:   WatchItem[]
  universe:  UniCategory[]
}

const ASSET_CLS: Record<string, string> = {
  forex:       'border-blue-500/40 bg-blue-500/10 text-blue-300',
  indices:     'border-violet-500/40 bg-violet-500/10 text-violet-300',
  commodities: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  futures:     'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  stocks:      'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  crypto:      'border-rose-500/40 bg-rose-500/10 text-rose-300',
}

export default function WatchlistClient({ initial, universe }: Props) {
  const [items, setItems] = useState<WatchItem[]>(initial)
  const [picking, setPicking] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Universe symbol → instrument lookup for fast metadata on rows.
  const lookup = useMemo(() => {
    const m = new Map<string, UniInstrument & { assetClass: string }>()
    for (const c of universe) for (const i of c.instruments) {
      m.set(i.symbol, { ...i, assetClass: c.assetClass })
    }
    return m
  }, [universe])

  // Items already pinned, for hiding in the picker.
  const pinned = useMemo(() => new Set(items.map((i) => i.symbol)), [items])

  function add(symbol: string) {
    setError(null)
    startTransition(async () => {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? `HTTP ${res.status}`); return }
      setItems((arr) => [json.item, ...arr])
    })
  }
  function remove(symbol: string) {
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? `HTTP ${res.status}`)
        return
      }
      setItems((arr) => arr.filter((x) => x.symbol !== symbol))
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {items.length} pinned · {items.filter((i) => i.asset_class === 'crypto').length} live
        </p>
        <button
          type="button"
          onClick={() => { setPicking((v) => !v); setError(null) }}
          className="btn-glass !text-xs"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
          {picking ? 'Close picker' : 'Add instrument'}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      {picking && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Market Universe
          </p>
          <div className="space-y-3">
            {universe.map((c) => {
              const available = c.instruments.filter((i) => !pinned.has(i.symbol))
              if (available.length === 0) return null
              const liveClass = c.instruments.some((i) => i.dataSource !== null)
              return (
                <div key={c.assetClass}>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span className="text-xs font-semibold">{c.label}</span>
                    {liveClass ? (
                      <span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-300">
                        <Radio className="h-2.5 w-2.5 animate-pulse-soft" strokeWidth={2.5} aria-hidden />Live
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground/70">
                        <CircleSlash className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />feed not connected
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {available.map((i) => (
                      <button
                        key={i.symbol}
                        type="button"
                        onClick={() => add(i.symbol)}
                        disabled={pending}
                        className="rounded-md border border-border bg-background/60 px-2 py-1 text-[11px] font-medium transition-colors hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-50"
                      >
                        {i.label}
                        <span className="ml-1 font-mono text-[9px] text-muted-foreground/70">{i.symbol}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No instruments pinned yet. Click <span className="font-semibold">Add instrument</span> to pick from the Market Universe.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const meta = lookup.get(it.symbol)
            const isLive = meta?.dataSource !== null && meta?.dataSource !== undefined
            return (
              <li key={it.symbol} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider capitalize',
                        ASSET_CLS[it.asset_class] ?? 'border-border text-muted-foreground',
                      )}
                    >
                      {it.asset_class}
                    </span>
                    <span className="font-mono text-xs font-semibold">{it.symbol}</span>
                    {meta?.label && meta.label !== it.symbol && (
                      <span className="truncate text-xs text-muted-foreground">{meta.label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {isLive
                      ? <LivePrice symbol={it.symbol} />
                      : <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <CircleSlash className="h-3 w-3" strokeWidth={2} aria-hidden />Feed not connected
                        </span>}
                    <button
                      type="button"
                      onClick={() => remove(it.symbol)}
                      disabled={pending}
                      aria-label={`Remove ${it.symbol}`}
                      className="rounded p-1 text-muted-foreground hover:bg-muted/30 hover:text-rose-300 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Live price chip — uses the shared crypto-stream singleton; for
 *  non-crypto symbols the hook returns null and the row already
 *  rendered "Feed not connected" upstream. */
function LivePrice({ symbol }: { symbol: string }) {
  const t = useCryptoTickerForPair(symbol)
  if (!t) {
    return <span className="text-[10px] text-muted-foreground">Connecting…</span>
  }
  const up = t.changePct >= 0
  return (
    <span className="flex items-baseline gap-1.5 tabular-nums">
      <span className="text-xs font-semibold">
        ${t.price >= 1000 ? t.price.toLocaleString('en-US', { maximumFractionDigits: 0 })
                          : t.price.toLocaleString('en-US', { maximumFractionDigits: 4 })}
      </span>
      <span className={cn('text-[10px] font-bold', up ? 'text-emerald-400' : 'text-rose-400')}>
        {up ? '+' : ''}{t.changePct.toFixed(2)}%
      </span>
    </span>
  )
}
