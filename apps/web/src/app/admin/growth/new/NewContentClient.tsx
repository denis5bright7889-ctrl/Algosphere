'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

const KINDS = [
  { key: 'educational',         label: 'Educational' },
  { key: 'product_update',      label: 'Product Update' },
  { key: 'announcement',        label: 'Announcement' },
  { key: 'psychology_insight',  label: 'Psychology Insight' },
] as const

type Kind = typeof KINDS[number]['key']

export default function NewContentClient() {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>('educational')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [disclaimer, setDisclaimer] = useState('Educational content only. Not investment advice. Trading involves risk of loss.')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required.')
      return
    }
    start(async () => {
      const res = await fetch('/api/admin/growth/content', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          kind,
          title,
          summary:    summary || undefined,
          body_md:    body,
          disclaimer: disclaimer || undefined,
          provenance: { type: 'manual' },
          is_synthetic: false,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to create content')
        return
      }
      router.push(`/admin/growth/${json.data.id}`)
    })
  }

  return (
    <div className="space-y-5">
      <header>
        <Link href="/admin/growth" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">New content</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Manual draft. Use the generators on a strategy/backtest detail page to produce structured drafts from real platform data.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <Field label="Type">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Summary (optional)">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Body (markdown)">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
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

        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create draft'}
        </button>
      </div>
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
