'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save } from 'lucide-react'

interface Brand {
  brand_voice:     string
  signature:       string
  default_cta:     string
  default_cta_url: string
  legal_footer:    string
  social:          Record<string, string>
}

const SOCIAL_KEYS = [
  { key: 'x',         label: 'X (Twitter)'  },
  { key: 'telegram',  label: 'Telegram'     },
  { key: 'discord',   label: 'Discord'      },
  { key: 'linkedin',  label: 'LinkedIn'     },
  { key: 'instagram', label: 'Instagram'    },
  { key: 'facebook',  label: 'Facebook'     },
  { key: 'youtube',   label: 'YouTube'      },
] as const

export default function BrandSettingsClient({ initial }: { initial: Brand }) {
  const [voice, setVoice]       = useState(initial.brand_voice ?? '')
  const [sig, setSig]           = useState(initial.signature ?? '')
  const [cta, setCta]           = useState(initial.default_cta ?? '')
  const [ctaUrl, setCtaUrl]     = useState(initial.default_cta_url ?? '')
  const [legal, setLegal]       = useState(initial.legal_footer ?? '')
  const [social, setSocial]     = useState<Record<string, string>>(initial.social ?? {})
  const [savedAt, setSavedAt]   = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [pending, start]        = useTransition()

  function save() {
    setError(null)
    start(async () => {
      const res = await fetch('/api/admin/growth/brand', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          brand_voice:     voice,
          signature:       sig,
          default_cta:     cta,
          default_cta_url: ctaUrl,
          legal_footer:    legal,
          social,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Save failed')
        return
      }
      setSavedAt(new Date().toLocaleString())
    })
  }

  return (
    <div className="space-y-5">
      <header>
        <Link href="/admin/growth" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Growth Engine
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Brand settings</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Voice, default CTA, legal footer, and social handles. Channel formatters read this on every post.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}
      {savedAt && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Saved at {savedAt}.
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <Field label="Brand voice">
          <textarea
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Direct, expert, no hype. Lead with verifiable numbers."
          />
        </Field>
        <Field label="Signature">
          <input
            type="text"
            value={sig}
            onChange={(e) => setSig(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="— Team AlgoSphere"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Default CTA text">
            <input
              type="text"
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Default CTA URL">
            <input
              type="url"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <Field label="Legal footer">
          <textarea
            value={legal}
            onChange={(e) => setLegal(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Trading involves risk of loss. Past performance is not indicative of future results."
          />
        </Field>

        <div className="pt-3 border-t border-border/60">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Social handles</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SOCIAL_KEYS.map(({ key, label }) => (
              <Field key={key} label={label}>
                <input
                  type="text"
                  value={social[key] ?? ''}
                  onChange={(e) => setSocial(s => ({ ...s, [key]: e.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder={key === 'x' ? '@algospherequant' : '...'}
                />
              </Field>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {pending ? 'Saving…' : 'Save brand settings'}
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
