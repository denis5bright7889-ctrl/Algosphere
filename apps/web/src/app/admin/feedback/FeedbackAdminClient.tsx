'use client'

/**
 * FeedbackAdminClient — admin triage table.
 *
 * Fetches /api/admin/feedback (already sorted: open + in_review first,
 * then bugs by severity desc, then by recency). Each row expands to
 * show the body + an inline reply form. PATCH /api/admin/feedback?id=
 * with status + admin_response.
 *
 * Filter chips at top: type, status. Single-page list capped at 50;
 * if the queue grows beyond that the next slice can add pagination.
 */
import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  Star, MessageCircleQuestion, Bug, Lightbulb, NotebookPen,
  RefreshCw, Loader2, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TYPE_LABEL, STATUS_LABEL, SEVERITY_LABEL,
  FEEDBACK_TYPES, FEEDBACK_STATUSES,
  type FeedbackType, type FeedbackStatus, type BugSeverity,
} from '@/lib/feedback'

interface AdminRow {
  id:             string
  user_id:        string
  type:           FeedbackType
  rating:         number | null
  subject:        string | null
  body:           string | null
  target_kind:    string | null
  target_id:      string | null
  severity:       BugSeverity | null
  status:         FeedbackStatus
  admin_response: string | null
  responded_at:   string | null
  responded_by:   string | null
  source:         string
  created_at:     string
  updated_at:     string
}

const TYPE_ICON: Record<FeedbackType, React.ComponentType<{ className?: string }>> = {
  rating:   Star,
  question: MessageCircleQuestion,
  bug:      Bug,
  feature:  Lightbulb,
  review:   NotebookPen,
}

export default function FeedbackAdminClient() {
  const [rows,    setRows]    = useState<AdminRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [typeFilter,   setTypeFilter]   = useState<FeedbackType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | 'all'>('all')
  const [expandedId,   setExpandedId]   = useState<string | null>(null)

  const fetchRows = useCallback(() => {
    setLoading(true); setError(null)
    const params = new URLSearchParams({ limit: '50' })
    if (typeFilter   !== 'all') params.set('type',   typeFilter)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    fetch(`/api/admin/feedback?${params.toString()}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: { submissions: AdminRow[] }) => setRows(j.submissions ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed'))
      .finally(() => setLoading(false))
  }, [typeFilter, statusFilter])

  useEffect(fetchRows, [fetchRows])

  return (
    <div className="space-y-4">
      {/* Filter strip */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Type</span>
        <Chip on={typeFilter === 'all'} onClick={() => setTypeFilter('all')} label="All" />
        {FEEDBACK_TYPES.map((t) => (
          <Chip key={t} on={typeFilter === t} onClick={() => setTypeFilter(t)} label={TYPE_LABEL[t]} />
        ))}
        <span className="ml-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
        <Chip on={statusFilter === 'all'} onClick={() => setStatusFilter('all')} label="All" />
        {FEEDBACK_STATUSES.map((s) => (
          <Chip key={s} on={statusFilter === s} onClick={() => setStatusFilter(s)} label={STATUS_LABEL[s].label} />
        ))}
        <button
          type="button"
          onClick={fetchRows}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <header className="border-b border-border px-4 py-3 text-sm font-semibold">
          {rows.length} {rows.length === 1 ? 'submission' : 'submissions'}
        </header>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-muted-foreground">
            {loading ? 'Loading…' : 'No submissions match these filters.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <Row
                key={r.id}
                row={r}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId((cur) => cur === r.id ? null : r.id)}
                onUpdated={(patch) => {
                  setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, ...patch } : x))
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Row({
  row, expanded, onToggle, onUpdated,
}: {
  row: AdminRow
  expanded: boolean
  onToggle: () => void
  onUpdated: (patch: Partial<AdminRow>) => void
}) {
  const Icon = TYPE_ICON[row.type]
  const statusMeta   = STATUS_LABEL[row.status]
  const severityMeta = row.severity ? SEVERITY_LABEL[row.severity] : null

  return (
    <li className="px-4 py-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 text-left"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-amber-300" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-semibold">
              {TYPE_LABEL[row.type]}
            </span>
            <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', statusMeta.cls)}>
              {statusMeta.label}
            </span>
            {severityMeta && (
              <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', severityMeta.cls)}>
                {severityMeta.label}
              </span>
            )}
            {row.rating != null && (
              <span className="inline-flex items-center gap-0.5 text-amber-400">
                {Array.from({ length: row.rating }).map((_, i) => (
                  <Star key={i} className="size-3 fill-amber-400" />
                ))}
              </span>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground">
              {new Date(row.created_at).toLocaleString()}
            </span>
          </div>
          <p className="mt-1 truncate text-sm">
            {row.subject ?? row.body?.slice(0, 100) ?? <em className="text-muted-foreground">(no subject)</em>}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            user <code className="font-mono">{row.user_id.slice(0, 8)}</code>
            {row.target_kind && <> · target {row.target_kind}:{row.target_id}</>}
            {row.responded_at && <> · responded {new Date(row.responded_at).toLocaleDateString()}</>}
          </p>
        </div>
        {expanded ? <ChevronUp className="mt-0.5 size-4 text-muted-foreground" /> : <ChevronDown className="mt-0.5 size-4 text-muted-foreground" />}
      </button>

      {expanded && <ExpandedDetail row={row} onUpdated={onUpdated} />}
    </li>
  )
}

function ExpandedDetail({
  row, onUpdated,
}: {
  row: AdminRow
  onUpdated: (patch: Partial<AdminRow>) => void
}) {
  const [reply,  setReply]  = useState(row.admin_response ?? '')
  const [status, setStatus] = useState<FeedbackStatus>(row.status)
  const [pending, start]    = useTransition()
  const [error, setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function save() {
    setError(null); setSuccess(null)
    const patch: Record<string, unknown> = {}
    if (status !== row.status)                 patch.status = status
    if (reply.trim() !== (row.admin_response ?? '').trim()) patch.admin_response = reply.trim()
    if (Object.keys(patch).length === 0) {
      setError('Nothing to update.')
      return
    }
    start(async () => {
      const res = await fetch(`/api/admin/feedback?id=${row.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error ?? `Update failed (HTTP ${res.status})`)
        return
      }
      setSuccess('Saved.')
      onUpdated({
        status:        j.submission?.status         ?? status,
        admin_response: j.submission?.admin_response ?? reply.trim(),
        responded_at:  j.submission?.responded_at   ?? new Date().toISOString(),
        responded_by:  j.submission?.responded_by   ?? null,
      })
    })
  }

  return (
    <div className="mt-3 ml-7 space-y-3 border-l-2 border-amber-500/30 pl-4 text-xs">
      {row.body && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Body</p>
          <p className="whitespace-pre-wrap rounded-md border border-border bg-background/40 p-2.5 text-foreground">{row.body}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s].label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Admin response {row.admin_response && <span className="text-emerald-400">(replied)</span>}
        </p>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Reply visible to the user on their /feedback page…"
          rows={4}
          maxLength={5000}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        />
      </div>

      {error && (
        <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
          <AlertTriangle className="mr-1 inline size-3" />
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
          <CheckCircle2 className="mr-1 inline size-3" />
          {success}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-black hover:bg-amber-400 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : null}
        Save changes
      </button>
    </div>
  )
}

function Chip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-0.5 text-[10px] font-semibold transition',
        on
          ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
          : 'border-border/60 text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}
