import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Flag, ShieldCheck } from 'lucide-react'
import ReportRow from './ReportRow'

export const metadata = { title: 'Reports — Admin' }
export const dynamic = 'force-dynamic'

interface ReportSummary {
  id:           string
  target_type:  string
  target_id:    string
  reason:       string
  notes:        string | null
  created_at:   string
  reporter:     { handle: string | null }
  body:         string | null   // resolved target body for preview
  authorHandle: string | null   // resolved target author handle
}

async function fetchReports(): Promise<{ pending: ReportSummary[]; resolved: ReportSummary[] }> {
  const svc = createServiceClient()
  // Pull recent reports
  const { data: rows } = await svc
    .from('content_reports')
    .select('id, reporter_id, target_type, target_id, reason, notes, status, resolved_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  // Resolve reporter handles + target previews in batched lookups.
  const reporterIds = Array.from(new Set((rows ?? []).map((r) => r.reporter_id)))
  const postIds = Array.from(new Set((rows ?? []).filter((r) => r.target_type === 'social_post').map((r) => r.target_id)))
  const replyIds = Array.from(new Set((rows ?? []).filter((r) => r.target_type === 'discussion_reply').map((r) => r.target_id)))

  const [{ data: profiles }, { data: posts }, { data: replies }] = await Promise.all([
    reporterIds.length
      ? svc.from('profiles').select('id, public_handle').in('id', reporterIds)
      : Promise.resolve({ data: [] as { id: string; public_handle: string | null }[] }),
    postIds.length
      ? svc.from('social_posts').select('id, body, author_id').in('id', postIds)
      : Promise.resolve({ data: [] as { id: string; body: string; author_id: string }[] }),
    replyIds.length
      ? svc.from('discussion_replies').select('id, body, author_id').in('id', replyIds)
      : Promise.resolve({ data: [] as { id: string; body: string; author_id: string }[] }),
  ])

  // Author handles for previewed posts/replies
  const authorIds = Array.from(new Set([
    ...(posts ?? []).map((p) => p.author_id),
    ...(replies ?? []).map((r) => r.author_id),
  ]))
  const { data: authors } = authorIds.length
    ? await svc.from('profiles').select('id, public_handle').in('id', authorIds)
    : { data: [] as { id: string; public_handle: string | null }[] }

  const profById = new Map((profiles ?? []).map((p) => [p.id, p.public_handle]))
  const authById = new Map((authors  ?? []).map((p) => [p.id, p.public_handle]))
  const postById = new Map((posts    ?? []).map((p) => [p.id, p]))
  const replyById = new Map((replies ?? []).map((r) => [r.id, r]))

  const mapped: (ReportSummary & { status: string })[] = (rows ?? []).map((r) => {
    let body: string | null = null
    let authorHandle: string | null = null
    if (r.target_type === 'social_post') {
      const p = postById.get(r.target_id)
      body = p?.body?.slice(0, 220) ?? null
      authorHandle = p ? (authById.get(p.author_id) ?? null) : null
    } else if (r.target_type === 'discussion_reply') {
      const rep = replyById.get(r.target_id)
      body = rep?.body?.slice(0, 220) ?? null
      authorHandle = rep ? (authById.get(rep.author_id) ?? null) : null
    }
    return {
      id:           r.id,
      target_type:  r.target_type,
      target_id:    r.target_id,
      reason:       r.reason,
      notes:        r.notes,
      created_at:   r.created_at,
      reporter:     { handle: profById.get(r.reporter_id) ?? null },
      body, authorHandle,
      status:       r.status,
    }
  })

  return {
    pending:  mapped.filter((r) => r.status === 'pending'),
    resolved: mapped.filter((r) => r.status !== 'pending').slice(0, 50),
  }
}

export default async function AdminReportsPage() {
  // Auth-gated by admin/layout. Use the user client just to detect identity.
  await createClient()
  const { pending, resolved } = await fetchReports()

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Flag className="h-5 w-5 text-rose-400" strokeWidth={1.75} aria-hidden />
          Community Reports
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Triage user-submitted reports. Dismiss false flags or hide the target content.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500/15 px-1.5 text-[10px] font-bold text-rose-300">
            {pending.length}
          </span>
          Pending
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            <ShieldCheck className="mr-1.5 inline h-4 w-4" strokeWidth={1.75} aria-hidden />
            Queue is clear — nothing to triage.
          </p>
        ) : pending.map((r) => <ReportRow key={r.id} r={r} />)}
      </section>

      {resolved.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold tracking-tight text-muted-foreground">Recently resolved</h2>
          <div className="space-y-2 opacity-70">
            {resolved.map((r) => <ReportRow key={r.id} r={r} readOnly />)}
          </div>
        </section>
      )}
    </div>
  )
}
