'use client'

import { useMemo, useState } from 'react'
import { Radio, CircleSlash, BrainCircuit, Sparkles, Waves } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCryptoTickerForPair } from './useCryptoTickers'
import { useInstrumentQuotes } from './useInstrumentQuotes'
import RegimeBadge from '@/components/algo/RegimeBadge'
import type { UniverseQuote } from '@/lib/quotes'

type RegimeMap = Record<string, { regime: string; score: number | null }>

/** Categorical regime tally — computed from real snapshots, never guessed. */
function regimeMix(symbols: string[], rm: RegimeMap) {
  let up = 0, down = 0, range = 0, vol = 0, scanned = 0
  for (const s of symbols) {
    const r = rm[s]
    if (!r) continue
    scanned++
    const g = (r.regime ?? '').toLowerCase()
    if (g.includes('up') || g.includes('bull')) up++
    else if (g.includes('down') || g.includes('bear')) down++
    else if (g.includes('range') || g.includes('mean')) range++
    else if (g.includes('vol') || g.includes('exhaust')) vol++
  }
  const bias =
    scanned === 0 ? { label: 'No scan', tone: 'muted' as const }
    : up > down && up >= range ? { label: 'Risk-On', tone: 'live' as const }
    : down > up && down >= range ? { label: 'Risk-Off', tone: 'warn' as const }
    : range >= up && range >= down ? { label: 'Ranging', tone: 'muted' as const }
    : { label: 'Mixed', tone: 'warn' as const }
  return { up, down, range, vol, scanned, bias }
}

type Provider = 'crypto-stream' | 'twelvedata' | 'finnhub' | null

interface Instrument {
  symbol:   string
  label:    string
  group:    string | null
  provider: Provider
}
interface Category {
  assetClass: string
  label:      string
  blurb:      string
  instruments: Instrument[]
}

/**
 * Segmented multi-asset intelligence hub. One route, category tabs
 * switch the whole working set (instruments + live state) with no
 * navigation. Honest by construction: only real universe classes are
 * tabs, and a price renders only where a feed truly exists — otherwise
 * "Feed not connected", never a fabricated quote.
 */
export default function MarketHub({
  universe, regimeBySymbol = {},
}: {
  universe: Category[]
  regimeBySymbol?: RegimeMap
}) {
  const [active, setActive] = useState(universe[0]?.assetClass ?? '')
  const cat = universe.find((c) => c.assetClass === active) ?? universe[0]

  // REST-served symbols for the *active* tab only — keeps polling tight.
  const restSymbols = useMemo(
    () =>
      (cat?.instruments ?? [])
        .filter((i) => i.provider === 'twelvedata' || i.provider === 'finnhub')
        .map((i) => i.symbol),
    [cat],
  )
  const { quotes, providers } = useInstrumentQuotes(restSymbols)

  if (!cat) return null

  const liveCount = cat.instruments.filter((i) =>
    i.provider === 'crypto-stream'
    || (i.provider === 'twelvedata' && providers.twelvedata)
    || (i.provider === 'finnhub' && providers.finnhub),
  ).length
  const isLive = liveCount > 0

  const symbols = cat.instruments.map((i) => i.symbol)
  const mix = regimeMix(symbols, regimeBySymbol)
  const scannedInstruments = cat.instruments.filter((i) => regimeBySymbol[i.symbol])
  const narrative =
    mix.scanned === 0
      ? `No regime scan has covered ${cat.label} instruments yet — intelligence appears once the engine publishes a pass for this class.`
      : `${cat.label}: ${mix.scanned}/${cat.instruments.length} instruments scanned · engine bias ${mix.bias.label}` +
        ` (${mix.up} up · ${mix.down} down · ${mix.range} ranging${mix.vol ? ` · ${mix.vol} volatile` : ''}).` +
        (mix.vol >= 2 ? ' Elevated volatility cluster — size down and widen stops.' : '')
  const isCrypto = cat.assetClass === 'crypto'

  return (
    <section className="surface overflow-hidden">
      {/* Tab rail — horizontally scrollable, thumb-friendly on mobile */}
      <div className="flex gap-1 overflow-x-auto border-b border-border/60 p-2">
        {universe.map((c) => {
          const on = c.assetClass === active
          return (
            <button
              key={c.assetClass}
              type="button"
              onClick={() => setActive(c.assetClass)}
              aria-current={on ? 'true' : undefined}
              className={cn(
                'shrink-0 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors',
                on
                  ? 'bg-gradient-primary text-black shadow-glow-gold'
                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
              )}
            >
              {c.label}
              <span className={cn('ml-1.5 tabular-nums', on ? 'text-black/60' : 'text-muted-foreground/60')}>
                {c.instruments.length}
              </span>
            </button>
          )
        })}
      </div>

      {/* Active category panel */}
      <div className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight">{cat.label}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{cat.blurb}</p>
          </div>
          <span
            className={cn(
              'shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
              isLive
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-border bg-muted/30 text-muted-foreground',
            )}
          >
            {isLive ? (
              <><Radio className="h-2.5 w-2.5 animate-pulse-soft" strokeWidth={2.5} aria-hidden /> Live · {liveCount}/{cat.instruments.length}</>
            ) : (
              <><CircleSlash className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden /> Feed not connected</>
            )}
          </span>
        </div>

        {/* Intelligence band — computed from real regime snapshots */}
        <div className="mb-4 rounded-xl border border-border/60 bg-background/40 p-4">
          <div className="mb-2 flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-amber-300/90" strokeWidth={1.75} aria-hidden />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              AI Market Narrative
            </span>
            <span
              className={cn(
                'ml-auto rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                mix.bias.tone === 'live' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : mix.bias.tone === 'warn' ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-border bg-muted/30 text-muted-foreground',
              )}
            >
              {mix.bias.label}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">{narrative}</p>

          {scannedInstruments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/50 pt-3">
              {scannedInstruments.slice(0, 12).map((i) => (
                <span key={i.symbol} className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-2 py-1">
                  <span className="font-mono text-[10px] font-semibold">{i.symbol}</span>
                  <RegimeBadge regime={regimeBySymbol[i.symbol]!.regime} compact />
                </span>
              ))}
            </div>
          )}

          {isCrypto && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border/50 pt-3 text-[11px]">
              <span className="text-muted-foreground">On-chain decision layers:</span>
              <a href="/intelligence/smart-money" className="inline-flex items-center gap-1 font-medium text-amber-300 hover:underline">
                <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden /> Smart Money
              </a>
              <a href="/intelligence/whale-flows" className="inline-flex items-center gap-1 font-medium text-amber-300 hover:underline">
                <Waves className="h-3 w-3" strokeWidth={2} aria-hidden /> Whale Flows
              </a>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cat.instruments.map((i) => (
            <div
              key={i.symbol}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/40 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{i.label}</p>
                <p className="font-mono text-[10px] text-muted-foreground/70">{i.symbol}</p>
              </div>
              <PriceChip instrument={i} quote={quotes.get(i.symbol)} providers={providers} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (p >= 1)    return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return p.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function PriceChip({
  instrument, quote, providers,
}: {
  instrument: Instrument
  quote: UniverseQuote | undefined
  providers: { twelvedata: boolean; finnhub: boolean }
}) {
  if (instrument.provider === 'crypto-stream') {
    return <CryptoPrice symbol={instrument.symbol} />
  }
  const configured =
    instrument.provider === 'twelvedata' ? providers.twelvedata
    : instrument.provider === 'finnhub'  ? providers.finnhub
    : false

  if (!configured) {
    return (
      <span
        title={instrument.provider
          ? `${instrument.provider} feed not connected on the server`
          : 'No provider for this asset class yet'}
        className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
      >
        <CircleSlash className="h-3 w-3" strokeWidth={2} aria-hidden />
        Not connected
      </span>
    )
  }
  if (!quote) return <span className="shrink-0 text-[10px] text-muted-foreground">fetching…</span>
  return <Quote price={quote.price} changePct={quote.changePct} />
}

function CryptoPrice({ symbol }: { symbol: string }) {
  const t = useCryptoTickerForPair(symbol)
  if (!t) return <span className="shrink-0 text-[10px] text-muted-foreground">Connecting…</span>
  return <Quote price={t.price} changePct={t.changePct} />
}

function Quote({ price, changePct }: { price: number; changePct: number }) {
  const up = changePct >= 0
  return (
    <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
      <span className="text-sm font-semibold">${fmtPrice(price)}</span>
      <span className={cn('text-[10px] font-bold', up ? 'text-emerald-400' : 'text-rose-400')}>
        {up ? '+' : ''}{changePct.toFixed(2)}%
      </span>
    </span>
  )
}
