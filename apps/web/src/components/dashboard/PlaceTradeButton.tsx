'use client'

/**
 * PlaceTradeButton — one-click (with confirmation) manual execution of a
 * signal to a connected broker, straight from the signal card. Saves the
 * user from leaving AlgoSphere to re-key the trade at their broker.
 *
 * Safety model (deliberate — this places real orders):
 *   - No connected broker → the button becomes a "Connect broker" link.
 *   - Clicking opens a confirmation sheet showing the EXACT order; nothing
 *     is sent on the first click.
 *   - The user picks which connected broker to route to and the size.
 *   - LIVE (real-money) brokers require a second explicit checkbox before
 *     Confirm enables — a testnet misclick can never hit a live account.
 *   - The server (/api/trade/execute) re-validates the signal + broker
 *     ownership and hands off to the engine's risk firewall. This UI never
 *     trusts itself with execution.
 */

import { useEffect, useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { Zap, AlertTriangle, CheckCircle2, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { showToast } from '@/lib/toast'

export interface TradeBroker {
  id:         string
  broker:     string
  label:      string | null
  is_live:    boolean
  is_testnet: boolean
  status:     string
}

export interface TradeSignal {
  id:            string
  pair:          string
  direction:     'buy' | 'sell'
  entry_price:   number | null
  stop_loss:     number | null
  take_profit_1: number | null
}

type Outcome =
  | { kind: 'filled' | 'submitted'; brokerOrderId: string | null; price: number | null }
  | { kind: 'rejected'; reason: string }

export default function PlaceTradeButton({ signal, brokers }: {
  signal: TradeSignal; brokers: TradeBroker[]
}) {
  const [open, setOpen] = useState(false)
  const connected = brokers.filter((b) => b.status === 'connected')

  // Deep-link auto-open: when a user lands on /signals?execute=<id>
  // (typically by clicking "⚡ Take trade" in a Telegram signal card),
  // pop the confirm sheet automatically for the matching signal. This
  // is the Telegram → web handoff: from message to confirm-screen in
  // a single tap. Only fires when there's at least one connected
  // broker to route the order through.
  const params = useSearchParams()
  useEffect(() => {
    if (params?.get('execute') === signal.id && connected.length > 0) {
      setOpen(true)
    }
    // signal.id + connected.length only — re-running when the URL
    // updates is intentional and harmless (setOpen(true) is idempotent).
  }, [params, signal.id, connected.length])

  // No broker to route to → point the user at the connect flow instead of
  // dangling a dead button.
  if (connected.length === 0) {
    return (
      <a
        href="/brokers"
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-300"
      >
        <Zap className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> Connect a broker to trade
      </a>
    )
  }

  const isBuy = signal.direction === 'buy'
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition',
          isBuy ? 'bg-gradient-emerald hover:opacity-90' : 'bg-gradient-rose hover:opacity-90',
        )}
      >
        <Zap className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
        Place {signal.direction.toUpperCase()} trade
      </button>
      {open && (
        <ConfirmSheet
          signal={signal}
          brokers={connected}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function ConfirmSheet({ signal, brokers, onClose }: {
  signal: TradeSignal; brokers: TradeBroker[]; onClose: () => void
}) {
  const [brokerId, setBrokerId] = useState(brokers[0]?.id ?? '')
  const [size, setSize]         = useState('')
  const [riskPct, setRiskPct]   = useState('1')
  const [equity, setEquity]     = useState('10000')
  const [liveAck, setLiveAck]   = useState(false)
  const [pending, start]        = useTransition()
  const [error, setError]       = useState<string | null>(null)
  const [outcome, setOutcome]   = useState<Outcome | null>(null)

  // Estimated size from risk-% mode. Honest approximation:
  //   risk_$ = equity × pct
  //   stop_$_per_unit = |entry − stop|
  //   units = risk_$ / stop_$_per_unit
  // Real lot sizing depends on the broker's contract size + pip
  // value — the engine's risk firewall normalises on the other side;
  // this is the user-facing estimate they'll edit if they want.
  const riskEstimate = computeRiskSize({
    equity:  Number(equity),
    riskPct: Number(riskPct),
    entry:   signal.entry_price,
    stop:    signal.stop_loss,
  })

  // Parent only mounts this sheet when there is ≥1 connected broker, so
  // the fallback to brokers[0] keeps `broker` defined for the type system.
  const broker = brokers.find((b) => b.id === brokerId) ?? brokers[0]
  const sizeNum = Number(size)
  const sizeValid = Number.isFinite(sizeNum) && sizeNum > 0
  const needsLiveAck = broker?.is_live ?? false
  const canSubmit = sizeValid && (!needsLiveAck || liveAck) && !pending

  function submit() {
    if (!canSubmit) return
    setError(null)
    start(async () => {
      // Hard ceiling so the button can never spin forever — if the
      // engine or broker hangs, surface a clear error and let the user
      // retry or cancel. 30s is generous; MT5 bridge round-trips
      // usually complete in under 3s.
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), 30_000)
      try {
        const res = await fetch('/api/trade/execute', {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
          signal:  ctrl.signal,
          body: JSON.stringify({
            signalId:           signal.id,
            brokerConnectionId: brokerId,
            size:               sizeNum,
            confirmLive:        needsLiveAck ? true : undefined,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const msg = data.error ?? `Failed (HTTP ${res.status})`
          setError(msg)
          // Surface as a toast so the user sees the failure even if
          // they close the sheet immediately.
          showToast({
            id:    `order:${signal.id}`,
            tone:  'error',
            title: `${signal.pair} ${signal.direction.toUpperCase()} — order failed`,
            body:  msg,
          })
          return
        }
        const r = data.result as { status: string; broker_order_id: string | null; filled_price: number | null; reason: string | null }
        if (r.status === 'rejected') {
          setOutcome({ kind: 'rejected', reason: r.reason ?? 'Order rejected by the risk engine.' })
          showToast({
            id:    `order:${signal.id}`,
            tone:  'warn',
            title: `${signal.pair} ${signal.direction.toUpperCase()} — rejected`,
            body:  r.reason ?? 'Order rejected by the risk engine.',
            link:  { href: '/brokers', label: 'Open Brokers page' },
          })
        } else {
          const filled = r.status === 'filled'
          setOutcome({ kind: filled ? 'filled' : 'submitted', brokerOrderId: r.broker_order_id, price: r.filled_price })
          showToast({
            id:    `order:${signal.id}`,
            tone:  'success',
            title: `${signal.pair} ${signal.direction.toUpperCase()} — ${filled ? 'filled' : 'submitted'}`,
            body:  [
              r.filled_price != null ? `Fill price ${r.filled_price}` : null,
              r.broker_order_id      ? `Ref ${r.broker_order_id}`     : null,
            ].filter(Boolean).join(' · '),
            link:  { href: '/brokers', label: 'View positions on Brokers' },
            ttlMs: 12_000,
          })
        }
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') {
          setError('Timed out after 30s — the broker did not respond. Check the brokers page for connection status before retrying.')
        } else {
          setError('Network error — order not confirmed.')
        }
      } finally {
        clearTimeout(timeout)
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">Confirm order</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {outcome ? (
          <OutcomeView outcome={outcome} onClose={onClose} />
        ) : (
          <>
            {/* Order summary — exactly what will be sent. */}
            <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-base font-bold">{signal.pair}</span>
                <span className={cn(
                  'rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white',
                  signal.direction === 'buy' ? 'bg-gradient-emerald' : 'bg-gradient-rose',
                )}>
                  {signal.direction}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 tabular-nums">
                <Field label="Entry" value={signal.entry_price} />
                <Field label="Stop" value={signal.stop_loss} tone="text-rose-300" />
                <Field label="TP1" value={signal.take_profit_1} tone="text-emerald-300" />
              </div>
            </div>

            {/* Broker route */}
            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Route to broker
            </label>
            <select
              aria-label="Route to broker"
              value={brokerId}
              onChange={(e) => { setBrokerId(e.target.value); setLiveAck(false) }}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-amber-500/40 focus:outline-none"
            >
              {brokers.map((b) => (
                <option key={b.id} value={b.id} className="bg-background text-foreground">
                  {b.broker}{b.label ? ` · ${b.label}` : ''} {b.is_live ? '(LIVE)' : '(testnet)'}
                </option>
              ))}
            </select>

            {/* Size — manual entry */}
            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Size <span className="font-normal normal-case text-muted-foreground/70">(units / lots, per your broker)</span>
            </label>
            <input
              type="number" inputMode="decimal" min="0" step="any"
              value={size} onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. 0.01"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/60 focus:border-amber-500/40 focus:outline-none"
            />

            {/* Risk-% sizer — quick estimate the user can drop into the
                Size field above. Estimate only — broker contract spec
                still wins on the engine side. */}
            {signal.entry_price != null && signal.stop_loss != null && (
              <div className="mt-3 rounded-lg border border-border/60 bg-background/30 p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Or size by risk %
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[10px] text-muted-foreground">Account equity (USD)</span>
                    <input
                      aria-label="Account equity USD"
                      type="number" inputMode="decimal" min="0" step="any"
                      value={equity} onChange={(e) => setEquity(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono text-foreground"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] text-muted-foreground">Risk per trade (%)</span>
                    <input
                      aria-label="Risk percent"
                      type="number" inputMode="decimal" min="0" max="100" step="0.1"
                      value={riskPct} onChange={(e) => setRiskPct(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono text-foreground"
                    />
                  </label>
                </div>
                {riskEstimate.ok ? (
                  <div className="mt-2 flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground">Estimated size:</span>
                    <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono font-bold text-emerald-300">
                      {riskEstimate.size.toFixed(4)}
                    </code>
                    <span className="text-muted-foreground">
                      · stop {riskEstimate.stopDistance.toFixed(5)} · risk ${riskEstimate.riskUsd.toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSize(riskEstimate.size.toFixed(4))}
                      className="ml-auto rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-200 hover:bg-amber-500/30"
                    >
                      Use
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-[10.5px] text-muted-foreground">
                    Enter equity and risk % — needs a valid entry + stop on the signal.
                  </p>
                )}
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/80">
                  Estimate only. Your broker&apos;s contract size + pip value adjust the actual exposure; the engine&apos;s risk firewall is the final guard.
                </p>
              </div>
            )}

            {/* Live account guard */}
            {needsLiveAck && (
              <label className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/[0.06] p-2.5 text-[11px] text-rose-200">
                <input type="checkbox" checked={liveAck} onChange={(e) => setLiveAck(e.target.checked)} className="mt-0.5 accent-rose-400" />
                <span>
                  <span className="font-bold">Real-money account.</span> I understand this places a
                  live market order with real funds and accept the risk.
                </span>
              </label>
            )}

            <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
              A market order is submitted to your broker through the engine&apos;s risk firewall, which may
              reject it. Fills depend on live liquidity and can differ from the levels shown. Not financial advice.
            </p>

            {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium">
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition',
                  needsLiveAck ? 'bg-rose-600 hover:bg-rose-700' : 'bg-gradient-primary !text-black hover:opacity-90',
                  !canSubmit && 'cursor-not-allowed opacity-50',
                )}
              >
                {pending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} aria-hidden /> Placing…</>
                  : <><Zap className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> {needsLiveAck ? 'Place LIVE order' : 'Place order'}</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function OutcomeView({ outcome, onClose }: { outcome: Outcome; onClose: () => void }) {
  if (outcome.kind === 'rejected') {
    return (
      <div className="py-2">
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 text-[12px] text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          <div>
            <p className="font-semibold">Order rejected</p>
            <p className="mt-0.5 opacity-90">{outcome.reason}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="mt-4 w-full rounded-lg border border-border px-3 py-2 text-xs font-medium">
          Close
        </button>
      </div>
    )
  }
  return (
    <div className="py-2">
      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.06] p-3 text-[12px] text-emerald-200">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        <div>
          <p className="font-semibold">{outcome.kind === 'filled' ? 'Order filled' : 'Order submitted'}</p>
          <p className="mt-0.5 opacity-90 tabular-nums">
            {outcome.price != null && <>Fill price {outcome.price}. </>}
            {outcome.brokerOrderId && <>Ref {outcome.brokerOrderId}.</>}
          </p>
          <p className="mt-1 text-[10px] opacity-75">Track it on the Brokers page and your trade journal.</p>
        </div>
      </div>
      <button type="button" onClick={onClose} className="mt-4 w-full rounded-lg bg-gradient-primary px-3 py-2 text-xs font-bold text-black hover:opacity-90">
        Done
      </button>
    </div>
  )
}

function Field({ label, value, tone }: { label: string; value: number | null; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('font-semibold', tone)}>{value ?? '—'}</div>
    </div>
  )
}

// ─── Risk-% sizer ─────────────────────────────────────────────────
// Honest math: risk_$ = equity × pct; units = risk_$ / |entry−stop|.
// The result is a position size expressed in the signal's quote unit;
// most brokers accept it as lots/units directly. Final pip-value
// normalisation happens server-side in the engine's risk firewall.
type RiskEstimate =
  | { ok: true; size: number; riskUsd: number; stopDistance: number }
  | { ok: false }

function computeRiskSize(p: {
  equity:  number
  riskPct: number
  entry:   number | null
  stop:    number | null
}): RiskEstimate {
  if (!Number.isFinite(p.equity)  || p.equity  <= 0) return { ok: false }
  if (!Number.isFinite(p.riskPct) || p.riskPct <= 0) return { ok: false }
  if (p.entry == null || p.stop == null)             return { ok: false }
  const stopDistance = Math.abs(p.entry - p.stop)
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) return { ok: false }
  const riskUsd = p.equity * (p.riskPct / 100)
  const size    = riskUsd / stopDistance
  if (!Number.isFinite(size) || size <= 0) return { ok: false }
  return { ok: true, size, riskUsd, stopDistance }
}
