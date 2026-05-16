'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

const CHAINS = ['ethereum','bsc','polygon','arbitrum','base','solana'] as const
const TIERS = [
  { key: 'standard',     label: 'Standard',     fee: 2500,  inc: 'Token + site + dashboard' },
  { key: 'premium',      label: 'Premium',      fee: 7500,  inc: '+ liquidity lock + vesting + investor portal' },
  { key: 'full_managed', label: 'Full Managed', fee: 20000, inc: '+ treasury + AI assistant + marketing' },
] as const

type Chain = typeof CHAINS[number]
type Tier  = typeof TIERS[number]['key']

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40'

export default function NewLaunchForm() {
  const [projectName, setName]   = useState('')
  const [ticker, setTicker]      = useState('')
  const [chain, setChain]        = useState<Chain>('ethereum')
  const [description, setDesc]   = useState('')
  const [totalSupply, setSupply] = useState<number | ''>('')
  const [softCap, setSoftCap]    = useState<number | ''>('')
  const [hardCap, setHardCap]    = useState<number | ''>('')
  const [tier, setTier]          = useState<Tier>('standard')
  // Tokenomics distribution
  const [allocTeam, setAllocTeam]         = useState(15)
  const [allocPublic, setAllocPublic]     = useState(40)
  const [allocLiquidity, setAllocLiq]     = useState(25)
  const [allocTreasury, setAllocTreasury] = useState(20)

  const [pending, startTransition] = useTransition()
  const [error, setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const allocSum = allocTeam + allocPublic + allocLiquidity + allocTreasury
  const allocOk  = allocSum === 100

  function submit() {
    setError(null); setSuccess(null)
    if (projectName.length < 2)         return setError('Project name too short')
    if (ticker.length < 2)              return setError('Ticker required (2–12 chars)')
    if (description && description.length > 5000) return setError('Description too long')
    if (!allocOk)                       return setError(`Tokenomics must sum to 100% (currently ${allocSum}%)`)
    if (softCap !== '' && hardCap !== '' && Number(softCap) > Number(hardCap)) {
      return setError('Soft cap cannot exceed hard cap')
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/launchpad', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            project_name: projectName,
            ticker:       ticker.toUpperCase(),
            chain,
            description:  description || undefined,
            total_supply: totalSupply === '' ? undefined : Number(totalSupply),
            soft_cap_usd: softCap     === '' ? undefined : Number(softCap),
            hard_cap_usd: hardCap     === '' ? undefined : Number(hardCap),
            service_tier: tier,
            tokenomics: {
              team:      allocTeam,
              public:    allocPublic,
              liquidity: allocLiquidity,
              treasury:  allocTreasury,
            },
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed')
        setSuccess(`Draft created. Service fee: $${data.service_fee.toLocaleString()}. Our team will reach out.`)
        setTimeout(() => { window.location.href = '/dashboard/launchpad' }, 2000)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <div className="space-y-5">
      {/* Service tier */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-3">
          Service Tier
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {TIERS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTier(t.key)}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                tier === t.key
                  ? 'border-amber-500/50 bg-amber-500/[0.06]'
                  : 'border-border hover:border-border/80',
              )}
            >
              <p className="text-sm font-bold">{t.label}</p>
              <p className="text-lg font-bold text-amber-300 tabular-nums mt-1">
                ${t.fee.toLocaleString()}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">{t.inc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Identity */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Identity</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Project Name">
            <input
              type="text"
              value={projectName}
              onChange={e => setName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Apex Capital"
              className={inputCls}
            />
          </Field>
          <Field label="Ticker">
            <input
              type="text"
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase().slice(0, 12))}
              maxLength={12}
              placeholder="e.g. APEX"
              className={`${inputCls} font-mono`}
            />
          </Field>
        </div>
        <Field label="Chain">
          <div className="flex flex-wrap gap-1.5">
            {CHAINS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setChain(c)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                  chain === c
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={e => setDesc(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="What problem does the token solve? Who is the audience? Treasury plan…"
            className={`${inputCls} resize-none`}
          />
        </Field>
      </div>

      {/* Tokenomics */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Tokenomics</h2>
          <span className={cn(
            'text-xs font-bold tabular-nums',
            allocOk ? 'text-emerald-400' : 'text-rose-400',
          )}>
            {allocSum}% / 100%
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Total Supply">
            <input
              type="number"
              value={totalSupply}
              onChange={e => setSupply(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="e.g. 1000000000"
              className={inputCls}
            />
          </Field>
          <Field label="Hard Cap (USD)">
            <input
              type="number"
              value={hardCap}
              onChange={e => setHardCap(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="e.g. 1500000"
              className={inputCls}
            />
          </Field>
          <Field label="Soft Cap (USD)">
            <input
              type="number"
              value={softCap}
              onChange={e => setSoftCap(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="e.g. 250000"
              className={inputCls}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <AllocSlider label="Team"      value={allocTeam}      onChange={setAllocTeam} />
          <AllocSlider label="Public"    value={allocPublic}    onChange={setAllocPublic} />
          <AllocSlider label="Liquidity" value={allocLiquidity} onChange={setAllocLiq} />
          <AllocSlider label="Treasury"  value={allocTreasury}  onChange={setAllocTreasury} />
        </div>
      </div>

      {error   && <p className="text-xs text-rose-400">{error}</p>}
      {success && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-3 text-xs text-emerald-300">
          ✓ {success}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <a
          href="/dashboard/launchpad"
          className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted/30"
        >
          Cancel
        </a>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !allocOk}
          className={cn(
            'btn-premium !text-sm !py-2 !px-6',
            (pending || !allocOk) && 'opacity-60 cursor-not-allowed',
          )}
        >
          {pending ? 'Submitting…' : 'Submit Launch'}
        </button>
      </div>
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

function AllocSlider({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/30 p-3">
      <div className="flex justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-xs font-bold text-amber-300 tabular-nums">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={80}
        step={5}
        value={value}
        onChange={e => onChange(+e.target.value)}
        className="w-full accent-amber-400"
        aria-label={`${label} allocation`}
      />
    </div>
  )
}
