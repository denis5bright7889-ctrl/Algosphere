'use client'

import { useEffect, useState } from 'react'
import {
  Activity, ShieldAlert, Cpu, Radio, WifiOff, AlertOctagon, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Ok<T>  = { ok: true;  data: T }
type Err    = { ok: false; error: string }
type Result<T> = Ok<T> | Err

interface EngineStatus {
  enabled:   boolean
  symbols:   string[]
  timeframe: string
  provider:  string
  websocket: { connections?: number } & Record<string, unknown>
  time:      string
}
interface RiskTelemetry {
  state: 'ACTIVE' | 'COOLDOWN' | 'LOCKED'
  current_equity?:      number
  total_drawdown_pct?:  number
  daily_drawdown_pct?:  number
  consecutive_losses?:  number
}
interface CircuitBreaker {
  is_open:            boolean
  reason:             string | null
  consecutive_losses: number
  daily_losses:       number
}

interface Payload {
  status:  Result<EngineStatus>
  risk:    Result<RiskTelemetry>
  circuit: Result<Record<string, CircuitBreaker>>
  fetched_at: string
}

const POLL_MS = 15_000

const RISK_PILL: Record<RiskTelemetry['state'], { cls: string; dot: string; label: string }> = {
  ACTIVE:   { cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400', label: 'Engine Active' },
  COOLDOWN: { cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300',       dot: 'bg-amber-400',   label: 'Cooldown' },
  LOCKED:   { cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300',          dot: 'bg-rose-400',    label: 'Kill Switch — Locked' },
}

export default function EngineLivePanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const res = await fetch('/api/engine/status', { cache: 'no-store' })
        const json = await res.json() as Payload | { error: string }
        if (!alive) return
        if ('error' in json) { setError(json.error); setLoading(false); return }
        setData(json)
        setError(null)
        setLoading(false)
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : 'fetch failed')
          setLoading(false)
        }
      }
    }
    void load()
    const id = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // ── Header pill: best signal we have ──
  const headPill =
    !data || (data.risk.ok === false && data.status.ok === false)
      ? { cls: 'border-muted bg-muted/30 text-muted-foreground', dot: 'bg-muted-foreground/60', label: 'Engine offline' }
      : (data.risk.ok)
        ? RISK_PILL[data.risk.data.state]
        : (data.status.ok && data.status.data.enabled)
          ? { cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400', label: 'Engine Active' }
          : { cls: 'border-muted bg-muted/30 text-muted-foreground', dot: 'bg-muted-foreground/60', label: 'Engine idle' }

  return (
    <section className="surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-amber-300/90" strokeWidth={1.75} aria-hidden />
          <h2 className="text-base font-bold tracking-tight">Live Engine</h2>
        </div>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', headPill.cls)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', headPill.dot)} aria-hidden />
          {headPill.label}
        </span>
      </div>

      {loading && !data && <SkeletonGrid />}
      {error && !data && (
        <Honest icon={WifiOff} title="Engine unreachable" body={error} />
      )}

      {data && (
        <div className="grid gap-4 md:grid-cols-3">
          {/* Engine */}
          <Section icon={Activity} title="Engine">
            {data.status.ok ? (
              <dl className="space-y-1.5 text-xs">
                <Row k="State"    v={data.status.data.enabled ? 'enabled' : 'disabled'} />
                <Row k="Provider" v={data.status.data.provider} />
                <Row k="TF"       v={data.status.data.timeframe} />
                <Row k="Symbols"  v={String(data.status.data.symbols.length)} />
                <Row k="WS"       v={String(data.status.data.websocket?.connections ?? '—')} />
              </dl>
            ) : (
              <Inline body={data.status.error} />
            )}
          </Section>

          {/* Risk */}
          <Section icon={ShieldAlert} title="Risk Telemetry">
            {data.risk.ok ? (
              <dl className="space-y-1.5 text-xs">
                <Row
                  k="State"
                  v={data.risk.data.state}
                  tone={data.risk.data.state === 'ACTIVE' ? 'good' : data.risk.data.state === 'COOLDOWN' ? 'warn' : 'bad'}
                />
                <Row k="Equity" v={fmtCur(data.risk.data.current_equity)} />
                <Row k="Daily DD"  v={fmtPct(data.risk.data.daily_drawdown_pct)}  tone={ddTone(data.risk.data.daily_drawdown_pct)} />
                <Row k="Total DD"  v={fmtPct(data.risk.data.total_drawdown_pct)}  tone={ddTone(data.risk.data.total_drawdown_pct)} />
                <Row k="Loss streak" v={String(data.risk.data.consecutive_losses ?? 0)} />
              </dl>
            ) : (
              <Inline body={data.risk.error} />
            )}
          </Section>

          {/* Circuit breakers */}
          <Section icon={AlertOctagon} title="Circuit Breakers">
            {data.circuit.ok ? <BreakerList map={data.circuit.data} /> : <Inline body={data.circuit.error} />}
          </Section>
        </div>
      )}

      {data && (
        <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Radio className="h-2.5 w-2.5 animate-pulse-soft" strokeWidth={2.5} aria-hidden />
          updated {new Date(data.fetched_at).toLocaleTimeString()}
        </p>
      )}
    </section>
  )
}

// ── Bits ──

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-amber-300/90" strokeWidth={1.75} aria-hidden />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{title}</span>
      </div>
      {children}
    </div>
  )
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn(
        'tabular-nums font-medium',
        tone === 'good' && 'text-emerald-300',
        tone === 'warn' && 'text-amber-300',
        tone === 'bad'  && 'text-rose-300',
      )}>{v}</dd>
    </div>
  )
}

function BreakerList({ map }: { map: Record<string, CircuitBreaker> }) {
  const entries = Object.entries(map)
  const open = entries.filter(([, b]) => b.is_open)
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">No symbols tracked.</p>
  }
  if (open.length === 0) {
    return (
      <p className="text-xs text-emerald-300/80">All {entries.length} clear.</p>
    )
  }
  return (
    <ul className="space-y-1.5 text-xs">
      {open.map(([sym, b]) => (
        <li key={sym} className="flex items-start justify-between gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5">
          <span className="font-mono font-semibold text-rose-200">{sym}</span>
          <span className="text-[10px] text-rose-200/80 line-clamp-2">{b.reason ?? 'open'}</span>
        </li>
      ))}
      {entries.length - open.length > 0 && (
        <li className="text-[10px] text-muted-foreground">+ {entries.length - open.length} clear</li>
      )}
    </ul>
  )
}

function Inline({ body }: { body: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
      <WifiOff className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
      <span className="line-clamp-3">{body}</span>
    </p>
  )
}

function Honest({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-4">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-32 animate-shimmer rounded-xl bg-[linear-gradient(90deg,hsl(var(--muted)/0.4)_0%,hsl(var(--muted)/0.7)_50%,hsl(var(--muted)/0.4)_100%)] bg-[length:200%_100%]" />
      ))}
    </div>
  )
}

function fmtCur(n: number | undefined) {
  if (n == null) return '—'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtPct(n: number | undefined) {
  if (n == null) return '—'
  return `${n >= 0 ? '' : '-'}${Math.abs(n).toFixed(2)}%`
}
function ddTone(n: number | undefined): 'good' | 'warn' | 'bad' | undefined {
  if (n == null) return undefined
  const abs = Math.abs(n)
  if (abs >= 5) return 'bad'
  if (abs >= 2) return 'warn'
  return 'good'
}
