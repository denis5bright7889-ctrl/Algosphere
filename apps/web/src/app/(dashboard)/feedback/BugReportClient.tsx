'use client'

import { useEffect, useState, useTransition } from 'react'
import { Send, CheckCircle2 } from 'lucide-react'

type Severity = 'low' | 'medium' | 'high' | 'critical'

export default function BugReportClient() {
  const [severity, setSeverity]    = useState<Severity>('medium')
  const [title, setTitle]          = useState('')
  const [description, setDesc]     = useState('')
  const [url, setUrl]              = useState('')
  const [steps, setSteps]          = useState('')
  const [userAgent, setUA]         = useState('')
  const [sent, setSent]            = useState(false)
  const [error, setError]          = useState<string | null>(null)
  const [pending, start]           = useTransition()

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUA(navigator.userAgent ?? '')
      setUrl(document.referrer && new URL(document.referrer).origin === window.location.origin
        ? document.referrer
        : window.location.href)
    }
  }, [])

  function submit() {
    setError(null)
    if (title.trim().length < 3 || description.trim().length < 20) {
      setError('Title (3+ chars) and description (20+ chars) required.')
      return
    }
    start(async () => {
      const res = await fetch('/api/bug-report', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          severity, title, description,
          url:        url || undefined,
          steps:      steps || undefined,
          user_agent: userAgent || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Submission failed')
        return
      }
      setSent(true)
      setTitle(''); setDesc(''); setSteps('')
    })
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-sm text-emerald-200">
        <p className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-4 w-4" /> Reported.
        </p>
        <p className="mt-1.5 text-emerald-200/85">
          Engineering will look into it. <button onClick={() => setSent(false)} className="underline">Report another</button>
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>
      )}

      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Severity</span>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="low">Low — cosmetic / minor inconvenience</option>
          <option value="medium">Medium — feature partly broken</option>
          <option value="high">High — feature completely broken</option>
          <option value="critical">Critical — data loss, security, or platform down</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Title</span>
        <input
          type="text"
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="One-line summary"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">What happened?</span>
        <textarea
          aria-label="What happened?"
          value={description}
          onChange={(e) => setDesc(e.target.value)}
          maxLength={4000}
          rows={6}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="What you saw vs what you expected. Be specific."
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Steps to reproduce (optional)</span>
        <textarea
          aria-label="Steps to reproduce"
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
          maxLength={2000}
          rows={4}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="1. Open /journal&#10;2. Click 'Add trade'&#10;3. ..."
        />
      </label>

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
      >
        <Send className="h-3.5 w-3.5" />
        {pending ? 'Sending…' : 'Send bug report'}
      </button>
    </div>
  )
}
