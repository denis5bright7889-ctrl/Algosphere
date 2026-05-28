'use client'

/**
 * Markets Explorer client table.
 *
 * Dense terminal-grade table over the symbol registry. Search + asset-class
 * tabs + liquidity / volatility / risk / chart / signal filters, sortable
 * columns, real engine regime overlay (server-supplied — unscanned rows are
 * "—", never imagined). Open Chart per row launches the global modal.
 *
 * No virtualisation yet — registry is ~70 instruments. When the catalog
 * crosses ~500 rows we'll swap in react-virtual without changing the API.
 */
import { useMemo, useState } from 'react'
import { Search, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SymbolMeta, LiquidityTier, VolatilityTier, RiskProfile } from '@/lib/symbol-registry'
import type { AssetClass } from '@/lib/market-universe'
import {
  filterSymbols, sortSymbols, distinctSectors,
  type SortKey, type SortDir, type SymbolFilter,
} from '@/lib/symbol-filters'
import { ASSET_CLASS_LABEL, ASSET_CLASS_ORDER } from '@/lib/symbol-groups'
import { marketState, confidencePct, stateTone } from '@/lib/market-language'
import { OpenChartButton } from '@/components/charts'

export interface RegimeRow { regime: string; der_score: number; scanned_at: string }

export default function MarketsExplorer({
  registry, regimes,
}: {
  registry: SymbolMeta[]
  regimes:  Record<string, RegimeRow>
}) {
  const [filter, setFilter] = useState<SymbolFilter>({ assetClass: 'all' })
  const [sortKey, setSortKey] = useState<SortKey>('liquidity')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const filtered = useMemo(() => filterSymbols(registry, filter), [registry, filter])
  const sorted   = useMemo(() => sortSymbols(filtered, sortKey, sortDir), [filtered, sortKey, sortDir])
  const sectors  = useMemo(() => distinctSectors(registry), [registry])

  const set = (patch: Partial<SymbolFilter>) => setFilter((f) => ({ ...f, ...patch }))

  // Asset-class tab counts — total visible per class, ignoring the current class filter.
  const counts = useMemo(() => {
    const base = filterSymbols(registry, { ...filter, assetClass: 'all' })
    const c: Record<string, number> = { all: base.length }
    for (const r of base) c[r.asset_class] = (c[r.asset_class] ?? 0) + 1
    return c
  }, [registry, filter])

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  return (
    <div className="space-y-4">
      {/* Search + filter row */}
      <section className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3">
            <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            <input
              value={filter.query ?? ''}
              onChange={(e) => set({ query: e.target.value })}
              placeholder="Search symbol, name, sector, tag…"
              aria-label="Search symbols"
              className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          <Select label="Liquidity"  value={filter.liquidity  ?? 'all'} onChange={(v) => set({ liquidity:  v as LiquidityTier  | 'all' })}
                  options={[['all', 'All'], ['T1', 'T1'], ['T2', 'T2'], ['T3', 'T3']]} />
          <Select label="Volatility" value={filter.volatility ?? 'all'} onChange={(v) => set({ volatility: v as VolatilityTier | 'all' })}
                  options={[['all', 'All'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']]} />
          <Select label="Risk"       value={filter.risk       ?? 'all'} onChange={(v) => set({ risk:       v as RiskProfile    | 'all' })}
                  options={[['all', 'All'], ['core', 'Core'], ['standard', 'Std'], ['speculative', 'Spec']]} />
          <Select label="Sector"     value={filter.sector     ?? 'all'} onChange={(v) => set({ sector: v })}
                  options={[['all', 'All'] as [string, string], ...sectors.map((s) => [s, s] as [string, string])]} />
          <ToggleChip label="Chartable"  on={!!filter.chartOnly}  onClick={() => set({ chartOnly:  !filter.chartOnly })} />
          <ToggleChip label="Scanned"    on={!!filter.signalOnly} onClick={() => set({ signalOnly: !filter.signalOnly })} />
        </div>

        {/* Asset class tabs */}
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-2.5">
          <Tab on={(filter.assetClass ?? 'all') === 'all'} onClick={() => set({ assetClass: 'all' })}
               label="All" count={counts.all ?? 0} />
          {ASSET_CLASS_ORDER.map((a) => (
            <Tab key={a} on={filter.assetClass === a} onClick={() => set({ assetClass: a })}
                 label={ASSET_CLASS_LABEL[a]} count={counts[a] ?? 0} />
          ))}
        </div>
      </section>

      {/* Table */}
      <section className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b border-border/60 bg-background/30 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <tr>
                <Th sortable onClick={() => toggleSort('symbol')}      active={sortKey === 'symbol'}     dir={sortDir} label="Symbol" />
                <Th label="Name" className="hidden md:table-cell" />
                <Th sortable onClick={() => toggleSort('asset')}       active={sortKey === 'asset'}      dir={sortDir} label="Class" />
                <Th sortable onClick={() => toggleSort('sector')}      active={sortKey === 'sector'}     dir={sortDir} label="Sector" className="hidden lg:table-cell" />
                <Th sortable onClick={() => toggleSort('liquidity')}   active={sortKey === 'liquidity'}  dir={sortDir} label="Liq" />
                <Th sortable onClick={() => toggleSort('volatility')}  active={sortKey === 'volatility'} dir={sortDir} label="Vol" />
                <Th label="Regime" className="hidden sm:table-cell" />
                <Th label="Conf"   className="hidden sm:table-cell" />
                <Th label="Risk"   className="hidden lg:table-cell" />
                <Th label="" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-xs text-muted-foreground">No symbols match.</td></tr>
              ) : (
                sorted.map((m) => <Row key={m.symbol} meta={m} reg={regimes[m.symbol]} />)
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
          {sorted.length} of {registry.length} instruments · static catalog (registry); regime overlay is live engine data
        </div>
      </section>
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────

function Row({ meta, reg }: { meta: SymbolMeta; reg?: RegimeRow }) {
  const state = reg ? marketState(reg.regime) : null
  const conf  = reg ? confidencePct(reg.der_score) : null

  // Map our asset_class to the AssetClass type the Open Chart button expects.
  // Both use the same string union, so it's an identity cast.
  const ac = meta.asset_class as AssetClass

  return (
    <tr className="border-b border-border/30 last:border-0 hover:bg-background/30">
      <td className="px-3 py-2 font-mono text-xs font-semibold">{meta.symbol}</td>
      <td className="hidden truncate px-3 py-2 text-xs text-muted-foreground md:table-cell">{meta.display_name}</td>
      <td className="px-3 py-2"><AssetChip ac={ac} /></td>
      <td className="hidden px-3 py-2 text-xs text-muted-foreground lg:table-cell">{meta.sector ?? '—'}</td>
      <td className="px-3 py-2"><LiqChip tier={meta.liquidity_tier} /></td>
      <td className="px-3 py-2"><VolChip tier={meta.volatility_tier} /></td>
      <td className="hidden px-3 py-2 sm:table-cell">
        {state ? (
          <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', stateTone(state))}>
            {state}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="hidden px-3 py-2 tabular-nums sm:table-cell">
        {conf == null ? <span className="text-xs text-muted-foreground">—</span> : <span className="text-xs font-semibold">{conf}</span>}
      </td>
      <td className="hidden px-3 py-2 lg:table-cell"><RiskChip risk={meta.risk_profile} /></td>
      <td className="px-3 py-2 text-right">
        {meta.chart_supported ? (
          <OpenChartButton symbol={meta.symbol} assetClass={ac} variant="icon" />
        ) : (
          <span title="No TradingView feed for this instrument" className="inline-block h-6 w-6" />
        )}
      </td>
    </tr>
  )
}

// ── Chips & controls ─────────────────────────────────────────────────────

function AssetChip({ ac }: { ac: AssetClass }) {
  return (
    <span className="rounded-md border border-border/60 bg-muted/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {ASSET_CLASS_LABEL[ac]}
    </span>
  )
}
function LiqChip({ tier }: { tier: LiquidityTier }) {
  const tone = tier === 'T1' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
             : tier === 'T2' ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
             : 'border-border bg-muted/20 text-muted-foreground'
  return <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', tone)}>{tier}</span>
}
function VolChip({ tier }: { tier: VolatilityTier }) {
  const tone = tier === 'high'   ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
             : tier === 'medium' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
             : 'border-border bg-muted/20 text-muted-foreground'
  const label = tier === 'low' ? 'Low' : tier === 'medium' ? 'Med' : 'High'
  return <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold', tone)}>{label}</span>
}
function RiskChip({ risk }: { risk: RiskProfile }) {
  const tone = risk === 'core' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
             : risk === 'standard' ? 'border-border bg-muted/20 text-muted-foreground'
             : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
  const label = risk === 'core' ? 'Core' : risk === 'standard' ? 'Std' : 'Spec'
  return <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold', tone)}>{label}</span>
}

function Th({
  label, sortable, active, dir, onClick, className,
}: {
  label: string; sortable?: boolean; active?: boolean; dir?: SortDir
  onClick?: () => void; className?: string
}) {
  return (
    <th className={cn('px-3 py-2 text-left', className)}>
      {sortable ? (
        <button type="button" onClick={onClick}
                className={cn('inline-flex items-center gap-1 transition-colors', active ? 'text-amber-300' : 'hover:text-foreground')}>
          {label}
          <ArrowUpDown className={cn('h-3 w-3', active ? 'opacity-100' : 'opacity-40')} aria-hidden />
          {active && <span className="sr-only">{dir === 'asc' ? 'ascending' : 'descending'}</span>}
        </button>
      ) : label}
    </th>
  )
}

function Tab({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
              on ? 'bg-gradient-primary text-black shadow-glow-gold'
                 : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
            )}>
      {label}
      <span className={cn('ml-1 tabular-nums', on ? 'text-black/60' : 'text-muted-foreground/60')}>{count}</span>
    </button>
  )
}

function ToggleChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
            className={cn(
              'rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors',
              on ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                 : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground',
            )}>
      {label}
    </button>
  )
}

function Select({
  label, value, options, onChange,
}: {
  label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-2 py-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-[11px] font-semibold outline-none"
      >
        {options.map(([v, l]) => <option key={v} value={v} className="bg-background text-foreground">{l}</option>)}
      </select>
    </label>
  )
}
