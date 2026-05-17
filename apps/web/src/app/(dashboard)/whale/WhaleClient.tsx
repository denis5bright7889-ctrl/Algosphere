'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  TrendingUp, TrendingDown, ArrowDownUp, RefreshCw, AlertTriangle, ExternalLink, Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NansenToken } from '@/lib/nansen'

interface Props {
  initial:       NansenToken[]
  initialError:  string | null
}

const CHAINS = ['ethereum', 'solana', 'base'] as const
const TFS    = [
  { key: '24h', label: '24h' },
  { key: '7d',  label: '7d'  },
] as const
const SORTS = [
  { key: 'buy_volume',     label: 'Buy Volume' },
  { key: 'volume',         label: 'Total Volume' },
  { key: 'netflow',        label: 'Netflow' },
  { key: 'price_change',   label: '% Change' },
  { key: 'market_cap_usd', label: 'Market Cap' },
] as const

type Chain = typeof CHAINS[number]
type Timeframe = typeof TFS[number]['key']
type Sort = typeof SORTS[number]['key']

const CHAIN_CLS: Record<Chain, string> = {
  ethereum: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  solana:   'border-violet-500/40 bg-violet-500/10 text-violet-300',
  base:     'border-sky-500/40 bg-sky-500/10 text-sky-300',
}

const CHAIN_EXPLORER: Record<string, (addr: string) => string> = {
  ethereum: (a) => `https://etherscan.io/token/${a}`,
  base:     (a) => `https://basescan.org/token/${a}`,
  solana:   (a) => `https://solscan.io/token/${a}`,
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
  return `$${n.toFixed(abs < 1 ? 4 : 2)}`
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n < 0.0001) return `$${n.toExponential(2)}`
  if (n < 1)     return `$${n.toFixed(6)}`
  if (n < 100)   return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function pct(ratio: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (!Number.isFinite(ratio)) return { text: '—', tone: 'flat' }
  const p = ratio * 100
  const text = `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`
  return { text, tone: p > 0.5 ? 'up' : p < -0.5 ? 'down' : 'flat' }
}

export default function WhaleClient({ initial, initialError }: Props) {
  const [chains, setChains]       = useState<Chain[]>([...CHAINS])
  const [timeframe, setTimeframe] = useState<Timeframe>('24h')
  const [sort, setSort]           = useState<Sort>('buy_volume')
  const [rows, setRows]           = useState<NansenToken[]>(initial)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(initialError)

  // Re-fetch from /api/market/whale on any filter change.
  useEffect(() => {
    const qs = new URLSearchParams({
      chains: chains.join(','),
      timeframe,
      order: sort,
      dir: 'DESC',
      limit: '50',
    })
    setLoading(true)
    setError(null)
    fetch(`/api/market/whale?${qs.toString()}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
        return d
      })
      .then((d) => setRows(Array.isArray(d.data) ? d.data : []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [chains, timeframe, sort])

  const toggleChain = (c: Chain) => {
    setChains((prev) =>
      prev.includes(c) && prev.length > 1
        ? prev.filter((x) => x !== c)
        : prev.includes(c) ? prev : [...prev, c],
    )
  }

  const hasRows = rows.length > 0

  // Initial banner if SSR returned an error (e.g. NANSEN_API_KEY missing)
  // — only surface BEFORE the user has triggered a fetch.
  const banner = useMemo(() => {
    if (!error) return null
    return (
      <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span>{error}</span>
      </div>
    )
  }, [error])

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 glass p-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">Chain</span>
        {CHAINS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => toggleChain(c)}
            // eslint-disable-next-line jsx-a11y/aria-proptypes
            aria-pressed={chains.includes(c)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors',
              chains.includes(c)
                ? CHAIN_CLS[c]
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {c}
          </button>
        ))}

        <span className="ml-2 hidden sm:inline text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">Window</span>
        <div className="inline-flex gap-1">
          {TFS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTimeframe(t.key)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                timeframe === t.key
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ArrowDownUp className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort by"
            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] focus:outline-none focus:border-amber-500/40"
          >
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      {banner}

      {/* Empty / loading state */}
      {!hasRows && !loading && !error && (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No smart-money flows match these filters.
        </div>
      )}

      {/* Mobile cards */}
      {hasRows && (
        <ul className="space-y-2 md:hidden">
          {rows.map((r) => <MobileRow key={`${r.chain}:${r.token_address}`} r={r} />)}
        </ul>
      )}

      {/* Desktop table */}
      {hasRows && (
        <div className="hidden md:block overflow-hidden rounded-2xl border border-border/70 bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Token</th>
                <th className="px-4 py-2.5 font-medium">Chain</th>
                <th className="px-4 py-2.5 text-right font-medium">Price</th>
                <th className="px-4 py-2.5 text-right font-medium">% Δ</th>
                <th className="px-4 py-2.5 text-right font-medium">Buy Vol</th>
                <th className="px-4 py-2.5 text-right font-medium">Netflow</th>
                <th className="px-4 py-2.5 text-right font-medium">Mkt Cap</th>
                <th className="px-4 py-2.5 text-right font-medium">SM Traders</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <DesktopRow key={`${r.chain}:${r.token_address}`} r={r} />)}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Source: Nansen smart-money screener. Data refreshed at most every minute on the server.
        Categorical signal, not financial advice.
      </p>
    </div>
  )
}

function ChainBadge({ chain }: { chain: string }) {
  const cls = (CHAIN_CLS as Record<string, string>)[chain] ?? 'border-border bg-muted/30 text-muted-foreground'
  return (
    <span className={cn('inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-bold capitalize', cls)}>
      {chain}
    </span>
  )
}

function explorerHref(chain: string, addr: string): string | null {
  return CHAIN_EXPLORER[chain]?.(addr) ?? null
}

function ToneNum({ ratio }: { ratio: number }) {
  const { text, tone } = pct(ratio)
  return (
    <span className={cn(
      'inline-flex items-center gap-1 tabular-nums',
      tone === 'up'   && 'text-emerald-400',
      tone === 'down' && 'text-rose-400',
      tone === 'flat' && 'text-muted-foreground',
    )}>
      {tone === 'up'   && <TrendingUp   className="h-3 w-3" strokeWidth={2} aria-hidden />}
      {tone === 'down' && <TrendingDown className="h-3 w-3" strokeWidth={2} aria-hidden />}
      {text}
    </span>
  )
}

function MobileRow({ r }: { r: NansenToken }) {
  const url = explorerHref(r.chain, r.token_address)
  return (
    <li className="rounded-xl border border-border/70 bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5">
            <span className="font-mono text-sm font-semibold truncate">{r.token_symbol}</span>
            <ChainBadge chain={r.chain} />
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {fmtPrice(r.price_usd)} · <ToneNum ratio={r.price_change} />
          </p>
        </div>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer"
             className="shrink-0 text-muted-foreground hover:text-foreground"
             aria-label="View on explorer">
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </a>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Buy Vol</span>
          <span className="tabular-nums font-semibold text-emerald-300">{fmtUsd(r.buy_volume)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Netflow</span>
          <span className={cn('tabular-nums font-semibold', r.netflow >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
            {r.netflow >= 0 ? '+' : ''}{fmtUsd(r.netflow)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Mkt Cap</span>
          <span className="tabular-nums">{fmtUsd(r.market_cap_usd)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">SM Traders</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Users className="h-3 w-3" strokeWidth={1.75} aria-hidden />
            {r.nof_traders}
          </span>
        </div>
      </div>
    </li>
  )
}

function DesktopRow({ r }: { r: NansenToken }) {
  const url = explorerHref(r.chain, r.token_address)
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-muted/10">
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span className="font-mono font-semibold">{r.token_symbol}</span>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer"
               className="text-muted-foreground hover:text-foreground" aria-label="View on explorer">
              <ExternalLink className="h-3 w-3" strokeWidth={1.75} aria-hidden />
            </a>
          )}
        </span>
      </td>
      <td className="px-4 py-2.5"><ChainBadge chain={r.chain} /></td>
      <td className="px-4 py-2.5 text-right tabular-nums">{fmtPrice(r.price_usd)}</td>
      <td className="px-4 py-2.5 text-right"><ToneNum ratio={r.price_change} /></td>
      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-300">{fmtUsd(r.buy_volume)}</td>
      <td className={cn('px-4 py-2.5 text-right tabular-nums font-semibold', r.netflow >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
        {r.netflow >= 0 ? '+' : ''}{fmtUsd(r.netflow)}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmtUsd(r.market_cap_usd)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{r.nof_traders}</td>
    </tr>
  )
}
