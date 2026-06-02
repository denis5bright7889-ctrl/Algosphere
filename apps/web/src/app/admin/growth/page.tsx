import { createClient as serviceClient } from '@supabase/supabase-js'
import { Sparkles, FileText, CalendarClock, CheckCircle2, Eye, type LucideIcon } from 'lucide-react'
import Link from 'next/link'

export const metadata = { title: 'Growth Engine — Admin' }
export const dynamic = 'force-dynamic'

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

interface ContentRow {
  id:            string
  kind:          string
  status:        string
  title:         string
  summary:       string | null
  is_synthetic:  boolean
  tags:          string[]
  channels:      string[]
  scheduled_for: string | null
  published_at:  string | null
  updated_at:    string
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-200' },
  review:    { label: 'In review', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  approved:  { label: 'Approved',  cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  scheduled: { label: 'Scheduled', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  published: { label: 'Published', cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200' },
  archived:  { label: 'Archived',  cls: 'border-zinc-500/40 bg-zinc-500/10 text-muted-foreground' },
  rejected:  { label: 'Rejected',  cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
}

const KIND_LABEL: Record<string, string> = {
  strategy_of_the_week: 'Strategy of the Week',
  backtest_breakdown:   'Backtest Breakdown',
  market_report:        'Market Report',
  product_update:       'Product Update',
  psychology_insight:   'Psychology Insight',
  educational:          'Educational',
  announcement:         'Announcement',
}

export default async function GrowthEnginePage() {
  const sb = db()

  const { data: rows } = await sb
    .from('growth_content_items')
    .select('id, kind, status, title, summary, is_synthetic, tags, channels, scheduled_for, published_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200)

  const items = (rows ?? []) as ContentRow[]

  const counts = {
    draft:     items.filter(r => r.status === 'draft').length,
    review:    items.filter(r => r.status === 'review').length,
    approved:  items.filter(r => r.status === 'approved').length,
    scheduled: items.filter(r => r.status === 'scheduled').length,
    published: items.filter(r => r.status === 'published').length,
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Growth Engine</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Content lifecycle for AlgoSphere marketing. Every published item is gated on a non-empty disclaimer.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/growth/calendar"
            className="rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-accent/40"
          >
            Calendar
          </Link>
          <Link
            href="/admin/growth/brand"
            className="rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-accent/40"
          >
            Brand
          </Link>
          <Link
            href="/admin/growth/diagnostics"
            className="rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-accent/40"
          >
            Diagnostics
          </Link>
          <Link
            href="/admin/growth/automation"
            className="rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-accent/40"
          >
            Automation
          </Link>
          <Link
            href="/admin/growth/discovery"
            className="rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-accent/40"
          >
            Discovery
          </Link>
          <Link
            href="/admin/growth/funnel"
            className="rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-accent/40"
          >
            Funnel
          </Link>
          <Link
            href="/admin/growth/new"
            className="rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400"
          >
            + New content
          </Link>
        </div>
      </header>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatPill icon={FileText}      label="Draft"     count={counts.draft}     cls="text-zinc-300" />
        <StatPill icon={Eye}           label="In review" count={counts.review}    cls="text-amber-300" />
        <StatPill icon={CheckCircle2}  label="Approved"  count={counts.approved}  cls="text-emerald-300" />
        <StatPill icon={CalendarClock} label="Scheduled" count={counts.scheduled} cls="text-sky-300" />
        <StatPill icon={Sparkles}      label="Published" count={counts.published} cls="text-emerald-200" />
      </div>

      {/* List */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <header className="border-b border-border px-4 py-3 text-sm font-semibold">
          Recent content ({items.length})
        </header>
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No content yet. Click <span className="font-semibold text-amber-300">+ New content</span> to draft your first item.
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {items.map(r => (
              <li key={r.id}>
                <Link
                  href={`/admin/growth/${r.id}`}
                  className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <span className="truncate">{r.title}</span>
                      <span className={'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ' + (STATUS_LABEL[r.status]?.cls ?? '')}>
                        {STATUS_LABEL[r.status]?.label ?? r.status}
                      </span>
                      {r.is_synthetic && (
                        <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                          Backtest
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {KIND_LABEL[r.kind] ?? r.kind} · updated {new Date(r.updated_at).toLocaleString()}
                    </p>
                    {r.summary && (
                      <p className="mt-1 line-clamp-1 text-[12px] text-foreground/80">{r.summary}</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Compliance callout — visible on every admin growth page */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-200">
        <p className="font-bold uppercase tracking-wider text-[10px]">Compliance reminder</p>
        <p className="mt-1 text-amber-200/90">
          Backtest, paper, and hypothetical content carries the <span className="font-mono">Backtest</span> badge above. Never edit a synthetic item to read as if it were live user activity. Publishing is blocked when the disclaimer is empty.
        </p>
      </div>
    </div>
  )
}

function StatPill({
  icon: Icon, label, count, cls,
}: {
  icon: LucideIcon
  label: string
  count: number
  cls: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3">
      <div className="flex items-center gap-2">
        <Icon className={'h-4 w-4 ' + cls} strokeWidth={1.75} aria-hidden />
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums">{count}</p>
    </div>
  )
}

