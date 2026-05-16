'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

const PLANS = [
  { key: 'team',               label: 'Team — $199/seat' },
  { key: 'business',           label: 'Business — $5k/mo' },
  { key: 'white_label',        label: 'White Label — $15k/mo' },
  { key: 'broker_partnership', label: 'Broker Partnership — custom' },
] as const

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40'

export default function EnterpriseEnquiryForm() {
  const [orgName, setOrgName]   = useState('')
  const [email, setEmail]       = useState('')
  const [contactName, setContact] = useState('')
  const [domain, setDomain]     = useState('')
  const [plan, setPlan]         = useState<typeof PLANS[number]['key']>('business')
  const [seats, setSeats]       = useState(50)
  const [notes, setNotes]       = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState<{ id: string; estimate: number } | null>(null)

  function submit() {
    setError(null)
    if (orgName.length < 2)                   return setError('Organization name required')
    if (!/^.+@.+\..+$/.test(email))           return setError('Valid contact email required')

    startTransition(async () => {
      try {
        const res = await fetch('/api/enterprise', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            org_name:      orgName,
            contact_email: email,
            contact_name:  contactName || undefined,
            org_domain:    domain || undefined,
            plan,
            seat_count:    seats,
            notes:         notes || undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed')
        setSuccess({ id: data.lead_id, estimate: data.estimate_monthly_usd })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  if (success) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-5">
        <p className="text-sm font-bold text-emerald-300">✓ Enquiry received</p>
        <p className="text-xs text-muted-foreground mt-2">
          We&apos;ll be in touch within 1 business day. Indicative starting cost based
          on your selection:
        </p>
        <p className="text-2xl font-bold text-amber-300 tabular-nums mt-2">
          ${success.estimate.toLocaleString()}<span className="text-xs text-muted-foreground font-normal">/month</span>
        </p>
        <p className="text-[10px] text-muted-foreground mt-2 font-mono">
          Ref: {success.id.slice(0, 8)}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Organization name">
          <input type="text" value={orgName} onChange={e => setOrgName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Contact email">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Contact name (optional)">
          <input type="text" value={contactName} onChange={e => setContact(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Org domain (optional)">
          <input type="text" value={domain} onChange={e => setDomain(e.target.value)} placeholder="acme.com" className={inputCls} />
        </Field>
      </div>

      <Field label="Plan">
        <select
          value={plan}
          onChange={e => setPlan(e.target.value as typeof PLANS[number]['key'])}
          className={inputCls}
        >
          {PLANS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </Field>

      <Field label={`Estimated seats — ${seats}`}>
        <input
          type="range"
          min={1}
          max={500}
          step={1}
          value={seats}
          onChange={e => setSeats(+e.target.value)}
          className="w-full accent-amber-400"
          aria-label="Seat count"
        />
      </Field>

      <Field label="Anything else? (optional)">
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          className={`${inputCls} resize-none`}
          placeholder="Use case, target launch date, integration requirements…"
        />
      </Field>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className={cn(
          'btn-premium w-full !text-sm !py-3',
          pending && 'opacity-60 cursor-wait',
        )}
      >
        {pending ? 'Submitting…' : 'Request a Quote →'}
      </button>
      <p className="text-[10px] text-muted-foreground text-center">
        No account required. We reply by email.
      </p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}
