/**
 * /admin/intelligence-health — admin-only Market Intelligence diagnostics.
 *
 * Surfaces what the user must NEVER see ([[feedback_admin_vs_user_surfaces]]):
 *
 *   - Provider health per engine (% live vs stale vs building)
 *   - Top error class per engine (rate_limit / credits_exhausted /
 *     auth_failure / timeout / ... — sanitized; never raw provider text)
 *   - Cache activation state (which engines are currently being
 *     served from the reliability cache vs fresh)
 *   - Recent failure log (last 30 events with sanitized class)
 *
 * Defensive admin gate — `nav.ts` already hides the link from users
 * (`adminOnly: true` on the group); this page also 404s direct-URL
 * access by non-admins.
 *
 * Pure server component. No telemetry capture happens HERE; this is a
 * read-only view of the buffer the grid composer writes to.
 */
import { notFound, redirect } from 'next/navigation'
import {
  Activity, AlertOctagon, CheckCircle2, Clock, Database, Radar,
  TrendingDown, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { cn } from '@/lib/utils'
import {
  aggregateHealth, snapshotEvents,
  type EngineHealthRow, type EngineEvent, type ErrorClass,
} from '@/lib/intelligence/engine-telemetry'

export const metadata = { title: 'Intelligence Health — Admin' }
export const dynamic = 'force-dynamic'


const ERROR_CLASS_LABEL: Record<ErrorClass, string> = {
  rate_limit:        'Rate limit',
  credits_exhausted: 'Credits exhausted',
  auth_failure:      'Auth failure',
  timeout:           'Timeout',
  connection_refused: 'Connection refused',
  http_5xx:          'HTTP 5xx',
  http_4xx:          'HTTP 4xx',
  config_missing:    'Config missing',
  no_data:           'No data',
  partial_data:      'Partial data',
  other:             'Other',
}

const ENGINE_NAME: Record<string, string> = {
  regime:      'Market Regime',
  momentum:    'Momentum',
  breadth:     'Market Breadth',
  smartMoney:  'Smart Money',
  whaleFlow:   'Whale Flows',
  dominance:   'Dominance & Rotation',
  volatility:  'Volatility',
  correlation: 'Correlations',
  execution:   'Execution Quality',
}


export default async function IntelligenceHealthPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // Defensive — nav already hides this; direct URL access by non-admins 404s.
  if (!isAdmin(user.email)) notFound()

  // The composer writes to the same in-process ring buffer this page
  // reads from; we read the snapshot directly so the page renders
  // server-side without a network round-trip.
  const rows  = aggregateHealth({ perEngineLimit: 100 })
  const all   = snapshotEvents()
  const recent = all.slice(-30).reverse()

  // System-wide rollup for the header strip.
  const totalEvents = all.length
  const livePct     = totalEvents > 0
    ? Math.round((all.filter((e) => e.outcome === 'live').length / totalEvents) * 100)
    : 0
  const stalePct    = totalEvents > 0
    ? Math.round((all.filter((e) => e.outcome === 'stale').length / totalEvents) * 100)
    : 0
  const buildingPct = totalEvents > 0
    ? Math.round((all.filter((e) => e.outcome === 'building').length / totalEvents) * 100)
    : 0
  const errorEvents = all.filter((e) => !!e.error_class).length

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Intelligence <span className="text-gradient">Health</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Admin-only operator view. Provider health, fallback activation, and
          sanitized error classes per engine. Users never see this data.
        </p>
      </header>

      {/* System-wide rollup */}
      <section className="rounded-xl border border-border bg-card p-5">
        <header className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
          <h2 className="text-sm font-semibold">System rollup</h2>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {totalEvents} events captured · last {recent.length} shown below
          </span>
        </header>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Live %"     value={`${livePct}%`}     tone={livePct >= 70 ? 'emerald' : livePct >= 40 ? 'amber' : 'rose'} icon={CheckCircle2} />
          <Tile label="Stale %"    value={`${stalePct}%`}    tone={stalePct < 20 ? 'emerald' : stalePct < 40 ? 'amber' : 'rose'} icon={Clock} />
          <Tile label="Building %" value={`${buildingPct}%`} tone={buildingPct < 10 ? 'emerald' : buildingPct < 30 ? 'amber' : 'rose'} icon={Database} />
          <Tile label="Errors"     value={String(errorEvents)} tone={errorEvents === 0 ? 'emerald' : errorEvents < 10 ? 'amber' : 'rose'} icon={AlertOctagon} />
        </div>
      </section>

      {/* Per-engine table */}
      <section className="rounded-xl border border-border bg-card p-5">
        <header className="mb-3 flex items-center gap-2">
          <Radar className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
          <h2 className="text-sm font-semibold">Per-engine health</h2>
          <span className="ml-auto text-[11px] text-muted-foreground">
            last 100 events / engine
          </span>
        </header>
        {rows.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            Telemetry buffer is empty — no /intelligence requests served yet
            this process lifetime, or the engine composer hasn&apos;t run.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3">Engine</th>
                  <th className="py-2 pr-3 text-right">Events</th>
                  <th className="py-2 pr-3 text-right">Live</th>
                  <th className="py-2 pr-3 text-right">Stale</th>
                  <th className="py-2 pr-3 text-right">Building</th>
                  <th className="py-2 pr-3">Top error</th>
                  <th className="py-2 pr-1">Last status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => <EngineRow key={r.engine} row={r} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent failure log */}
      <section className="rounded-xl border border-border bg-card p-5">
        <header className="mb-3 flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
          <h2 className="text-sm font-semibold">Recent events</h2>
          <span className="ml-auto text-[11px] text-muted-foreground">newest first</span>
        </header>
        {recent.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No events yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((e, i) => <EventRow key={`${e.at}-${i}`} event={e} />)}
          </ul>
        )}
      </section>
    </div>
  )
}


// ─── Tiles + rows ────────────────────────────────────────────────

function Tile({ label, value, tone, icon: Icon }: {
  label: string
  value: string
  tone:  'emerald' | 'amber' | 'rose'
  icon:  LucideIcon
}) {
  const cls = {
    emerald: 'text-emerald-300',
    amber:   'text-amber-300',
    rose:    'text-rose-300',
  }[tone]
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />
        {label}
      </div>
      <div className={cn('mt-0.5 text-xl font-bold tabular-nums leading-none', cls)}>
        {value}
      </div>
    </div>
  )
}


function EngineRow({ row }: { row: EngineHealthRow }) {
  const liveTone =
    row.live_rate_pct >= 70 ? 'text-emerald-300'
    : row.live_rate_pct >= 40 ? 'text-amber-300'
    : 'text-rose-300'
  const last = row.latest
  const lastTone =
    last?.outcome === 'live'     ? 'text-emerald-300'
    : last?.outcome === 'stale'   ? 'text-amber-300'
    : 'text-rose-300'
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-2 pr-3 font-mono">{ENGINE_NAME[row.engine] ?? row.engine}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{row.events_seen}</td>
      <td className={cn('py-2 pr-3 text-right tabular-nums', liveTone)}>{row.live_rate_pct}%</td>
      <td className="py-2 pr-3 text-right tabular-nums text-amber-300/85">{row.stale_rate_pct}%</td>
      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{row.building_rate_pct}%</td>
      <td className="py-2 pr-3 text-muted-foreground">
        {row.top_error_class ? ERROR_CLASS_LABEL[row.top_error_class] : '—'}
      </td>
      <td className={cn('py-2 pr-1 uppercase tracking-wider text-[10px] font-bold', lastTone)}>
        {last?.outcome ?? '—'}
      </td>
    </tr>
  )
}


function EventRow({ event }: { event: EngineEvent }) {
  const tone =
    event.outcome === 'live'     ? 'border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-200'
    : event.outcome === 'stale'   ? 'border-amber-500/30 bg-amber-500/[0.04] text-amber-200'
    : 'border-rose-500/30 bg-rose-500/[0.04] text-rose-200'
  const cacheBit = event.cache_age_ms != null
    ? `· cache age ${Math.round(event.cache_age_ms / 60_000)}m`
    : ''
  return (
    <li className={cn(
      'flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-[11px] font-mono',
      tone,
    )}>
      <span className="flex items-center gap-2">
        <span className="font-bold uppercase tracking-wider">{event.outcome}</span>
        <span>{ENGINE_NAME[event.engine] ?? event.engine}</span>
        {event.error_class && (
          <span className="opacity-80">· {ERROR_CLASS_LABEL[event.error_class]}</span>
        )}
        <span className="opacity-70">{cacheBit}</span>
      </span>
      <span className="text-[10px] opacity-70 tabular-nums">
        {new Date(event.at).toLocaleString()}
      </span>
    </li>
  )
}
