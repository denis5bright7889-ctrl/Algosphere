/**
 * /brokers — Broker Connections (Refocus V3).
 *
 * The V3 spec frames brokers as the DATA INGESTION layer for the AI
 * engines, not as execution-first. This page now leads with two reads
 * before the connection form:
 *
 *   Sync Health   — per-broker status + last-equity-sync freshness so
 *                   the user can see at a glance which feeds are live
 *                   vs. stale vs. down.
 *   Data Pipeline — counts of auto-imported (source='auto') vs manual
 *                   journal rows, with totals feeding the AI engines.
 *
 * Below that, the existing BrokersClient handles add / test / set-default
 * / remove. Keys are encrypted with AES-256-GCM before storage; only the
 * signal-engine can decrypt to execute.
 */
import { redirect } from 'next/navigation'
import {
  Activity, Database, CheckCircle2, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import BrokersClient from './BrokersClient'

export const metadata = { title: 'Broker Connections — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

// Equity-sync freshness bands. Engines refresh on the order of minutes,
// so anything > 15m on a connected broker is the user's signal that the
// pipeline is lagging — surfaced as 'stale' (yellow), not 'live' (green).
const STALE_AFTER_MIN = 15
const DOWN_AFTER_MIN  = 120

type Conn = {
  id:                string
  broker:            string
  label:             string | null
  account_id:        string | null
  is_live:           boolean
  is_testnet:        boolean
  status:            string
  equity_usd:        number | null
  equity_updated_at: string | null
  error_message:     string | null
  is_default:        boolean
  created_at:        string
}

type Health = 'live' | 'stale' | 'down' | 'pending'

function healthOf(c: Conn): Health {
  if (c.status === 'failed' || c.status === 'revoked' || c.status === 'disabled') return 'down'
  if (c.status === 'pending' || c.status === 'testing') return 'pending'
  if (c.status !== 'connected') return 'down'
  if (!c.equity_updated_at) return 'stale'
  const ageMin = (Date.now() - new Date(c.equity_updated_at).getTime()) / 60_000
  if (ageMin > DOWN_AFTER_MIN)  return 'down'
  if (ageMin > STALE_AFTER_MIN) return 'stale'
  return 'live'
}

export default async function BrokersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: conns }, autoRes, manualRes] = await Promise.all([
    supabase
      .from('broker_connections')
      .select(`
        id, broker, label, account_id, is_live, is_testnet, status,
        equity_usd, equity_updated_at, error_message, is_default, created_at
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    // Data Pipeline read: how many trades feeding the AI come from brokers
    // (source='auto') vs were logged by hand (source='manual'). Count-only.
    supabase
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('source', 'auto'),
    supabase
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('source', 'manual'),
  ])

  const connections   = (conns ?? []) as Conn[]
  const autoCount     = autoRes.count   ?? 0
  const manualCount   = manualRes.count ?? 0
  const pipelineTotal = autoCount + manualCount

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Broker <span className="text-gradient">Connections</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Connect Binance / Bybit / OKX / MT5 / cTrader so the AI can read your
          full execution history. Keys are encrypted with AES-256-GCM before
          storage — only the signal-engine can decrypt to execute, never the
          frontend.
        </p>
      </header>

      {connections.length > 0 && (
        <SyncHealthPanel conns={connections} />
      )}

      <DataPipelinePanel
        autoCount={autoCount}
        manualCount={manualCount}
        total={pipelineTotal}
        anyBroker={connections.length > 0}
      />

      <BrokersClient initialConnections={connections} />
    </div>
  )
}


// ─── Sync Health Panel ───────────────────────────────────────────────

function SyncHealthPanel({ conns }: { conns: Conn[] }) {
  const annotated = conns.map((c) => ({ c, h: healthOf(c) }))
  const tally = annotated.reduce<Record<Health, number>>(
    (acc, x) => ((acc[x.h]++, acc)),
    { live: 0, stale: 0, down: 0, pending: 0 },
  )

  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold">Sync Health</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {tally.live} live · {tally.stale} stale · {tally.down + tally.pending} down
        </span>
      </div>

      <ul className="mt-3 space-y-2">
        {annotated.map(({ c, h }) => (
          <SyncRow key={c.id} c={c} h={h} />
        ))}
      </ul>
    </div>
  )
}

function SyncRow({ c, h }: { c: Conn; h: Health }) {
  const ageMin = c.equity_updated_at
    ? (Date.now() - new Date(c.equity_updated_at).getTime()) / 60_000
    : null

  const tone =
    h === 'live'    ? { bg: 'bg-emerald-400', text: 'text-emerald-300', label: 'Live'    }
    : h === 'stale' ? { bg: 'bg-amber-400',   text: 'text-amber-300',   label: 'Stale'   }
    : h === 'down'  ? { bg: 'bg-rose-400',    text: 'text-rose-300',    label: 'Down'    }
    :                  { bg: 'bg-sky-400',    text: 'text-sky-300',     label: 'Pending' }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 bg-background/40 px-3 py-2 text-[12px]">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', tone.bg)} aria-hidden />
        <span className="font-mono uppercase">{c.broker}</span>
        {c.label && <span className="truncate text-muted-foreground/80">· {c.label}</span>}
        {c.is_live    && <span className="rounded bg-amber-500/15 px-1 text-[9px] font-bold uppercase tracking-wider text-amber-300">live</span>}
        {c.is_testnet && <span className="rounded bg-sky-500/15 px-1 text-[9px] font-bold uppercase tracking-wider text-sky-300">testnet</span>}
        {c.is_default && <span className="rounded bg-emerald-500/15 px-1 text-[9px] font-bold uppercase tracking-wider text-emerald-300">default</span>}
      </div>
      <div className="flex items-center gap-3 text-right">
        <span className="tabular-nums text-muted-foreground/80">
          {c.equity_usd != null ? `$${c.equity_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
        </span>
        <span className={cn('font-semibold uppercase tracking-wider text-[10px]', tone.text)}>
          {tone.label}
        </span>
        <span className="hidden sm:inline text-[10px] text-muted-foreground/60">
          {ageMin == null
            ? 'no sync yet'
            : ageMin < 1   ? 'just now'
            : ageMin < 60  ? `${Math.round(ageMin)}m ago`
            : ageMin < 1440 ? `${Math.round(ageMin / 60)}h ago`
            : `${Math.round(ageMin / 1440)}d ago`}
        </span>
      </div>
    </li>
  )
}


// ─── Data Pipeline Panel ─────────────────────────────────────────────

function DataPipelinePanel({ autoCount, manualCount, total, anyBroker }: {
  autoCount: number; manualCount: number; total: number; anyBroker: boolean
}) {
  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold">AI Data Pipeline</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {total} trade{total === 1 ? '' : 's'} feeding the AI
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <PipelineTile
          label="Auto-imported"
          value={autoCount}
          icon={CheckCircle2}
          tone={autoCount > 0 ? 'text-emerald-300' : 'text-muted-foreground/60'}
          hint="from broker sync"
        />
        <PipelineTile
          label="Manual"
          value={manualCount}
          icon={Activity}
          tone={manualCount > 0 ? 'text-amber-300' : 'text-muted-foreground/60'}
          hint="from /journal"
        />
        <PipelineTile
          label="Total"
          value={total}
          icon={Database}
          tone={total > 0 ? 'text-foreground' : 'text-muted-foreground/60'}
          hint="fed to engines"
        />
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Every trade — auto-imported or manual — flows into the Coach, Psychology, Performance, and Risk engines.{' '}
        {!anyBroker && (
          <>Connect a broker below to start the auto-import pipeline.</>
        )}
        {anyBroker && autoCount === 0 && (
          <>Brokers are connected but no trades have been imported yet. The sync runs on a delay; trades will appear on the next pass.</>
        )}
      </p>
    </div>
  )
}

function PipelineTile({ label, value, icon: Icon, tone, hint }: {
  label: string; value: number; icon: LucideIcon; tone: string; hint: string
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />{label}
      </div>
      <div className={cn('mt-0.5 text-2xl font-semibold tabular-nums leading-none', tone)}>
        {value.toLocaleString()}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground/80">{hint}</p>
    </div>
  )
}
