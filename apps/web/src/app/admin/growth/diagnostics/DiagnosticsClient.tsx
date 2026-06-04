'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Loader2, Send } from 'lucide-react'

interface EnvCheck {
  key:   string
  set:   boolean
  hint?: string
  group: string
}

interface DiagSummary {
  total: number
  set:   number
  by_group: Record<string, { total: number; set: number }>
}

interface MetaTokenInfo {
  configured:    boolean
  status:        'OK' | 'EXPIRES_SOON' | 'EXPIRED' | 'INVALID' | 'NO_NETWORK' | 'NOT_CONFIGURED'
  expires_in_s?: number
  expires_at?:   string
  scopes?:       string[]
  type?:         string
  app_id?:       string
  error?:        string
}

interface MisnamedKey {
  wrong: string
  right: string
  note:  string
}

interface DiagResponse {
  checked_at:        string
  summary:           DiagSummary
  checks:            EnvCheck[]
  meta_token?:       MetaTokenInfo
  misnamed_env_keys?: MisnamedKey[]
}

interface SmokeResult {
  channel:      string
  ok:           boolean
  external_id?: string
  external_url?: string
  error?:       string
  skipped?:     string
}

interface SmokeResponse {
  fired_at: string
  summary:  { total: number; succeeded: number; failed: number; skipped: number }
  results:  SmokeResult[]
}

const GROUP_LABEL: Record<string, string> = {
  core:            'Core',
  email:           'Email (Resend)',
  telegram:        'Telegram',
  discord_growth:  'Discord — Growth',
  discord_ops:     'Discord — Ops + User',
  discord_engine:  'Discord — Engine (Railway)',
  meta:            'Meta (Facebook + Instagram)',
  linkedin:        'LinkedIn',
  x:               'X (Twitter)',
  video:           'Video (Creatomate)',
}

export default function DiagnosticsClient() {
  const [diag, setDiag]       = useState<DiagResponse | null>(null)
  const [smoke, setSmoke]     = useState<SmokeResponse | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [pending, start]      = useTransition()
  const [activeAction, setActiveAction] = useState<'diag' | 'smoke' | null>(null)

  function checkEnv() {
    setError(null); setActiveAction('diag')
    start(async () => {
      const r = await fetch('/api/admin/growth/diagnostics', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Failed'); return }
      setDiag(j)
    })
  }

  function smokeTest() {
    setError(null); setActiveAction('smoke')
    start(async () => {
      const r = await fetch('/api/admin/growth/smoke-test', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Failed'); return }
      setSmoke(j)
    })
  }

  const groups = diag
    ? Array.from(new Set(diag.checks.map(c => c.group)))
    : []

  return (
    <div className="space-y-5">
      <header>
        <Link href="/admin/growth" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Growth Engine
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Diagnostics</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Check which integrations are configured in this environment, and fire a one-off real post to every wired channel.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={checkEnv}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
        >
          {pending && activeAction === 'diag' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Check env config
        </button>
        <button
          type="button"
          onClick={smokeTest}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md border border-amber-500/60 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {pending && activeAction === 'smoke' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Smoke-test all channels
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Misnamed env keys — proactive warning when the operator set
          a wrong key name (e.g. DISCORD_WEBHOOK_BUGREPORTS_URL vs the
          underscored canonical). Shown before the env grid so they
          fix it BEFORE chasing red rows in the grid. */}
      {diag && diag.misnamed_env_keys && diag.misnamed_env_keys.length > 0 && (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-5">
          <header className="mb-3 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-amber-300" />
            <h2 className="text-sm font-bold text-amber-200">
              Misnamed env keys detected ({diag.misnamed_env_keys.length})
            </h2>
          </header>
          <p className="mb-3 text-[12px] text-amber-200/80">
            You set these keys, but the code reads a different name. Rename in
            Vercel — the value stays the same.
          </p>
          <ul className="space-y-2">
            {diag.misnamed_env_keys.map((m, i) => (
              <li key={i} className="rounded-lg border border-amber-500/30 bg-background/30 p-3 text-[12px]">
                <div className="flex items-start gap-2">
                  <code className="font-mono text-rose-300 line-through">{m.wrong}</code>
                  <span className="text-amber-300">→</span>
                  <code className="font-mono text-emerald-300">{m.right}</code>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{m.note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Meta token health — catches short-lived tokens BEFORE they
          expire. The Jun 02 incident: a USER token was loaded, smoke-
          tested green at deploy, expired in 12 hours, broke FB+IG
          posting silently. This row flags expiry early. */}
      {diag && diag.meta_token && diag.meta_token.configured && (
        <section className={
          'rounded-2xl border p-5 ' + (
            diag.meta_token.status === 'OK'           ? 'border-emerald-500/40 bg-emerald-500/[0.05]'
            : diag.meta_token.status === 'EXPIRES_SOON'? 'border-amber-500/50 bg-amber-500/[0.06]'
            : 'border-rose-500/50 bg-rose-500/[0.08]'
          )
        }>
          <header className="mb-3 flex items-center gap-2">
            {diag.meta_token.status === 'OK'
              ? <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              : <XCircle      className="h-4 w-4 text-rose-300" />}
            <h2 className="text-sm font-bold">
              Meta token · {diag.meta_token.status.replace('_', ' ')}
            </h2>
          </header>
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <DefRow label="Type"      value={diag.meta_token.type ?? '—'} />
            <DefRow label="App ID"    value={diag.meta_token.app_id ?? '—'} />
            <DefRow label="Expires"   value={
              diag.meta_token.expires_in_s === 0 ? 'Never (System User token)'
              : diag.meta_token.expires_at        ? `${new Date(diag.meta_token.expires_at).toLocaleString()} (${formatRemaining(diag.meta_token.expires_in_s)})`
              : '—'
            } />
            <DefRow label="Scopes"    value={diag.meta_token.scopes?.length ? `${diag.meta_token.scopes.length} granted` : '—'} />
          </div>
          {diag.meta_token.scopes && diag.meta_token.scopes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {diag.meta_token.scopes.map((s) => (
                <code key={s} className="rounded border border-border/60 bg-background/40 px-1.5 py-0.5 font-mono text-[10px]">
                  {s}
                </code>
              ))}
            </div>
          )}
          {diag.meta_token.error && (
            <p className="mt-3 text-[11px] text-rose-200">{diag.meta_token.error}</p>
          )}
          {diag.meta_token.status === 'EXPIRES_SOON' || diag.meta_token.status === 'EXPIRED' || diag.meta_token.status === 'INVALID' ? (
            <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
              Mint a <strong>System User token</strong> in Business Settings → System Users
              → assign your Page → generate token with <code>pages_manage_posts</code>,
              <code> instagram_basic</code>, <code>instagram_content_publish</code>. System User
              tokens never expire.
            </p>
          ) : null}
        </section>
      )}

      {/* Env diagnostics */}
      {diag && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-sm font-bold">Environment</h2>
            <p className="text-[11px] text-muted-foreground">
              {diag.summary.set} / {diag.summary.total} env vars set ·
              checked {new Date(diag.checked_at).toLocaleString()}
            </p>
          </header>

          <div className="space-y-4">
            {groups.map(g => (
              <div key={g}>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
                  {GROUP_LABEL[g] ?? g}{' '}
                  <span className="text-muted-foreground">
                    ({diag.summary.by_group[g]?.set ?? 0} / {diag.summary.by_group[g]?.total ?? 0})
                  </span>
                </p>
                <ul className="space-y-1">
                  {diag.checks.filter(c => c.group === g).map(c => (
                    <li key={c.key} className="flex items-start gap-2 text-[12px]">
                      {c.set
                        ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" strokeWidth={2} />
                        : <XCircle      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300"    strokeWidth={2} />}
                      <code className="flex-1 break-all font-mono text-[12px]">{c.key}</code>
                      {c.hint && (
                        <span className={
                          'text-[11px] tabular-nums ' + (
                            c.hint.includes('⚠') ? 'text-amber-300' : 'text-muted-foreground'
                          )
                        }>
                          {c.hint}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Smoke test results */}
      {smoke && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-sm font-bold">Smoke test</h2>
            <p className="text-[11px] text-muted-foreground">
              {smoke.summary.succeeded} ok · {smoke.summary.failed} failed · {smoke.summary.skipped} skipped ·
              fired {new Date(smoke.fired_at).toLocaleString()}
            </p>
          </header>

          <ul className="space-y-1.5">
            {smoke.results.map((r) => (
              <li key={r.channel} className="flex items-start gap-2 text-[12px]">
                {r.skipped
                  ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" strokeWidth={2} />
                  : r.ok
                    ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" strokeWidth={2} />
                    : <XCircle      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300"    strokeWidth={2} />}
                <code className="w-44 shrink-0 font-mono text-[12px]">{r.channel}</code>
                <span className="flex-1 break-words text-[12px] text-muted-foreground">
                  {r.skipped ?? r.error ?? (r.external_id ? `id ${r.external_id}` : 'posted')}
                </span>
                {r.external_url && (
                  <a href={r.external_url} target="_blank" rel="noopener" className="shrink-0 text-[11px] font-semibold text-emerald-300 hover:underline">
                    open
                  </a>
                )}
              </li>
            ))}
          </ul>

          <p className="mt-4 text-[11px] text-muted-foreground">
            Failed rows usually mean the env var isn&apos;t set in Vercel, OR
            the value is wrong (e.g. expired token, revoked webhook).
            Cross-check against the diagnostics panel above.
          </p>
        </section>
      )}
    </div>
  )
}


function DefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-[12px] break-all">{value}</div>
    </div>
  )
}

function formatRemaining(seconds?: number): string {
  if (seconds === undefined) return ''
  if (seconds < 0) return 'expired'
  if (seconds === 0) return 'never expires'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  if (days >= 1)  return `${days}d ${hours}h left`
  if (hours >= 1) return `${hours}h left`
  return `${Math.floor(seconds / 60)}m left`
}
