'use client'

import { useState, useTransition } from 'react'
import {
  CheckCircle2, Copy, Loader2, KeyRound, ShieldOff, AlertTriangle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface Props {
  initialVerifiedFactorId: string | null
}

type Phase = 'loading' | 'idle' | 'enrolling' | 'verifying' | 'enabled' | 'disabling'

interface EnrollState {
  factorId:  string
  qrSvg:     string          // SVG markup returned by Supabase
  secret:    string
  uri:       string
}

export default function TwoFactorClient({ initialVerifiedFactorId }: Props) {
  const supabase = createClient()
  const [phase, setPhase]       = useState<Phase>(initialVerifiedFactorId ? 'enabled' : 'idle')
  const [verifiedId, setVerifiedId] = useState<string | null>(initialVerifiedFactorId)
  const [enroll, setEnroll]     = useState<EnrollState | null>(null)
  const [code, setCode]         = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  async function startEnroll() {
    setError(null)
    setCode('')
    setPhase('enrolling')
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType:   'totp',
        friendlyName: `AlgoSphere ${new Date().toISOString().slice(0, 10)}`,
      })
      if (error) throw error
      if (!data) throw new Error('enroll returned no payload')
      setEnroll({
        factorId: data.id,
        qrSvg:    data.totp.qr_code,
        secret:   data.totp.secret,
        uri:      data.totp.uri,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  function cancelEnroll() {
    setError(null)
    setCode('')
    if (enroll) {
      supabase.auth.mfa.unenroll({ factorId: enroll.factorId }).catch(() => {})
    }
    setEnroll(null)
    setPhase('idle')
  }

  function copySecret() {
    if (!enroll) return
    navigator.clipboard?.writeText(enroll.secret).then(
      () => { setSecretCopied(true); setTimeout(() => setSecretCopied(false), 1400) },
      () => {},
    )
  }

  async function verifyCode() {
    if (!enroll) return
    const trimmed = code.trim().replace(/\s/g, '')
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setError(null)
    setPhase('verifying')
    try {
      const { data: chall, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enroll.factorId })
      if (chErr) throw chErr
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId:    enroll.factorId,
        challengeId: chall.id,
        code:        trimmed,
      })
      if (vErr) throw vErr
      setVerifiedId(enroll.factorId)
      setEnroll(null)
      setCode('')
      setPhase('enabled')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed — check the code and try again.')
      setPhase('enrolling')
    }
  }

  async function disable() {
    if (!verifiedId) return
    const trimmed = code.trim().replace(/\s/g, '')
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Enter a current 6-digit code to confirm.')
      return
    }
    setError(null)
    setPhase('disabling')
    startTransition(async () => {
      try {
        // Step up the session to AAL2 by challenge+verify, then unenroll.
        const { data: chall, error: chErr } = await supabase.auth.mfa.challenge({ factorId: verifiedId })
        if (chErr) throw chErr
        const { error: vErr } = await supabase.auth.mfa.verify({
          factorId:    verifiedId,
          challengeId: chall.id,
          code:        trimmed,
        })
        if (vErr) throw vErr
        const { error: uErr } = await supabase.auth.mfa.unenroll({ factorId: verifiedId })
        if (uErr) throw uErr
        setVerifiedId(null)
        setCode('')
        setPhase('idle')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not disable 2FA — check the code.')
        setPhase('enabled')
      }
    })
  }

  // ────────────── ENABLED state — show "On" + Disable flow ─────────────
  if (phase === 'enabled' || phase === 'disabling') {
    return (
      <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-5">
        <p className="flex items-center gap-2 text-sm font-bold text-emerald-300">
          <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} aria-hidden />
          Two-factor authentication is ON.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          You&apos;ll be asked for a 6-digit code from your authenticator app every time you sign in
          on a new device.
        </p>

        <div className="mt-4 rounded-lg border border-border/60 bg-card/40 p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <ShieldOff className="h-3.5 w-3.5 text-rose-400" strokeWidth={1.75} aria-hidden />
            Disable 2FA
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Enter your current 6-digit code to confirm. After disabling, your account is back to
            password-only.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CodeInput value={code} onChange={setCode} disabled={pending} />
            <button
              type="button"
              onClick={disable}
              disabled={pending}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300',
                pending && 'opacity-60 cursor-not-allowed',
              )}
            >
              {pending && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} aria-hidden />}
              Confirm disable
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-rose-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
            {error}
          </p>
        )}
      </section>
    )
  }

  // ────────────── ENROLLING / VERIFYING state — QR + code input ─────────
  if (phase === 'enrolling' || phase === 'verifying') {
    return (
      <section className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.04] p-5">
        <p className="text-sm font-bold">Scan with your authenticator app</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Open Google Authenticator / 1Password / Authy, scan the QR, then enter the
          first 6-digit code below to verify.
        </p>

        {enroll ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr] items-start">
            <div
              className="h-48 w-48 rounded-lg bg-white p-2"
              // The SVG returned by Supabase is trusted (signed origin); rendering inline.
              dangerouslySetInnerHTML={{ __html: enroll.qrSvg }}
            />
            <div className="space-y-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Or type this secret manually
                </p>
                <div className="mt-1 flex items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-1.5">
                  <code className="flex-1 truncate font-mono text-xs">{enroll.secret}</code>
                  <button
                    type="button"
                    onClick={copySecret}
                    aria-label="Copy secret"
                    className="rounded p-1 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  >
                    {secretCopied
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2} />
                      : <Copy          className="h-3.5 w-3.5" strokeWidth={1.75} />}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Verification code
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <CodeInput
                    value={code}
                    onChange={setCode}
                    disabled={phase === 'verifying'}
                    autoFocus
                    onSubmit={verifyCode}
                  />
                  <button
                    type="button"
                    onClick={verifyCode}
                    disabled={phase === 'verifying'}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground',
                      phase === 'verifying' && 'opacity-60 cursor-not-allowed',
                    )}
                  >
                    {phase === 'verifying' && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} aria-hidden />}
                    Verify &amp; enable
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}

        {error && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-rose-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={cancelEnroll}
            className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </section>
    )
  }

  // ────────────── IDLE — not enrolled ─────────────
  return (
    <section className="rounded-2xl border border-border/70 glass p-5">
      <p className="flex items-center gap-2 text-sm font-bold">
        <KeyRound className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
        Two-factor authentication is off.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Set it up in under a minute with any standard TOTP authenticator app — no SMS,
        no phone number required.
      </p>
      <button
        type="button"
        onClick={startEnroll}
        className="btn-premium !text-xs mt-4 !py-2 !px-4"
      >
        Enable 2FA
      </button>
      {error && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-rose-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      )}
    </section>
  )
}

// ────────────── 6-digit code input ─────────────
function CodeInput({
  value, onChange, disabled, autoFocus, onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  autoFocus?: boolean
  onSubmit?: () => void
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) { e.preventDefault(); onSubmit() } }}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label="6-digit verification code"
      placeholder="123456"
      className="w-32 rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-base tracking-[0.3em] tabular-nums focus:outline-none focus:border-amber-500/40"
    />
  )
}
