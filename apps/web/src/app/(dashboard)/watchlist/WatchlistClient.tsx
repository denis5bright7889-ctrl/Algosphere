'use client'

import { useMemo, useState, useTransition } from 'react'
import { Plus, X, Radio, CircleSlash } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCryptoTickerForPair } from '@/components/market/useCryptoTickers'
import { useInstrumentQuotes } from '@/components/market/useInstrumentQuotes'
import type { UniverseQuote } from '@/lib/quotes'

type ProviderName = 'crypto-stream' | 'twelvedata' | 'finnhub' | null

interface UniInstrument {
  symbol:   string
  label:    string
  group:    string | null
  provider: ProviderName
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

  // Symbols served by /api/quotes (Twelve Data + Finnhub). Crypto rows
  // tick from the WS singleton and are excluded here.
  const restSymbols = useMemo(
    () => items
      .map((it) => lookup.get(it.symbol)?.provider)
      .map((p, i) => (p === 'twelvedata' || p === 'finnhub') ? items[i]!.symbol : null)
      .filter((x): x is string => x !== null),
    [items, lookup],
  )
  const { quotes, providers } = useInstrumentQuotes(restSymbols)

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
              // A category is "live" in the picker when any instrument
              // declares a provider AND that provider is keyed server-side.
              const liveClass = c.instruments.some((i) =>
                i.provider === 'crypto-stream'
                || (i.provider === 'twelvedata' && providers.twelvedata)
                || (i.provider === 'finnhub' && providers.finnhub),
              )
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
            const provider: ProviderName = meta?.provider ?? null
            // Effective live = provider declared AND configured server-side.
            // For crypto-stream we treat configured as always true (no key
            // required — public WS); for TD/Finnhub we read the meta from
            // /api/quotes.
            const configured =
              provider === 'crypto-stream' ? true
              : provider === 'twelvedata'  ? providers.twelvedata
              : provider === 'finnhub'     ? providers.finnhub
              : false
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
                    {provider === 'crypto-stream' ? (
                      <CryptoPrice symbol={it.symbol} />
                    ) : configured ? (
                      <RestPrice quote={quotes.get(it.symbol)} />
                    ) : (
                      <span
                        title={provider
                          ? `${provider} API key not configured on the server`
                          : 'No provider declared for this asset class yet'}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                      >
                        <CircleSlash className="h-3 w-3" strokeWidth={2} aria-hidden />
                        Feed not connected
                      </span>
                    )}
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

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (p >= 1)    return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return p.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

/** Live crypto chip — reads the shared crypto-stream WS singleton. */
function CryptoPrice({ symbol }: { symbol: string }) {
  const t = useCryptoTickerForPair(symbol)
  if (!t) return <span className="text-[10px] text-muted-foreground">Connecting…</span>
  const up = t.changePct >= 0
  return (
    <span className="flex items-baseline gap-1.5 tabular-nums">
      <span className="text-xs font-semibold">${fmtPrice(t.price)}</span>
      <span className={cn('text-[10px] font-bold', up ? 'text-emerald-400' : 'text-rose-400')}>
        {up ? '+' : ''}{t.changePct.toFixed(2)}%
      </span>
    </span>
  )
}

/** Non-crypto price chip — reads a polled REST quote from /api/quotes.
 *  No quote yet → "fetching…" (transient: the hook polls every 15s).
 *  The provider's source label is surfaced via title for transparency. */
function RestPrice({ quote }: { quote: UniverseQuote | undefined }) {
  if (!quote) {
    return <span className="text-[10px] text-muted-foreground">fetching…</span>
  }
  const up = quote.changePct >= 0
  return (
    <span
      title={`Source: ${quote.source} · ${new Date(quote.fetchedAt).toLocaleTimeString()}`}
      className="flex items-baseline gap-1.5 tabular-nums"
    >
      <span className="text-xs font-semibold">${fmtPrice(quote.price)}</span>
      <span className={cn('text-[10px] font-bold', up ? 'text-emerald-400' : 'text-rose-400')}>
        {up ? '+' : ''}{quote.changePct.toFixed(2)}%
      </span>
    </span>
  )
}
