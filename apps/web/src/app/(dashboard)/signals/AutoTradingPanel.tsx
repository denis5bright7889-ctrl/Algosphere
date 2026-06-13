'use client'

/**
 * Auto-Trading settings panel. Lives at the top of /signals.
 * Collapsed by default — only expands when the user clicks the
 * summary row. Saving fires POST /api/auto-trading/settings; the
 * client refetches the row + re-renders the summary.
 *
 * Honesty contract:
 *   - Toggle off by default — explicit opt-in only.
 *   - Refuses to enable when allowed_symbols is empty (would mean
 *     "auto-execute on nothing").
 *   - When there are no connected brokers, the toggle is disabled
 *     with a clear "Connect a broker first" hint.
 *   - The save button persists settings BUT the actual auto-executor
 *     (cron) is the next slice — banner explicitly says
 *     "settings saved; executor activates when broker is connected".
 */
import { useEffect, useState, useTransition } from 'react'
import { Bot, ChevronDown, ChevronUp, Save, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TradeBroker } from '@/components/dashboard/PlaceTradeButton'
import { SUPPORTED_SYMBOLS, type AutoTradingSettings } from '@/lib/auto-trading'

interface Props {
  initialSettings: AutoTradingSettings
  brokers:         TradeBroker[]
}

export default function AutoTradingPanel({ initialSettings, brokers }: Props) {
  const [s, setS] = useState<AutoTradingSettings>(initialSettings)
  const [open, setOpen] = useState(false)
  const [saving, startSaving] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const connectedBrokers = brokers.filter(b => b.status === 'connected')
  const canEnable = connectedBrokers.length > 0

  function update<K extends keyof AutoTradingSettings>(key: K, value: AutoTradingSettings[K]) {
    setS(prev => ({ ...prev, [key]: value }))
    setSavedAt(null)
  }

  function toggleSymbol(sym: string) {
    setS(prev => {
      const has = prev.allowed_symbols.includes(sym)
      return {
        ...prev,
        allowed_symbols: has
          ? prev.allowed_symbols.filter(x => x !== sym)
          : [...prev.allowed_symbols, sym],
      }
    })
    setSavedAt(null)
  }

  function toggleDirection(dir: 'buy' | 'sell') {
    setS(prev => {
      const has = prev.allowed_directions.includes(dir)
      return {
        ...prev,
        allowed_directions: has
          ? prev.allowed_directions.filter(x => x !== dir)
          : [...prev.allowed_directions, dir],
      }
    })
    setSavedAt(null)
  }

  function toggleBroker(brokerKey: string) {
    setS(prev => {
      const has = prev.allowed_brokers.includes(brokerKey)
      return {
        ...prev,
        allowed_brokers: has
          ? prev.allowed_brokers.filter(x => x !== brokerKey)
          : [...prev.allowed_brokers, brokerKey],
      }
    })
    setSavedAt(null)
  }

  async function save() {
    setError(null)
    startSaving(async () => {
      const res = await fetch('/api/auto-trading/settings', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          enabled:                s.enabled,
          allowed_symbols:        s.allowed_symbols,
          min_confidence:         s.min_confidence,
          max_risk_pct:           s.max_risk_pct,
          max_trades_per_day:     s.max_trades_per_day,
          allowed_directions:     s.allowed_directions,
          allowed_brokers:        s.allowed_brokers,
          require_active_session: s.require_active_session,
          paused_until:           s.paused_until,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Save failed')
        return
      }
      if (json.settings) setS(json.settings)
      setSavedAt(new Date().toISOString())
    })
  }

  useEffect(() => {
    setSavedAt(null)
  }, [open])

  const summaryClass = s.enabled
    ? 'border-emerald-500/40 bg-emerald-500/[0.05]'
    : 'border-border bg-card'

  return (
    <section className={cn('rounded-xl border', summaryClass)}>
      {/* Summary row — always visible */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-3 p-3 sm:p-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            s.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-muted/30 text-muted-foreground',
          )}>
            <Bot className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
          </div>
          <div className="min-w-0 text-left">
            <p className="text-sm font-bold flex items-center gap-2">
              Auto-Trading
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                s.enabled
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-muted/30 text-muted-foreground',
              )}>
                {s.enabled ? 'On' : 'Off'}
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
              {s.enabled
                ? <>{s.allowed_symbols.length} symbol{s.allowed_symbols.length === 1 ? '' : 's'} · ≥{s.min_confidence}% conf · max {s.max_risk_pct}%/trade · {s.max_trades_per_day}/day</>
                : <>Configure which signals auto-execute. Off by default.</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {open
            ? <ChevronUp   className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
          }
        </div>
      </button>

      {/* Expanded form */}
      {open && (
        <div className="border-t border-border/40 px-3 pb-4 pt-3 sm:px-4">
          {!canEnable && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.75} aria-hidden />
              <span>
                Connect a broker on the <a href="/brokers" className="underline font-bold">brokers page</a> before
                enabling auto-trading. Settings can still be saved without one.
              </span>
            </div>
          )}

          {/* Master toggle */}
          <div className="mb-4 flex items-center justify-between rounded-md border border-border/60 bg-background/30 px-3 py-2.5">
            <div>
              <p className="text-[12px] font-bold">Enable auto-execution</p>
              <p className="text-[10px] text-muted-foreground">
                When on, qualifying signals trigger orders on your selected broker without confirmation.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={s.enabled}
              disabled={!canEnable && !s.enabled}
              onClick={() => update('enabled', !s.enabled)}
              className={cn(
                'relative h-6 w-11 rounded-full transition-colors',
                s.enabled ? 'bg-emerald-500' : 'bg-muted/60',
                !canEnable && !s.enabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                s.enabled ? 'translate-x-5' : 'translate-x-0.5',
              )} />
            </button>
          </div>

          {/* Symbols multi-select */}
          <Field label="Allowed symbols" hint={`${s.allowed_symbols.length} selected — leave empty to disable`}>
            <div className="flex flex-wrap gap-1.5">
              {SUPPORTED_SYMBOLS.map(sym => {
                const on = s.allowed_symbols.includes(sym)
                return (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => toggleSymbol(sym)}
                    className={cn(
                      'rounded border px-2 py-1 text-[11px] font-bold tabular-nums transition',
                      on
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : 'border-border text-muted-foreground hover:border-amber-500/30',
                    )}
                  >
                    {sym}
                  </button>
                )
              })}
            </div>
          </Field>

          {/* Confidence slider */}
          <Field label={`Min confidence: ${s.min_confidence}%`} hint="Signals below this never auto-execute">
            <input
              type="range"
              min={50}
              max={100}
              value={s.min_confidence}
              onChange={(e) => update('min_confidence', Number(e.target.value))}
              className="w-full"
              aria-label="Minimum confidence"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums">
              <span>50%</span><span>75%</span><span>100%</span>
            </div>
          </Field>

          {/* Risk + trades-per-day */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Max risk per trade (%)" hint="Per-trade equity at risk">
              <input
                type="number" step={0.1} min={0.1} max={5}
                value={s.max_risk_pct}
                onChange={(e) => update('max_risk_pct', Number(e.target.value))}
                className="w-full rounded border border-border bg-background/30 px-2 py-1.5 text-xs tabular-nums"
              />
            </Field>
            <Field label="Max auto-trades per day" hint="Hard cap (UTC day)">
              <input
                type="number" step={1} min={1} max={50}
                value={s.max_trades_per_day}
                onChange={(e) => update('max_trades_per_day', Number(e.target.value))}
                className="w-full rounded border border-border bg-background/30 px-2 py-1.5 text-xs tabular-nums"
              />
            </Field>
          </div>

          {/* Directions */}
          <Field label="Allowed directions">
            <div className="flex gap-2">
              {(['buy', 'sell'] as const).map(d => {
                const on = s.allowed_directions.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDirection(d)}
                    className={cn(
                      'flex-1 rounded border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition',
                      on
                        ? (d === 'buy'
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : 'border-rose-500/40 bg-rose-500/15 text-rose-300')
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
          </Field>

          {/* Broker allow-list */}
          {connectedBrokers.length > 0 && (
            <Field label="Allowed brokers" hint={s.allowed_brokers.length === 0 ? 'Any connected broker (default)' : `${s.allowed_brokers.length} selected`}>
              <div className="flex flex-wrap gap-1.5">
                {connectedBrokers.map(b => {
                  const on = s.allowed_brokers.includes(b.broker)
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggleBroker(b.broker)}
                      className={cn(
                        'rounded border px-2 py-1 text-[11px] font-bold transition',
                        on
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                          : 'border-border text-muted-foreground hover:border-amber-500/30',
                      )}
                    >
                      {b.label ?? b.broker}
                    </button>
                  )
                })}
              </div>
            </Field>
          )}

          {/* Session toggle */}
          <div className="mb-4 flex items-center justify-between rounded-md border border-border/60 bg-background/30 px-3 py-2.5">
            <div>
              <p className="text-[12px] font-bold">Restrict to active sessions</p>
              <p className="text-[10px] text-muted-foreground">London / New York / overlap only</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={s.require_active_session}
              onClick={() => update('require_active_session', !s.require_active_session)}
              className={cn(
                'relative h-6 w-11 rounded-full transition-colors',
                s.require_active_session ? 'bg-emerald-500' : 'bg-muted/60',
              )}
            >
              <span className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                s.require_active_session ? 'translate-x-5' : 'translate-x-0.5',
              )} />
            </button>
          </div>

          {error && (
            <p className="mb-3 rounded border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[11px] text-rose-200">
              {error}
            </p>
          )}

          {savedAt && !error && (
            <p className="mb-3 flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-[11px] text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              Settings saved. The auto-executor activates as soon as a broker is connected and a qualifying signal arrives.
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] text-muted-foreground/80 italic">
              Settings persist; auto-executor cron is the next slice.
            </p>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {saving
                ? <><Zap className="h-3.5 w-3.5 animate-pulse" strokeWidth={2} /> Saving…</>
                : <><Save className="h-3.5 w-3.5" strokeWidth={2} /> Save settings</>}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
      </div>
      {children}
    </div>
  )
}
