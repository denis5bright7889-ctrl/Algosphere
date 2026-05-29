'use client'
/**
 * AutotradeArmCard — the arming / mode / panic-close surface.
 *
 * Spec sections 2, 10, 11, 14. This is the single component a user
 * interacts with to opt into autonomous execution. It is also the only
 * UI that can flip profiles.full_autotrade_enabled — every other path
 * in the codebase respects the engine-side gate.
 *
 * Render rules:
 *   • No connected broker            → disabled card with a CTA to /brokers
 *   • Disarmed (default state)       → mode picker + consent checkboxes + Arm
 *   • Armed                          → mode badge + Pause + Panic close
 *   • Consent doc bumped server-side → forced re-acceptance flow
 *
 * No optimistic UI — every transition does a real round-trip and we
 * re-fetch the status before celebrating. Nothing here ever fabricates
 * an "armed" state.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ShieldCheck, Power, AlertOctagon, Loader2, Sparkles, Gauge, BookLock, ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  CONSENT_DOC_VERSION, MODE_OVERRIDES, TRADING_MODES, type TradingMode,
} from '@/lib/autotrade'

interface StatusPayload {
  autotrade_enabled:      boolean
  trading_mode:           TradingMode
  consent_version:        number
  server_consent_version: number
  consent_up_to_date:     boolean
  armed_at:               string | null
  disarmed_at:            string | null
  connected_brokers:      number
  live_brokers:           number
  mode_overrides:         (typeof MODE_OVERRIDES)[TradingMode]
}

type Phase = 'loading' | 'idle' | 'arming' | 'disarming' | 'panicking'

export default function AutotradeArmCard() {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [phase,  setPhase]  = useState<Phase>('loading')
  const [error,  setError]  = useState<string | null>(null)
  const [mode,   setMode]   = useState<TradingMode>('balanced')
  const [acceptCustody, setAcceptCustody] = useState(false)
  const [acceptRisk,    setAcceptRisk]    = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/trading/status', { cache: 'no-store' })
      if (!r.ok) throw new Error(`status HTTP ${r.status}`)
      const d = (await r.json()) as StatusPayload
      setStatus(d)
      if (d.autotrade_enabled) setMode(d.trading_mode)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed')
    } finally {
      setPhase('idle')
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const arm = useCallback(async () => {
    setError(null)
    setPhase('arming')
    try {
      const r = await fetch('/api/trading/arm', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          trading_mode:           mode,
          consent_version:        CONSENT_DOC_VERSION,
          accepts_no_custody:     true,
          accepts_execution_risk: true,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error ?? `arm HTTP ${r.status}`)
      setAcceptCustody(false)
      setAcceptRisk(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'arm failed')
      setPhase('idle')
    }
  }, [mode, refresh])

  const disarm = useCallback(async () => {
    setError(null)
    setPhase('disarming')
    try {
      const r = await fetch('/api/trading/disarm', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error ?? `disarm HTTP ${r.status}`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'disarm failed')
      setPhase('idle')
    }
  }, [refresh])

  const panic = useCallback(async () => {
    if (!confirm('Flatten EVERY open position across EVERY connected broker and disarm autonomous trading? This cannot be undone.')) return
    setError(null)
    setPhase('panicking')
    try {
      const r = await fetch('/api/trading/panic-close', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ reason: 'user_panic_button' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok && !j?.disarmed) {
        throw new Error(j?.error ?? `panic-close HTTP ${r.status}`)
      }
      if (j?.engine_error) {
        setError(`Disarmed, but flatten failed: ${j.engine_error}. Verify open positions on /brokers.`)
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'panic-close failed')
      setPhase('idle')
    }
  }, [refresh])

  if (phase === 'loading' || !status) {
    return (
      <div className="surface p-5 flex items-center gap-3 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading arming state…
      </div>
    )
  }

  const armed       = status.autotrade_enabled
  const noBrokers   = status.connected_brokers === 0
  const needsConsent= !status.consent_up_to_date
  const busy        = phase === 'arming' || phase === 'disarming' || phase === 'panicking'

  // ── Disabled-state: no broker connected ─────────────────────────────
  if (noBrokers) {
    return (
      <div className="surface p-5">
        <Header armed={false} />
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Connect at least one broker before arming autonomous execution.
          AlgoSphereQuant never trades on accounts that aren't explicitly
          linked and authorized.
        </p>
        <a
          href="/brokers"
          className="btn-premium mt-4 inline-flex !px-4 !py-2 !text-xs"
        >
          Connect a broker
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.25} />
        </a>
      </div>
    )
  }

  // ── Armed-state: show mode + Pause + Panic ──────────────────────────
  if (armed) {
    const o = status.mode_overrides
    return (
      <div className={cn(
        'surface p-5 border-emerald-500/30 bg-emerald-500/[0.04]',
      )}>
        <Header armed />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat icon={Gauge} label="Mode" value={MODE_OVERRIDES[status.trading_mode].label} />
          <Stat icon={ShieldCheck} label="Min confidence" value={`${o.min_confidence}/100`} />
          <Stat icon={Sparkles} label="Size multiplier" value={`${o.size_multiplier.toFixed(2)}×`} />
        </div>
        {o.requires_user_approval && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2.5 text-[11px] text-amber-200">
            Manual approval mode: signals queue for your tap. The engine will not fire orders until you accept.
          </p>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Armed at{' '}
          <span className="tabular-nums text-foreground/80">
            {status.armed_at ? new Date(status.armed_at).toLocaleString() : '—'}
          </span>
          {' · '}{status.connected_brokers} broker
          {status.connected_brokers !== 1 ? 's' : ''}
          {' · '}{status.live_brokers} live
        </p>
        {error && (
          <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-2.5 text-[11px] text-rose-300">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={disarm}
            disabled={busy}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-3 py-1.5 text-xs font-semibold text-foreground/85 hover:text-foreground',
              busy && 'opacity-50',
            )}
          >
            {phase === 'disarming' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
            Pause autotrade
          </button>
          <button
            type="button"
            onClick={panic}
            disabled={busy}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/15',
              busy && 'opacity-50',
            )}
          >
            {phase === 'panicking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertOctagon className="h-3.5 w-3.5" />}
            Panic close all
          </button>
        </div>
      </div>
    )
  }

  // ── Disarmed-state: arming form ─────────────────────────────────────
  const canArm = acceptCustody && acceptRisk && !busy

  return (
    <div className="surface p-5">
      <Header armed={false} />

      {needsConsent && status.consent_version > 0 && (
        <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-2.5 text-[11px] text-amber-200">
          Disclosure updated to v{status.server_consent_version}. You'll need to re-accept before arming.
        </p>
      )}

      <fieldset className="mt-4">
        <legend className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Choose a mode
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {TRADING_MODES.map((m) => {
            const o = MODE_OVERRIDES[m]
            const selected = mode === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-lg border p-3 text-left transition',
                  selected
                    ? 'border-amber-400/70 bg-amber-500/[0.06]'
                    : 'border-border bg-background/40 hover:border-border/80',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{o.label}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    ≥{o.min_confidence} conf · {o.size_multiplier.toFixed(2)}×
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{o.blurb}</p>
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="mt-5 space-y-2">
        <legend className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Risk disclosure (v{CONSENT_DOC_VERSION})
        </legend>
        <Checkbox
          checked={acceptCustody}
          onChange={setAcceptCustody}
          label="I understand AlgoSphereQuant does not custody funds. All trades execute on broker accounts I have personally connected and authorized."
        />
        <Checkbox
          checked={acceptRisk}
          onChange={setAcceptRisk}
          label="I accept that algorithmic trading carries risk of loss, that the engine may execute autonomously on my connected accounts, and that I can pause or panic-close at any time."
        />
      </fieldset>

      {error && (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-2.5 text-[11px] text-rose-300">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={arm}
        disabled={!canArm}
        className={cn(
          'btn-premium mt-5 inline-flex !px-5 !py-2.5 !text-sm',
          !canArm && 'opacity-50 cursor-not-allowed',
        )}
      >
        {phase === 'arming' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" strokeWidth={2.25} />}
        Arm autonomous execution
      </button>

      <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
        <BookLock className="h-3 w-3 mt-0.5 shrink-0" strokeWidth={1.75} />
        Acceptance is logged immutably (user_consents). The engine refuses orders until your profile shows armed=true AND consent_version={CONSENT_DOC_VERSION}.
      </p>
    </div>
  )
}

function Header({ armed }: { armed: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">Autonomous Execution</h3>
        <p className="text-[11px] text-muted-foreground">
          FULL_AUTOTRADE arming — spec sections 2, 10, 11, 14.
        </p>
      </div>
      <span className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider',
        armed
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : 'border-border bg-card text-muted-foreground',
      )}>
        <span className={cn('h-1.5 w-1.5 rounded-full', armed ? 'bg-emerald-400' : 'bg-muted-foreground/60')} />
        {armed ? 'Armed' : 'Disarmed'}
      </span>
    </div>
  )
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" strokeWidth={1.75} />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Checkbox({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label className="flex items-start gap-2 text-[12px] leading-relaxed text-foreground/85 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-background"
      />
      <span>{label}</span>
    </label>
  )
}
