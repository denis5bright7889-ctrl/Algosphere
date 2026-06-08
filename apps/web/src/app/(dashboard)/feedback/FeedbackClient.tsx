'use client'

/**
 * FeedbackClient — type tabs, type-aware form, and "My feedback" history.
 *
 * Five types share one form shell; the visible fields swap based on
 * the active tab:
 *   rating   → star picker + optional review body
 *   question → subject + body
 *   bug      → subject + severity + body
 *   feature  → subject + body
 *   review   → body only
 *
 * After submit, the form clears + a green confirmation appears + the
 * history pane refreshes. Rate-limit 429s render inline with a clear
 * "wait 1h" message.
 */
import { useEffect, useState, useTransition } from 'react'
import {
  Star, MessageCircleQuestion, Bug, Lightbulb, NotebookPen,
  Send, Loader2, CheckCircle2, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TYPE_LABEL, STATUS_LABEL, SEVERITY_LABEL, BUG_SEVERITIES,
  type FeedbackType, type BugSeverity,
} from '@/lib/feedback'

interface SubmissionRow {
  id:             string
  type:           FeedbackType
  rating:         number | null
  subject:        string | null
  body:           string | null
  target_kind:    string | null
  target_id:      string | null
  severity:       BugSeverity | null
  status:         keyof typeof STATUS_LABEL
  admin_response: string | null
  responded_at:   string | null
  source:         string
  created_at:     string
  updated_at:     string
}

const TYPE_TABS: Array<{ id: FeedbackType; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'rating',   label: 'Rate',     icon: Star },
  { id: 'question', label: 'Question', icon: MessageCircleQuestion },
  { id: 'bug',      label: 'Bug',      icon: Bug },
  { id: 'feature',  label: 'Idea',     icon: Lightbulb },
  { id: 'review',   label: 'Review',   icon: NotebookPen },
]

export default function FeedbackClient() {
  const [type, setType] = useState<FeedbackType>('rating')
  const [rating, setRating]     = useState<number | null>(null)
  const [subject, setSubject]   = useState('')
  const [body, setBody]         = useState('')
  const [severity, setSeverity] = useState<BugSeverity>('medium')
  const [pending, start]        = useTransition()
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState<string | null>(null)

  const [history, setHistory]   = useState<SubmissionRow[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  function resetForm() {
    setRating(null); setSubject(''); setBody(''); setSeverity('medium')
  }
  function clearMessages() { setError(null); setSuccess(null) }

  function refreshHistory() {
    setLoadingHistory(true)
    fetch('/api/feedback/mine?limit=25', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: { submissions: SubmissionRow[] }) => setHistory(j.submissions ?? []))
      .catch(() => setHistory([]))
      .finally(() => setLoadingHistory(false))
  }
  useEffect(refreshHistory, [])

  function submit() {
    clearMessages()
    const body_: Record<string, unknown> = { type }
    if (type === 'rating')   body_.rating   = rating
    if (type !== 'rating')   { body_.subject = subject.trim(); body_.body = body.trim() }
    if (type === 'review')   { body_.body    = body.trim() }
    if (type === 'bug')      body_.severity = severity
    if (type === 'rating' && body.trim()) body_.body = body.trim()  // optional review on a rating

    start(async () => {
      const res = await fetch('/api/feedback/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body_),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error ?? `Submit failed (HTTP ${res.status})`)
        return
      }
      setSuccess(`${TYPE_LABEL[type]} submitted — thanks. We'll respond in your feedback history when triaged.`)
      resetForm()
      refreshHistory()
    })
  }

  const canSubmit =
    type === 'rating'   ? rating != null
    : type === 'review' ? body.trim().length >= 2
    :                     subject.trim().length >= 2 && body.trim().length >= 2

  return (
    <div className="space-y-6">
      {/* Type tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-card p-1">
        {TYPE_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => { setType(id); clearMessages() }}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition',
              type === id
                ? 'bg-amber-500 text-black'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Form */}
      <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
        {type === 'rating' && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your rating
            </p>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  className="p-1 transition hover:scale-110"
                >
                  <Star
                    className={cn(
                      'size-7 transition-colors',
                      rating != null && n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40',
                    )}
                    strokeWidth={1.5}
                  />
                </button>
              ))}
              {rating != null && (
                <button
                  type="button"
                  onClick={() => setRating(null)}
                  className="ml-2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {type !== 'rating' && type !== 'review' && (
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={
              type === 'question' ? 'What do you want to know?'
              : type === 'bug'    ? 'Short summary (e.g. "Signals page slow on iPad")'
              :                     'Your idea in one line'
            }
            maxLength={200}
            className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground/60"
          />
        )}

        {type === 'bug' && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Severity
            </p>
            <div className="flex flex-wrap gap-1.5">
              {BUG_SEVERITIES.map((s) => {
                const meta = SEVERITY_LABEL[s]
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeverity(s)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-[11px] font-semibold transition',
                      severity === s
                        ? meta.cls
                        : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            type === 'rating' ? 'Optional — what worked, what didn\'t?'
            : type === 'review' ? 'Tell us about your experience…'
            : type === 'bug'   ? 'What did you see? What did you expect? Steps to reproduce?'
            : type === 'feature' ? 'What\'s the problem? How would your idea solve it?'
            :                       'Tell us more…'
          }
          rows={type === 'bug' ? 6 : 4}
          maxLength={5000}
          className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground/60"
        />

        {error && (
          <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
            <CheckCircle2 className="mr-1 inline size-3.5" />
            {success}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || pending}
          className={cn(
            'inline-flex w-full items-center justify-center gap-2 rounded-md bg-amber-500 px-4 py-2.5 text-sm font-bold text-black transition',
            'hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {pending
            ? <><Loader2 className="size-4 animate-spin" /> Sending…</>
            : <><Send className="size-4" /> Send {TYPE_LABEL[type].toLowerCase()}</>}
        </button>
      </section>

      {/* History */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">My feedback ({history.length})</h2>
          <button
            type="button"
            onClick={refreshHistory}
            disabled={loadingHistory}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('size-3', loadingHistory && 'animate-spin')} />
            Refresh
          </button>
        </header>

        {history.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            Nothing yet. Submit feedback above and it&apos;ll show up here with the admin response when triaged.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((r) => (
              <li key={r.id} className="px-4 py-3 text-xs space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-semibold">
                    {TYPE_LABEL[r.type]}
                  </span>
                  <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', STATUS_LABEL[r.status].cls)}>
                    {STATUS_LABEL[r.status].label}
                  </span>
                  {r.severity && (
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', SEVERITY_LABEL[r.severity].cls)}>
                      {SEVERITY_LABEL[r.severity].label}
                    </span>
                  )}
                  {r.rating != null && (
                    <span className="inline-flex items-center gap-0.5 text-amber-400">
                      {Array.from({ length: r.rating }).map((_, i) => (
                        <Star key={i} className="size-3 fill-amber-400" />
                      ))}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
                {r.subject && <p className="font-medium">{r.subject}</p>}
                {r.body && <p className="text-muted-foreground whitespace-pre-wrap">{r.body}</p>}
                {r.admin_response && (
                  <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/[.04] p-2.5">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                      AlgoSphere reply{r.responded_at ? ` · ${new Date(r.responded_at).toLocaleString()}` : ''}
                    </p>
                    <p className="text-foreground whitespace-pre-wrap">{r.admin_response}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Footnote */}
      <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
        <AlertTriangle className="mt-px size-3 shrink-0" />
        Rate limit: 5 submissions per hour. Critical bugs route directly to our on-call channel.
      </p>
    </div>
  )
}
