'use client'

import { useState, useTransition } from 'react'
import { Send, CheckCircle2 } from 'lucide-react'

const CATEGORIES = [
  { key: 'account',         label: 'Account / login' },
  { key: 'billing',         label: 'Billing / subscription' },
  { key: 'broker',          label: 'Broker connection' },
  { key: 'feature_request', label: 'Feature request' },
  { key: 'other',           label: 'Other' },
] as const

type Category = typeof CATEGORIES[number]['key']

export default function SupportFormClient() {
  const [category, setCategory] = useState<Category>('account')
  const [subject, setSubject]   = useState('')
  const [message, setMessage]   = useState('')
  const [sent, setSent]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [pending, start]        = useTransition()

  async function submit() {
    setError(null)
    if (subject.trim().length < 3 || message.trim().length < 10) {
      setError('Subject (3+ chars) and message (10+ chars) are required.')
      return
    }
    start(async () => {
      const res = await fetch('/api/support', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ category, subject, message }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Submission failed')
        return
      }
      setSent(true)
      setSubject(''); setMessage('')
    })
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-sm text-emerald-200">
        <p className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-4 w-4" /> Sent.
        </p>
        <p className="mt-1.5 text-emerald-200/85">
          A support agent will reply via Discord or email. Want to send another?{' '}
          <button onClick={() => setSent(false)} className="underline">New ticket</button>
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
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Category</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Subject</span>
        <input
          type="text"
          aria-label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={120}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Brief summary"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Message</span>
        <textarea
          aria-label="Message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          rows={8}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Describe what's happening, what you expected, and what you've tried."
        />
        <p className="mt-1 text-[10px] text-muted-foreground">{message.length} / 4000</p>
      </label>

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
      >
        <Send className="h-3.5 w-3.5" />
        {pending ? 'Sending…' : 'Send ticket'}
      </button>
    </div>
  )
}
