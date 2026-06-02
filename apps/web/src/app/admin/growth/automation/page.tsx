import Link from 'next/link'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { ArrowLeft, Zap, ScrollText, CheckCircle2, XCircle, Clock, Sparkles } from 'lucide-react'
import AutomationActions from './AutomationActions'

export const metadata = { title: 'Automation — Growth Engine' }
export const dynamic = 'force-dynamic'

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

interface Rule {
  id:            string
  name:          string
  description:   string | null
  event_type:    string
  predicate:     Record<string, unknown>
  content_kind:  string
  channels:      string[]
  output_status: string
  enabled:       boolean
  daily_cap:     number | null
  updated_at:    string
}

interface EventRow {
  id:          string
  event_type:  string
  outcome:     string
  rule_ids:    string[]
  content_ids: string[]
  source:      string
  error:       string | null
  created_at:  string
}

const OUTCOME_CLS: Record<string, string> = {
  ok:           'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  no_match:     'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
  rate_limited: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  error:        'border-rose-500/40 bg-rose-500/10 text-rose-300',
}

export default async function AutomationPage() {
  const sb = db()

  const [{ data: rules }, { data: events }] = await Promise.all([
    sb.from('growth_automation_rules')
      .select('id, name, description, event_type, predicate, content_kind, channels, output_status, enabled, daily_cap, updated_at')
      .order('updated_at', { ascending: false }),
    sb.from('growth_event_log')
      .select('id, event_type, outcome, rule_ids, content_ids, source, error, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const ruleRows  = (rules ?? []) as Rule[]
  const eventRows = (events ?? []) as EventRow[]

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/growth" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Growth Engine
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Automation</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Event-driven content generation. Every signal / backtest / weekly digest can fire a rule that auto-creates a draft (or auto-publishes for low-risk kinds).
          </p>
        </div>
        <AutomationActions />
      </header>

      {/* Rules */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Zap className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
          <h2 className="text-sm font-bold">Rules ({ruleRows.length})</h2>
        </header>
        <ul className="divide-y divide-border/40">
          {ruleRows.map(r => (
            <li key={r.id} className="px-4 py-3 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className={
                  'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ' + (
                    r.enabled
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-500/40 bg-zinc-500/10 text-muted-foreground'
                  )
                }>
                  {r.enabled ? 'enabled' : 'disabled'}
                </span>
                <span className="font-semibold">{r.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{r.daily_cap ? `cap ${r.daily_cap}/day` : 'no cap'}</span>
              </div>
              {r.description && <p className="mt-1 text-muted-foreground">{r.description}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono">{r.event_type}</code>
                <span>→</span>
                <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono">{r.content_kind}</code>
                <span>·</span>
                <span>status: <span className="text-foreground">{r.output_status}</span></span>
                {r.channels.length > 0 && (
                  <>
                    <span>·</span>
                    <span>channels: {r.channels.join(', ')}</span>
                  </>
                )}
                {Object.keys(r.predicate ?? {}).length > 0 && (
                  <>
                    <span>·</span>
                    <span>predicate: <code className="font-mono">{JSON.stringify(r.predicate)}</code></span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Event log */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ScrollText className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
          <h2 className="text-sm font-bold">Recent events ({eventRows.length})</h2>
        </header>
        {eventRows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
            No events yet. Fire one with the <span className="font-semibold text-amber-300">Generate now</span> button or wait for the signal-engine to publish a signal.
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {eventRows.map(e => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[12px]">
                <span className={'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ' + (OUTCOME_CLS[e.outcome] ?? '')}>
                  {e.outcome === 'ok' ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> ok</span>
                   : e.outcome === 'error' ? <span className="inline-flex items-center gap-1"><XCircle className="h-3 w-3" /> error</span>
                   : e.outcome === 'rate_limited' ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> rate-limited</span>
                   : <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3" /> no match</span>}
                </span>
                <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px]">{e.event_type}</code>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{e.source}</span>
                <span className="ml-auto tabular-nums text-[10px] text-muted-foreground">
                  {new Date(e.created_at).toLocaleString()}
                </span>
                {e.content_ids.length > 0 && (
                  <span className="basis-full pl-1 text-[11px] text-emerald-300">
                    + produced {e.content_ids.length} draft{e.content_ids.length === 1 ? '' : 's'}
                  </span>
                )}
                {e.error && (
                  <span className="basis-full pl-1 text-[11px] text-rose-300">{e.error}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
