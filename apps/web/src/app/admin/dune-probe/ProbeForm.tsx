'use client'

import { useState, useTransition } from 'react'
import { AlertCircle, Loader2, Play, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProbeResult {
  query_id: number
  rows: Record<string, unknown>[]
  columns: string[]
  executedAt: string | null
  source: 'latest' | 'executed'
  row_count: number
  took_ms: number
}

interface ProbeError {
  error: string
  code?: string
}

type Param = { key: string; value: string }

/**
 * Admin probe form. Surfaces every Dune client knob (query_id, mode,
 * parameters, latest-mode limit/offset, execute-mode performance) and
 * renders the raw API response — rows + column list + executedAt +
 * took_ms — so the operator can verify a query's column shape against
 * the contract in services/onchain/providers/dune/README.md before
 * relying on it in an Intelligence dashboard.
 *
 * Never invents data. On error it shows the server's exact error code
 * and message.
 */
export default function ProbeForm() {
  const [queryId, setQueryId] = useState('')
  const [mode, setMode] = useState<'latest' | 'execute'>('latest')
  const [params, setParams] = useState<Param[]>([])
  const [limit, setLimit] = useState('5')
  const [offset, setOffset] = useState('')
  const [performance, setPerformance] = useState<'medium' | 'large'>('medium')

  const [result, setResult] = useState<ProbeResult | null>(null)
  const [error, setError] = useState<ProbeError | null>(null)
  const [pending, startTransition] = useTransition()

  function addParam() { setParams((p) => [...p, { key: '', value: '' }]) }
  function setParam(i: number, patch: Partial<Param>) {
    setParams((p) => p.map((x, j) => (i === j ? { ...x, ...patch } : x)))
  }
  function removeParam(i: number) {
    setParams((p) => p.filter((_, j) => j !== i))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setResult(null); setError(null)

    const idNum = Number(queryId.trim())
    if (!Number.isInteger(idNum) || idNum <= 0) {
      setError({ error: 'Query ID must be a positive integer.' })
      return
    }

    const parameters: Record<string, string | number | boolean> = {}
    for (const p of params) {
      const k = p.key.trim(); if (!k) continue
      const v = p.value.trim()
      // Cast pure numbers / booleans so the Dune query receives the
      // right type when its SQL declares typed parameters.
      parameters[k] = v === 'true' ? true : v === 'false' ? false
                    : v !== '' && !Number.isNaN(Number(v)) ? Number(v)
                    : v
    }

    const body: Record<string, unknown> = { query_id: idNum, mode }
    if (Object.keys(parameters).length) body.parameters = parameters
    if (mode === 'latest') {
      if (limit.trim())  body.limit  = Math.max(1, Math.min(10_000, Number(limit) || 5))
      if (offset.trim()) body.offset = Math.max(0, Number(offset) || 0)
    } else {
      body.performance = performance
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/dune-probe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) { setError({ error: json?.error ?? `HTTP ${res.status}`, code: json?.code }); return }
        setResult(json as ProbeResult)
      } catch (e) {
        setError({ error: e instanceof Error ? e.message : 'Network error' })
      }
    })
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-5 rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Query ID" hint="Numeric ID from dune.com">
            <input
              type="text"
              inputMode="numeric"
              value={queryId}
              onChange={(e) => setQueryId(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="e.g. 1234567"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm focus:border-amber-500/40 focus:outline-none"
              required
            />
          </Field>
          <Field label="Mode">
            <div className="flex gap-2">
              {(['latest', 'execute'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition-colors',
                    mode === m
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                      : 'border-border bg-card text-muted-foreground hover:border-amber-500/30 hover:text-foreground',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {mode === 'latest' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Limit" hint="1–10000">
              <input
                type="text" inputMode="numeric" value={limit}
                onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ''))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-amber-500/40 focus:outline-none"
              />
            </Field>
            <Field label="Offset" hint="optional">
              <input
                type="text" inputMode="numeric" value={offset}
                onChange={(e) => setOffset(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-amber-500/40 focus:outline-none"
              />
            </Field>
          </div>
        ) : (
          <Field label="Performance" hint="execute mode only · costs Dune credits">
            <div className="flex gap-2">
              {(['medium', 'large'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPerformance(p)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition-colors',
                    performance === p
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                      : 'border-border bg-card text-muted-foreground hover:border-amber-500/30 hover:text-foreground',
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field
          label="Query parameters"
          hint="Match {{name}} declarations in your Dune SQL"
        >
          <div className="space-y-2">
            {params.length === 0 && (
              <p className="text-[11px] text-muted-foreground">None — add one if your query takes parameters.</p>
            )}
            {params.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={p.key}
                  onChange={(e) => setParam(i, { key: e.target.value })}
                  placeholder="name"
                  className="w-1/3 rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs focus:border-amber-500/40 focus:outline-none"
                />
                <input
                  type="text"
                  value={p.value}
                  onChange={(e) => setParam(i, { value: e.target.value })}
                  placeholder="value"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-amber-500/40 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeParam(i)}
                  aria-label="Remove parameter"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/30 hover:text-rose-300"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addParam}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-amber-500/40 hover:text-amber-300"
            >
              + Add parameter
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="submit"
            disabled={pending || !queryId}
            className="btn-premium !text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden /> Probing…</>
              : <><Play className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> Run probe</>}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <div>
            <p className="font-semibold">Probe failed</p>
            <p className="font-mono text-xs">{error.error}</p>
            {error.code && (
              <p className="mt-0.5 text-[10px] text-rose-300/80">code: {error.code}</p>
            )}
          </div>
        </div>
      )}

      {result && <ProbeResultPanel result={result} />}
    </>
  )
}

function ProbeResultPanel({ result }: { result: ProbeResult }) {
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-[11px]">
        <span className="font-semibold text-emerald-300">✓ {result.row_count} row{result.row_count === 1 ? '' : 's'}</span>
        <span className="text-muted-foreground">·</span>
        <span className="font-mono text-muted-foreground">source: {result.source}</span>
        <span className="text-muted-foreground">·</span>
        <span className="font-mono text-muted-foreground">{result.took_ms} ms</span>
        {result.executedAt && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono text-muted-foreground">
              executed: {new Date(result.executedAt).toLocaleString()}
            </span>
          </>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Columns ({result.columns.length})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {result.columns.map((c) => (
            <span
              key={c}
              className="rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[10px] text-foreground/80"
            >
              {c}
            </span>
          ))}
        </div>
      </div>

      {result.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-xs">
            <thead className="border-b border-border/60 bg-muted/20">
              <tr>
                {result.columns.map((c) => (
                  <th key={c} className="px-3 py-2 text-left font-semibold text-muted-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                  {result.columns.map((c) => (
                    <td key={c} className="px-3 py-2 font-mono">
                      {formatCell(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="rounded-xl border border-border/60 bg-card/50 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Raw JSON
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto text-[10px] leading-relaxed text-muted-foreground">
{JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v)
  return s.length > 120 ? s.slice(0, 117) + '…' : s
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
