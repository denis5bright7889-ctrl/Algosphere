import { createClient as serviceClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { ArrowLeft, CalendarClock, ExternalLink, CheckCircle2, XCircle, Clock } from 'lucide-react'

export const metadata = { title: 'Content Calendar — Growth Engine' }
export const dynamic = 'force-dynamic'

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

interface Row {
  id:           string
  content_id:   string
  channel:      string
  status:       string
  send_at:      string
  posted_at:    string | null
  external_url: string | null
  last_error:   string | null
  content?:     { title: string } | null
}

const STATUS_CLS: Record<string, string> = {
  queued:    'border-amber-500/40 bg-amber-500/10 text-amber-300',
  posting:   'border-sky-500/40 bg-sky-500/10 text-sky-300',
  posted:    'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  failed:    'border-rose-500/40 bg-rose-500/10 text-rose-300',
  cancelled: 'border-zinc-500/40 bg-zinc-500/10 text-muted-foreground',
}

const CHANNEL_LABEL: Record<string, string> = {
  x: 'X', telegram: 'Telegram', discord: 'Discord', linkedin: 'LinkedIn',
  instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube',
  whatsapp_channel: 'WhatsApp', instagram_reels: 'IG Reels', youtube_shorts: 'YT Shorts',
}

export default async function CalendarPage() {
  const { data: rows } = await db()
    .from('growth_scheduled_posts')
    .select(`
      id, content_id, channel, status, send_at, posted_at,
      external_url, last_error,
      content:growth_content_items!growth_scheduled_posts_content_id_fkey(title)
    `)
    .order('send_at', { ascending: false })
    .limit(200)

  const items = (rows ?? []) as unknown as Row[]

  // Group by date for the day-bucket render.
  const groups = new Map<string, Row[]>()
  for (const r of items) {
    const dayKey = new Date(r.send_at).toISOString().slice(0, 10)
    if (!groups.has(dayKey)) groups.set(dayKey, [])
    groups.get(dayKey)!.push(r)
  }
  const sortedDays = [...groups.keys()].sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/growth" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Growth Engine
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Content calendar</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every queued, posted, and failed publish across all channels. Use the detail page of a content item to schedule new posts.
          </p>
        </div>
        <Link href="/admin/growth/brand" className="rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-accent/40">
          Brand settings →
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          No scheduled posts yet. Open an approved content item and click <span className="font-semibold text-amber-300">Schedule</span>.
        </div>
      ) : (
        <div className="space-y-4">
          {sortedDays.map(day => (
            <section key={day} className="rounded-2xl border border-border bg-card overflow-hidden">
              <header className="border-b border-border px-4 py-2 flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
                <h2 className="text-sm font-bold">
                  {new Date(day).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </h2>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                  {groups.get(day)!.length} post{groups.get(day)!.length === 1 ? '' : 's'}
                </span>
              </header>
              <ul className="divide-y divide-border/40">
                {groups.get(day)!.map(r => {
                  const t = new Date(r.send_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  return (
                    <li key={r.id} className="flex items-start gap-3 px-4 py-3 text-[12px]">
                      <span className="w-12 shrink-0 text-[11px] tabular-nums text-muted-foreground">{t}</span>
                      <span className={'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ' + (STATUS_CLS[r.status] ?? '')}>
                        {r.status === 'posted'   ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {r.status}</span>
                        : r.status === 'failed'  ? <span className="inline-flex items-center gap-1"><XCircle      className="h-3 w-3" /> {r.status}</span>
                        : r.status === 'queued'  ? <span className="inline-flex items-center gap-1"><Clock        className="h-3 w-3" /> {r.status}</span>
                        : r.status}
                      </span>
                      <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                        {CHANNEL_LABEL[r.channel] ?? r.channel}
                      </span>
                      <Link href={`/admin/growth/${r.content_id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                        {r.content?.title ?? '(deleted)'}
                      </Link>
                      {r.external_url && (
                        <a href={r.external_url} target="_blank" rel="noopener" className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 hover:underline">
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {r.last_error && r.status === 'failed' && (
                        <span className="ml-2 max-w-[300px] truncate text-[11px] text-rose-300/90">{r.last_error}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
