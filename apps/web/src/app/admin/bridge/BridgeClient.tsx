'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Live MT5-bridge monitoring panel. Polls /api/admin/bridge/{health,
 * processes,logs} every 3s and renders 7 cards mirroring the
 * standalone Command Center on the bridge itself. Server-side proxy
 * handles the X-Bridge-Key auth (env-only); this client never sees
 * the secret.
 */

const POLL_MS = 3000

interface ProcessRow {
  name:     string
  running:  boolean
  count:    number
  instances: Array<{ pid: number; name?: string; created_at?: number; uptime_s?: number }>
}

interface HealthData {
  status?:           string
  mt5_loaded?:       boolean
  mt5_ready?:        boolean
  mt5_connected?:    boolean
  execution_ready?:  boolean
  account?:          number | null
  equity?:           number | null
  consec_failures?:  number
  current_login?:    number | null
  creds_configured?: boolean
  risk?: {
    max_lot_limit?:        number
    max_orders_per_min?:   number
    orders_last_60s?:      number
    rate_status?:          'safe' | 'warn' | 'breach'
    symbol_cache_ttl_s?:   number
    symbol_servers?:       string[]
    symbol_total?:         number
  }
  timestamp?: number
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted'
const TONE_CLS: Record<Tone, string> = {
  ok:    'border-emerald-500/40 bg-emerald-500/10',
  warn:  'border-amber-500/40   bg-amber-500/10',
  bad:   'border-rose-500/40    bg-rose-500/10',
  muted: 'border-border         bg-muted/20',
}
const PILL_CLS: Record<Tone, string> = {
  ok:    'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  warn:  'border-amber-500/40   bg-amber-500/10   text-amber-300',
  bad:   'border-rose-500/40    bg-rose-500/10    text-rose-300',
  muted: 'border-border         bg-muted/20       text-foreground/80',
}

export default function BridgeClient() {
  const [health, setHealth]       = useState<HealthData | null>(null)
  const [processes, setProcesses] = useState<ProcessRow[] | null>(null)
  const [logs, setLogs]           = useState<string[]>([])
  const [lastUpdate, setLastUpdate] = useState<string>('—')
  const [latency, setLatency] = useState<{ health: number | null; processes: number | null; logs: number | null }>({
    health: null, processes: null, logs: null,
  })
  const [error, setError] = useState<string | null>(null)
  const logBoxRef = useRef<HTMLDivElement>(null)

  // Polling loop. setInterval would stack on slow networks; recursive
  // setTimeout makes each tick wait for the previous one to finish.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function tick() {
      if (cancelled) return
      try {
        const [hRes, pRes, lRes] = await Promise.all([
          timedFetch('/api/admin/bridge/health'),
          timedFetch('/api/admin/bridge/processes'),
          timedFetch('/api/admin/bridge/logs?lines=50'),
        ])
        if (cancelled) return

        setLatency({ health: hRes.ms, processes: pRes.ms, logs: lRes.ms })
        setError(null)

        if (hRes.res.ok)      setHealth(await hRes.res.json())
        else                  setHealth(null)
        if (pRes.res.ok) {
          const d = await pRes.res.json()
          setProcesses(d.processes ?? null)
        } else { setProcesses(null) }
        if (lRes.res.ok) {
          const d = await lRes.res.json()
          setLogs(d.logs ?? [])
        } else { setLogs([]) }

        // Aggregate error display — show first non-ok status.
        const failed = [hRes, pRes, lRes].find(r => !r.res.ok)
        if (failed) setError(`${failed.url.split('/').pop()}: HTTP ${failed.res.status}`)

        setLastUpdate(new Date().toLocaleTimeString())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'fetch failed')
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS)
      }
    }

    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [])

  // Auto-scroll log box to bottom on update
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }
  }, [logs])

  // ── Derived states ─────────────────────────────────────────────────
  const credsConfigured = !!health?.creds_configured
  const mt5Tone: Tone =
    health?.status === 'ok'        ? 'ok' :
    health?.status === 'degraded'  ? 'warn' :
    health == null                 ? 'muted' : 'bad'
  const tunnelTone: Tone =
    latency.health == null ? 'muted' :
    latency.health < 400   ? 'ok' :
    latency.health < 1000  ? 'warn' : 'bad'
  const criticalProcs = (processes ?? []).slice(0, 5)
  const criticalMissing = criticalProcs.some(p => !p.running)
  const sysTone: Tone =
    processes == null ? 'muted' :
    criticalMissing   ? 'bad' :
    processes.some(p => !p.running) ? 'warn' : 'ok'
  const riskTone: Tone =
    health?.risk?.rate_status === 'breach' ? 'bad' :
    health?.risk?.rate_status === 'warn'   ? 'warn' :
    health?.risk?.rate_status === 'safe'   ? 'ok' : 'muted'
  const worstLatency = Math.max(
    latency.health ?? 0, latency.processes ?? 0, latency.logs ?? 0,
  )
  const latTone: Tone =
    !latency.health ? 'muted' :
    worstLatency < 400  ? 'ok' :
    worstLatency < 1000 ? 'warn' : 'bad'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span>Refresh: <b className="text-foreground">{POLL_MS / 1000}s</b> · Last update: <b className="text-foreground">{lastUpdate}</b></span>
        {error && <span className="text-rose-400">⚠ {error}</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* SYSTEM PROCESSES */}
        <Card tone={sysTone} title="System Processes" className="lg:col-span-1">
          {processes == null && <Muted>loading…</Muted>}
          {processes?.map(p => (
            <KV
              key={p.name}
              label={p.name}
              value={
                p.running
                  ? <Pill tone="ok">running{p.count > 1 ? ` ×${p.count}` : ''}</Pill>
                  : <Pill tone="bad">not running</Pill>
              }
              detail={p.running && p.instances[0] ? `pid ${p.instances[0].pid} · up ${Math.floor((p.instances[0].uptime_s ?? 0) / 60)}m` : ''}
            />
          ))}
        </Card>

        {/* MT5 BRIDGE */}
        <Card tone={mt5Tone} title="MT5 Bridge">
          <KV label="Status" value={<Pill tone={mt5Tone}>{health?.status ?? '—'}</Pill>} />
          <KV label="MetaTrader5 loaded" value={fmtBool(health?.mt5_loaded)} />
          <KV label="Terminal ready" value={fmtBool(health?.mt5_ready)} />
          <KV label="Current login" value={health?.current_login ?? 'none'} />
          <KV label="Execution ready" value={credsConfigured ? fmtBool(health?.execution_ready) : 'n/a (multi-tenant)'} />
          <KV label="Watchdog failures" value={health?.consec_failures ?? 0} />
        </Card>

        {/* TUNNEL */}
        <Card tone={tunnelTone} title="Tunnel">
          <KV label="Endpoint" value="mt5.algospherequant.com" />
          <KV label="/health round-trip" value={latency.health != null ? `${latency.health} ms` : '—'} />
          <KV label="Status" value={health ? <Pill tone="ok">200</Pill> : <Pill tone="bad">unreachable</Pill>} />
          <KV label="Last check" value={lastUpdate} />
        </Card>

        {/* ACCOUNT */}
        <Card tone={credsConfigured ? 'ok' : 'warn'} title="Account">
          <KV label="Equity" value={health?.equity != null ? `$${Number(health.equity).toLocaleString()}` : '—'} />
          <KV label="Account #" value={health?.account ?? '—'} />
          <KV label="Creds in env" value={credsConfigured ? 'yes (single-account)' : 'no (multi-tenant)'} />
        </Card>

        {/* RISK */}
        <Card tone={riskTone} title="Risk Caps" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-x-6">
            <div>
              <KV label="Max lot per order" value={health?.risk?.max_lot_limit != null ? `${health.risk.max_lot_limit} lots` : '—'} />
              <KV label="Max orders / min" value={health?.risk?.max_orders_per_min ?? '—'} />
              <KV label="Orders last 60s" value={health?.risk?.orders_last_60s ?? '—'} />
              <KV label="Rate status" value={
                <Pill tone={riskTone}>
                  {health?.risk?.rate_status === 'breach' ? 'breached'
                    : health?.risk?.rate_status === 'warn' ? 'warning'
                    : health?.risk?.rate_status ?? 'unknown'}
                </Pill>
              } />
            </div>
            <div>
              <KV label="Symbol cache TTL" value={health?.risk?.symbol_cache_ttl_s != null ? `${health.risk.symbol_cache_ttl_s}s` : '—'} />
              <KV label="Cached servers" value={
                health?.risk?.symbol_servers?.length
                  ? health.risk.symbol_servers.join(', ')
                  : '(none cached yet)'
              } />
              <KV label="Total cached symbols" value={health?.risk?.symbol_total ?? 0} />
            </div>
          </div>
        </Card>

        {/* LATENCY */}
        <Card tone={latTone} title="Latency" className="lg:col-span-2">
          <div className="grid grid-cols-3 gap-3">
            <LatencyStat label="/health" ms={latency.health} />
            <LatencyStat label="/processes" ms={latency.processes} />
            <LatencyStat label="/logs" ms={latency.logs} />
          </div>
        </Card>

        {/* LOGS */}
        <Card tone="muted" title="Recent Activity (last 50 log lines)" className="lg:col-span-4">
          <div
            ref={logBoxRef}
            className="font-mono text-[11px] leading-relaxed bg-black/40 rounded-md p-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-all"
          >
            {logs.length === 0
              ? <span className="text-muted-foreground">(no log lines yet)</span>
              : logs.map((line, i) => {
                  const cls =
                    /ERROR|EXC/i.test(line) ? 'text-rose-400' :
                    /WARN/i.test(line)      ? 'text-amber-300' :
                    /order accepted|connected|ready/i.test(line) ? 'text-emerald-300' :
                    'text-foreground/85'
                  return <div key={i} className={cls}>{line}</div>
                })
            }
          </div>
        </Card>
      </div>
    </div>
  )
}


// ─── Building blocks ─────────────────────────────────────────────────

function Card({
  tone, title, children, className,
}: { tone: Tone; title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border p-4 min-h-[160px]', TONE_CLS[tone], className)}>
      <h2 className="mb-3 text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground flex items-center gap-2">
        <Dot tone={tone} />
        {title}
      </h2>
      {children}
    </div>
  )
}

function Dot({ tone }: { tone: Tone }) {
  return <span className={cn('inline-block h-2 w-2 rounded-full', {
    'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]': tone === 'ok',
    'bg-amber-400   shadow-[0_0_8px_rgba(245,158,11,0.6)]': tone === 'warn',
    'bg-rose-400    shadow-[0_0_8px_rgba(244,63,94,0.6)]':  tone === 'bad',
    'bg-muted-foreground': tone === 'muted',
  })} />
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={cn(
      'inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
      PILL_CLS[tone],
    )}>
      {children}
    </span>
  )
}

function KV({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[12px]">
      <span className="text-muted-foreground font-mono">{label}</span>
      <span className="font-mono text-right">
        {value}
        {detail && <span className="ml-2 text-muted-foreground text-[10px]">{detail}</span>}
      </span>
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-muted-foreground">{children}</p>
}

function LatencyStat({ label, ms }: { label: string; ms: number | null }) {
  const tone: Tone =
    ms == null ? 'muted' :
    ms < 400   ? 'ok' :
    ms < 1000  ? 'warn' : 'bad'
  return (
    <div className={cn('rounded-lg border p-3', TONE_CLS[tone])}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{ms == null ? '—' : `${ms} ms`}</p>
    </div>
  )
}

function fmtBool(v: boolean | undefined): string {
  if (v == null) return '—'
  return v ? 'yes' : 'NO'
}

async function timedFetch(url: string) {
  const t0 = performance.now()
  const res = await fetch(url, { cache: 'no-store' })
  return { url, res, ms: Math.round(performance.now() - t0) }
}
