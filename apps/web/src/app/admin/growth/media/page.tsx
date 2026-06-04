/**
 * /admin/growth/media — Media Command Center.
 *
 * Single-pane view of every generated asset (screenshots, image
 * cards, infographics, carousels, videos, PDFs, blogs) with their
 * production state, channel routing, and recent failures. Built on
 * the same growth_content_items + growth_asset_attempts tables that
 * already power the worker — no new infra, just an honest read.
 *
 * Layout:
 *   - Stat strip       — counts by asset_state across all rows
 *   - Asset failures   — last 50 failed attempts (operator queue)
 *   - Media gallery    — grid of content_items grouped by kind,
 *                        showing asset_urls per row with a thumbnail
 *                        when available
 *   - Pipeline notes   — what's deferred / requires operator setup
 */
import Image from 'next/image'
import Link  from 'next/link'
import { createClient as serviceClient } from '@supabase/supabase-js'
import {
  Image as ImageIcon, Video, FileText, CheckCircle2,
  AlertCircle, Clock, Activity,
} from 'lucide-react'
import MediaActions from './MediaActions'

export const metadata = { title: 'Media Command Center — Growth' }
export const dynamic  = 'force-dynamic'
export const runtime  = 'nodejs'

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

interface MediaRow {
  id:            string
  kind:          string
  title:         string
  status:        string
  asset_state:   string
  asset_kinds:   string[]
  asset_urls:    Record<string, string>
  asset_errors:  Record<string, string>
  channels:      string[]
  scheduled_for: string | null
  published_at:  string | null
  updated_at:    string
}

interface AttemptRow {
  id:              number
  content_item_id: string
  asset_kind:      string
  ok:              boolean
  url:             string | null
  bytes:           number | null
  duration_ms:     number | null
  error:           string | null
  worker_id:       string | null
  attempted_at:    string
}

const STATE_LABEL: Record<string, { label: string; cls: string }> = {
  none:      { label: 'No assets', cls: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300' },
  pending:   { label: 'Pending',   cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  producing: { label: 'Producing', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  ready:     { label: 'Ready',     cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  partial:   { label: 'Partial',   cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  failed:    { label: 'Failed',    cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
}

function relTime(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (d < 60)     return `${Math.floor(d)}s ago`
  if (d < 3600)   return `${Math.floor(d / 60)}m ago`
  if (d < 86400)  return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

function pickThumb(urls: Record<string, string>): string | null {
  if (!urls) return null
  // Prefer mobile WEBP (lighter), then desktop PNG, then any
  const priorities = [
    /_mobile_webp$/, /_mobile$/, /_desktop_webp$/, /screenshot$/i,
    /signal_card$/, /thumb$/, /jpg$/i,
  ]
  for (const re of priorities) {
    for (const [k, u] of Object.entries(urls)) {
      if (re.test(k) && u) return u
    }
  }
  const first = Object.values(urls).find((u) => u && typeof u === 'string')
  return first ?? null
}

export default async function MediaCommandCenter() {
  const sb = db()

  const [{ data: rows }, { data: attempts }] = await Promise.all([
    sb.from('growth_content_items')
      .select('id, kind, title, status, asset_state, asset_kinds, asset_urls, asset_errors, channels, scheduled_for, published_at, updated_at')
      .neq('asset_state', 'none')
      .order('updated_at', { ascending: false })
      .limit(120),
    sb.from('growth_asset_attempts')
      .select('id, content_item_id, asset_kind, ok, url, bytes, duration_ms, error, worker_id, attempted_at')
      .order('attempted_at', { ascending: false })
      .limit(50),
  ])

  const items = (rows ?? []) as MediaRow[]
  const recentAttempts = (attempts ?? []) as AttemptRow[]
  const failures = recentAttempts.filter((a) => !a.ok).slice(0, 25)

  const stateCounts = {
    pending:   items.filter((r) => r.asset_state === 'pending').length,
    producing: items.filter((r) => r.asset_state === 'producing').length,
    ready:     items.filter((r) => r.asset_state === 'ready').length,
    partial:   items.filter((r) => r.asset_state === 'partial').length,
    failed:    items.filter((r) => r.asset_state === 'failed').length,
  }

  const totalAttempts = recentAttempts.length || 1
  const successRate = Math.round(
    100 * recentAttempts.filter((a) => a.ok).length / totalAttempts,
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Media Command Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every generated asset — screenshots, image cards, videos, blogs — across the production pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/growth"
            className="rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-accent/40"
          >
            ← Growth
          </Link>
          <Link
            href="/admin/growth/diagnostics"
            className="rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-accent/40"
          >
            Diagnostics
          </Link>
        </div>
      </header>

      <MediaActions />

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <StatPill icon={Clock}        label="Pending"   count={stateCounts.pending}   cls="text-sky-300" />
        <StatPill icon={Activity}     label="Producing" count={stateCounts.producing} cls="text-amber-300" />
        <StatPill icon={CheckCircle2} label="Ready"     count={stateCounts.ready}     cls="text-emerald-300" />
        <StatPill icon={AlertCircle}  label="Partial"   count={stateCounts.partial}   cls="text-amber-300" />
        <StatPill icon={AlertCircle}  label="Failed"    count={stateCounts.failed}    cls="text-rose-300" />
        <StatPill icon={Activity}     label="50-att OK %" count={successRate}        cls="text-emerald-200" suffix="%" />
      </div>

      {/* Failures queue */}
      {failures.length > 0 ? (
        <section className="rounded-2xl border border-rose-500/30 bg-rose-500/[.04] overflow-hidden">
          <header className="border-b border-rose-500/30 px-4 py-3 text-sm font-semibold text-rose-200">
            Recent failures ({failures.length})
          </header>
          <ul className="divide-y divide-rose-500/15 text-sm">
            {failures.map((a) => (
              <li key={a.id} className="px-4 py-2 flex flex-wrap items-center gap-3">
                <span className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-300">
                  {a.asset_kind}
                </span>
                <span className="text-xs text-muted-foreground">{relTime(a.attempted_at)}</span>
                <span className="flex-1 truncate text-xs">{a.error ?? '(no error message)'}</span>
                <Link
                  href={`/admin/growth/${a.content_item_id}`}
                  className="text-xs text-amber-300 hover:underline"
                >
                  item →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Gallery */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <header className="border-b border-border px-4 py-3 text-sm font-semibold flex items-center gap-2">
          <ImageIcon className="size-4 text-amber-300" />
          Media gallery ({items.length})
        </header>
        {items.length === 0 ? (
          <p className="px-4 py-10 text-sm text-muted-foreground">
            No asset-producing content items in the database yet. Trigger one from{' '}
            <Link href="/admin/growth/automation" className="text-amber-300 hover:underline">/admin/growth/automation</Link>{' '}
            or wait for the next 06:00 UTC daily-content cron.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((row) => {
              const thumb = pickThumb(row.asset_urls)
              const state = STATE_LABEL[row.asset_state] ?? STATE_LABEL.none!
              const errEntries = Object.entries(row.asset_errors ?? {})
              return (
                <li key={row.id} className="group rounded-xl border border-border bg-background/40 overflow-hidden">
                  <Link href={`/admin/growth/${row.id}`} className="block">
                    <div className="aspect-[16/10] bg-zinc-900/60 relative">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt={row.title}
                          fill
                          sizes="(max-width: 768px) 100vw, 33vw"
                          className="object-cover group-hover:opacity-90"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                          {row.asset_state === 'pending' || row.asset_state === 'producing'
                            ? 'Producing…'
                            : 'No preview'}
                        </div>
                      )}
                      <span className={`absolute top-2 left-2 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${state.cls}`}>
                        {state.label}
                      </span>
                    </div>
                    <div className="p-3 space-y-1">
                      <p className="line-clamp-2 text-sm font-medium">{row.title}</p>
                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="rounded border border-border bg-zinc-900/60 px-1.5 py-0.5">{row.kind}</span>
                        {row.asset_kinds.map((k) => (
                          <span key={k} className="rounded border border-border bg-zinc-900/60 px-1.5 py-0.5">
                            {k}
                          </span>
                        ))}
                      </div>
                      {row.channels?.length ? (
                        <p className="text-[10px] text-muted-foreground">
                          → {row.channels.join(', ')}
                        </p>
                      ) : null}
                      {errEntries.length > 0 ? (
                        <p className="text-[10px] text-rose-300/80 line-clamp-1">
                          ⚠ {errEntries.map(([k, e]) => `${k}: ${e}`).join(' · ')}
                        </p>
                      ) : null}
                      <p className="text-[10px] text-muted-foreground">{relTime(row.updated_at)}</p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Pipeline notes */}
      <section className="rounded-2xl border border-border bg-card p-4 text-sm">
        <h2 className="text-base font-semibold mb-2 flex items-center gap-2">
          <FileText className="size-4 text-amber-300" />
          Pipeline state
        </h2>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li><strong className="text-emerald-300">✓ Live:</strong> Screenshot Engine (11 kinds, desktop + mobile, PNG + WEBP)</li>
          <li><strong className="text-emerald-300">✓ Live:</strong> Image Cards (signal_card, weekly_stats, trade_result, achievement, feature)</li>
          <li><strong className="text-emerald-300">✓ Live:</strong> Infographics (7 kinds, 1080×1350)</li>
          <li><strong className="text-emerald-300">✓ Live:</strong> Charts (Matplotlib — equity / drawdown / monthly / allocation)</li>
          <li><strong className="text-emerald-300">✓ Live:</strong> Carousels (educational / strategy / weekly / market / feature)</li>
          <li><strong className="text-emerald-300">✓ Live:</strong> Blog factory (6 kinds, /blog auto-serves)</li>
          <li><strong className="text-emerald-300">✓ Live:</strong> Videos (Remotion + edge-tts — 9 kinds, MP4 + JPG thumb)</li>
          <li><strong className="text-emerald-300">✓ Live:</strong> PDF reports (WeasyPrint — 7 kinds)</li>
          <li><Video className="inline size-3" /> <strong className="text-amber-300">Deferred:</strong> Per-page walkthrough videos — Remotion composition exists; per-page narration scripts + scene templates need authoring in marketing/videos/src/</li>
          <li><Video className="inline size-3" /> <strong className="text-amber-300">Deferred:</strong> Social comment auto-reply — needs Meta App Review approval for pages_manage_engagement</li>
          <li><Video className="inline size-3" /> <strong className="text-amber-300">Deferred:</strong> Social impressions/reach analytics — needs Meta Business verification + Insights API</li>
        </ul>
      </section>
    </div>
  )
}

function StatPill({
  icon: Icon,
  label,
  count,
  cls,
  suffix = '',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
  cls:   string
  suffix?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 flex items-center gap-3">
      <Icon className={`size-5 ${cls}`} />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold ${cls}`}>{count}{suffix}</p>
      </div>
    </div>
  )
}
