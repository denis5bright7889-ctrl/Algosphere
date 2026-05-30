'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, AlertOctagon, Sparkles } from 'lucide-react'

type Status = 'draft' | 'review' | 'approved' | 'scheduled' | 'published' | 'archived' | 'rejected'

interface ContentItem {
  id:            string
  kind:          string
  status:        Status
  title:         string
  summary:       string | null
  body_md:       string
  hero_image_url: string | null
  tags:          string[]
  channels:      string[]
  provenance:    Record<string, unknown>
  is_synthetic:  boolean
  disclaimer:    string | null
  cta_text:      string | null
  cta_url:       string | null
  scheduled_for: string | null
  published_at:  string | null
  rejected_reason: string | null
  updated_at:    string
}

const STATUS_LABEL: Record<Status, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-200' },
  review:    { label: 'In review', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  approved:  { label: 'Approved',  cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  scheduled: { label: 'Scheduled', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  published: { label: 'Published', cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200' },
  archived:  { label: 'Archived',  cls: 'border-zinc-500/40 bg-zinc-500/10 text-muted-foreground' },
  rejected:  { label: 'Rejected',  cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
}

const NEXT_STEPS: Record<Status, { to: Status; label: string }[]> = {
  draft:     [{ to: 'review',    label: 'Send to review' }],
  review:    [{ to: 'approved',  label: 'Approve' }, { to: 'draft', label: 'Back to draft' }, { to: 'rejected', label: 'Reject' }],
  approved:  [{ to: 'published', label: 'Publish now' }, { to: 'draft', label: 'Back to draft' }],
  scheduled: [{ to: 'published', label: 'Publish now' }],
  published: [{ to: 'archived',  label: 'Archive' }],
  archived:  [{ to: 'draft',     label: 'Restore as draft' }],
  rejected:  [{ to: 'draft',     label: 'Edit as draft' }, { to: 'archived', label: 'Archive' }],
}

export default function ContentDetailClient({ initial }: { initial: ContentItem }) {
  const [item, setItem] = useState<ContentItem>(initial)
  const [title, setTitle] = useState(initial.title)
  const [summary, setSummary] = useState(initial.summary ?? '')
  const [bodyMd, setBodyMd] = useState(initial.body_md)
  const [disclaimer, setDisclaimer] = useState(initial.disclaimer ?? '')
  const [cta, setCta] = useState(initial.cta_text ?? '')
  const [ctaUrl, setCtaUrl] = useState(initial.cta_url ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  async function save(patchExtra?: Record<string, unknown>) {
    setError(null)
    start(async () => {
      const res = await fetch('/api/admin/growth/content', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          id:         item.id,
          title,
          summary:    summary || undefined,
          body_md:    bodyMd,
          disclaimer: disclaimer || undefined,
          cta_text:   cta || undefined,
          cta_url:    ctaUrl || undefined,
          ...patchExtra,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Save failed')
        return
      }
      setItem(json.data)
      router.refresh()
    })
  }

  async function transition(to: Status) {
    if (to === 'published' && !disclaimer.trim()) {
      setError('Disclaimer is required before publishing.')
      return
    }
    await save({ status: to })
  }

  const label = STATUS_LABEL[item.status]
  const next  = NEXT_STEPS[item.status] ?? []

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/growth" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Growth Engine
          </Link>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight">{item.title}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className={'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ' + label.cls}>
              {label.label}
            </span>
            {item.is_synthetic && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Backtest
              </span>
            )}
            <span>{item.kind}</span>
            <span>· updated {new Date(item.updated_at).toLocaleString()}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {next.map(n => (
            <button
              key={n.to}
              type="button"
              onClick={() => transition(n.to)}
              disabled={pending}
              className={
                'rounded-md px-3 py-2 text-xs font-bold disabled:opacity-50 ' +
                (n.to === 'published' || n.to === 'approved'
                  ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                  : n.to === 'rejected'
                  ? 'bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                  : 'bg-zinc-700/40 text-zinc-200 hover:bg-zinc-700/60')
              }
            >
              {n.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertOctagon className="mr-2 inline h-4 w-4" /> {error}
        </div>
      )}

      {/* Compliance card */}
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-[12px] text-amber-200">
        <p className="flex items-center gap-2 font-bold uppercase tracking-wider text-[10px]">
          <Sparkles className="h-3.5 w-3.5" /> Compliance
        </p>
        <p className="mt-1 text-amber-200/90">
          {item.is_synthetic
            ? 'This item is derived from a backtest or hypothetical source. The disclaimer below must remain non-empty and the body must NOT be edited to read as if it were live user activity.'
            : 'Non-synthetic content. The disclaimer below must remain non-empty when publishing.'}
        </p>
      </div>

      {/* Editor */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Summary">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Body (markdown)">
          <textarea
            value={bodyMd}
            onChange={(e) => setBodyMd(e.target.value)}
            rows={16}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          />
        </Field>
        <Field label="Disclaimer (required before publishing)">
          <textarea
            value={disclaimer}
            onChange={(e) => setDisclaimer(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="CTA text">
            <input
              type="text"
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="CTA URL">
            <input
              type="url"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <button
          type="button"
          onClick={() => save()}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* Provenance */}
      <details className="rounded-2xl border border-border bg-card p-4 text-[12px]">
        <summary className="cursor-pointer font-semibold">Provenance</summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-background p-3 text-[11px]">
          {JSON.stringify(item.provenance, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
