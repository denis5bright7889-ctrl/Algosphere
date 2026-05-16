'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

interface Conn {
  id:          string
  broker:      string
  label:       string | null
  account_id:  string | null
  is_live:     boolean
  is_testnet:  boolean
  status:      string
  equity_usd:  number | null
  is_default:  boolean
  created_at:  string
}

// `labels` overrides the generic API Key / API Secret / Passphrase
// captions per broker. MT5 reuses the three generic columns as
// login / password / server (engine drives the direct MetaTrader5 lib —
// no paid MetaApi bridge).
const BROKERS = [
  {
    key: 'binance', label: 'Binance Futures',
    fields: ['api_key', 'api_secret'],
    labels: { api_key: 'API Key', api_secret: 'API Secret' },
  },
  {
    key: 'bybit', label: 'Bybit Unified',
    fields: ['api_key', 'api_secret'],
    labels: { api_key: 'API Key', api_secret: 'API Secret' },
  },
  {
    key: 'okx', label: 'OKX',
    fields: ['api_key', 'api_secret', 'passphrase'],
    labels: { api_key: 'API Key', api_secret: 'API Secret', passphrase: 'Passphrase' },
  },
  {
    key: 'mt5', label: 'MetaTrader 5',
    fields: ['api_key', 'api_secret', 'passphrase'],
    labels: {
      api_key:    'MT5 Login (numeric account #)',
      api_secret: 'MT5 Password',
      passphrase: 'Broker Server (e.g. Pepperstone-Demo)',
    },
  },
  {
    key: 'ctrader', label: 'cTrader',
    fields: ['api_key', 'api_secret'],
    labels: { api_key: 'API Key', api_secret: 'API Secret' },
  },
] as const

const STATUS_CLS: Record<string, string> = {
  pending:      'text-amber-300 border-amber-500/40 bg-amber-500/10',
  connected:    'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  error:        'text-rose-300 border-rose-500/40 bg-rose-500/10',
  disconnected: 'text-muted-foreground border-border bg-muted/20',
  revoked:      'text-rose-400 border-rose-500/40 bg-rose-500/10',
}

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500/40'

export default function BrokersClient({ initialConnections }: { initialConnections: Conn[] }) {
  const [conns, setConns] = useState<Conn[]>(initialConnections)
  const [adding, setAdding] = useState(false)

  function onAdded(c: Conn) {
    setConns(arr => [c, ...arr])
    setAdding(false)
  }
  function onRemoved(id: string) {
    setConns(arr => arr.filter(c => c.id !== id))
  }
  function onPromoted(id: string) {
    setConns(arr => arr.map(c =>
      c.id === id ? { ...c, is_testnet: false, is_live: true } : c,
    ))
  }

  return (
    <>
      {conns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No broker connections yet. Add one to enable live execution.
          </p>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn-premium mt-4 !text-xs !py-2 !px-4"
            >
              + Connect a broker
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3 mb-4">
            {conns.map(c => (
              <ConnectionCard key={c.id} c={c} onRemoved={onRemoved} onPromoted={onPromoted} />
            ))}
          </div>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn-premium !text-xs !py-2 !px-4"
            >
              + Add another
            </button>
          )}
        </>
      )}

      {adding && <AddConnectionForm onCancel={() => setAdding(false)} onAdded={onAdded} />}
    </>
  )
}

interface Readiness {
  attempts:          number
  filled:            number
  fill_rate_pct:     number
  avg_abs_slip_pct:  number
  closed_count:      number
  avg_abs_drift_pct: number
  passes:            boolean
  reasons:           string[]
}

function ConnectionCard({
  c, onRemoved, onPromoted,
}: {
  c: Conn
  onRemoved: (id: string) => void
  onPromoted: (id: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [showGate, setShowGate] = useState(false)
  const [goLiveErr, setGoLiveErr] = useState<string | null>(null)

  function loadReadiness() {
    setShowGate(true)
    fetch(`/api/brokers/${c.id}/readiness`)
      .then(r => r.json())
      .then(d => setReadiness(d.readiness ?? null))
      .catch(() => { /* gauge stays empty */ })
  }

  function promoteLive() {
    setGoLiveErr(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/brokers/${c.id}/promote-live`, { method: 'POST' })
        const d = await res.json()
        if (!res.ok) {
          setGoLiveErr(
            d.reasons?.length ? d.reasons.join(' · ') : (d.error ?? 'Blocked'),
          )
          if (d.metrics) setReadiness(d.metrics)
          return
        }
        onPromoted(c.id)
      } catch {
        setGoLiveErr('Network error')
      }
    })
  }

  function remove() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/brokers/${c.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error()
        onRemoved(c.id)
      } catch { /* silent — UI stays */ }
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div>
          <h3 className="font-bold text-base capitalize">
            {c.broker}{c.label ? ` · ${c.label}` : ''}
            {c.is_default && (
              <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-300">
                DEFAULT
              </span>
            )}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {c.is_testnet ? '🧪 Testnet' : '⚠️ LIVE'}
            {c.account_id ? ` · ${c.account_id}` : ''}
            {' · since '}
            {new Date(c.created_at).toLocaleDateString()}
          </p>
        </div>
        <span className={cn(
          'rounded-full border px-2.5 py-0.5 text-[10px] font-bold capitalize',
          STATUS_CLS[c.status] ?? STATUS_CLS.pending,
        )}>
          ● {c.status}
        </span>
      </div>

      {c.equity_usd != null && (
        <p className="text-sm tabular-nums">
          Equity: <span className="font-bold">${c.equity_usd.toLocaleString()}</span>
        </p>
      )}

      {c.is_testnet && (
        <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
          {!showGate ? (
            <button
              type="button"
              onClick={loadReadiness}
              className="text-xs font-semibold text-amber-300 hover:underline"
            >
              ▸ Check live-execution readiness
            </button>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Live-readiness gate
              </p>
              {readiness ? (
                <div className="space-y-1.5">
                  <Metric label="Executions" value={`${readiness.attempts}`} ok={readiness.attempts >= 50} target="≥ 50" />
                  <Metric label="Fill rate"  value={`${readiness.fill_rate_pct}%`} ok={readiness.fill_rate_pct >= 95} target="≥ 95%" />
                  <Metric label="Avg slippage" value={`${readiness.avg_abs_slip_pct}%`} ok={readiness.avg_abs_slip_pct < 0.10} target="< 0.10%" />
                  <Metric label="Closed (drift)" value={`${readiness.closed_count}`} ok={readiness.closed_count >= 20} target="≥ 20" />
                  <Metric label="Avg PnL drift" value={`${readiness.avg_abs_drift_pct}%`} ok={readiness.avg_abs_drift_pct < 2.0} target="< 2.00%" />
                  <div className="pt-2">
                    {readiness.passes ? (
                      <button
                        type="button"
                        onClick={promoteLive}
                        disabled={pending}
                        className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {pending ? 'Promoting…' : '⚠ Go Live — switch to real money'}
                      </button>
                    ) : (
                      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                        Not ready: {readiness.reasons.join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Loading…</p>
              )}
              {goLiveErr && (
                <p className="mt-2 text-[11px] text-rose-400">Blocked: {goLiveErr}</p>
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400"
            >
              {pending ? 'Removing…' : 'Confirm Remove'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function AddConnectionForm({
  onCancel, onAdded,
}: { onCancel: () => void; onAdded: (c: Conn) => void }) {
  const [broker, setBroker] = useState<typeof BROKERS[number]['key']>('binance')
  const [label, setLabel]       = useState('')
  const [accountId, setAccountId] = useState('')
  const [apiKey, setApiKey]     = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [isTestnet, setIsTestnet] = useState(true)
  const [isDefault, setIsDefault] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const spec = BROKERS.find(b => b.key === broker)!
  const labels = spec.labels as Record<string, string>
  const showPassphrase = spec.fields.includes('passphrase' as never)
  const isMt5 = broker === 'mt5'

  // MT5: numeric login + non-empty password + server. Others: 8+ char key/secret.
  const canSubmit = isMt5
    ? /^\d+$/.test(apiKey) && apiSecret.length >= 1 && passphrase.trim().length > 0
    : apiKey.length >= 8 && apiSecret.length >= 8 && (!showPassphrase || passphrase.length >= 1)

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/brokers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            broker,
            label:      label || undefined,
            account_id: accountId || undefined,
            api_key:    apiKey,
            api_secret: apiSecret,
            passphrase: passphrase || undefined,
            is_testnet: isTestnet,
            is_default: isDefault,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? data.fix ?? 'Failed')
        onAdded(data.connection)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.04] p-5 space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Connect a broker</h2>
        <span className="text-[10px] text-muted-foreground">
          🔒 Encrypted with AES-256-GCM
        </span>
      </div>

      <Field label="Broker">
        <select
          value={broker}
          onChange={e => setBroker(e.target.value as typeof BROKERS[number]['key'])}
          aria-label="Broker"
          className={`${inputCls} font-sans`}
        >
          {BROKERS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </Field>

      <Field label="Label (optional)">
        <input
          type="text" value={label} onChange={e => setLabel(e.target.value)}
          maxLength={80} placeholder="e.g. My testnet" className={`${inputCls} font-sans`}
        />
      </Field>

      <Field label="Label-free account tag (optional)">
        <input
          type="text" value={accountId} onChange={e => setAccountId(e.target.value)}
          maxLength={60} placeholder="optional — distinguishes multiple keys"
          className={inputCls}
        />
      </Field>

      <Field label={labels.api_key ?? 'API Key'}>
        <input
          type={isMt5 ? 'text' : 'password'} inputMode={isMt5 ? 'numeric' : undefined}
          value={apiKey} onChange={e => setApiKey(e.target.value)}
          aria-label={labels.api_key ?? 'API Key'}
          autoComplete="off" className={inputCls}
        />
      </Field>

      <Field label={labels.api_secret ?? 'API Secret'}>
        <input
          type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)}
          aria-label={labels.api_secret ?? 'API Secret'}
          autoComplete="off" className={inputCls}
        />
      </Field>

      {showPassphrase && (
        <Field label={labels.passphrase ?? 'Passphrase'}>
          <input
            type={isMt5 ? 'text' : 'password'}
            value={passphrase} onChange={e => setPassphrase(e.target.value)}
            aria-label={labels.passphrase ?? 'Passphrase'}
            autoComplete="off" className={inputCls}
          />
        </Field>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={isTestnet} onChange={e => setIsTestnet(e.target.checked)} className="accent-amber-400" />
          <span className="font-medium">Testnet</span>
          <span className="text-muted-foreground">(strongly recommended for 14+ days)</span>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} className="accent-amber-400" />
          <span className="font-medium">Make default</span>
        </label>
      </div>

      {!isTestnet && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
          ⚠ Real money mode. Only proceed after 14+ days of testnet validation. We
          recommend keeping testnet as default until shadow-mode metrics confirm parity.
        </div>
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-xs">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !canSubmit}
          className={cn('btn-premium !text-xs !py-2 !px-5', (pending || !canSubmit) && 'opacity-50 cursor-not-allowed')}
        >
          {pending ? 'Saving…' : 'Save Connection'}
        </button>
      </div>
    </div>
  )
}

function Metric({
  label, value, ok, target,
}: { label: string; value: string; ok: boolean; target: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 tabular-nums">
        <span className={cn('font-semibold', ok ? 'text-emerald-300' : 'text-rose-400')}>
          {ok ? '✓' : '✗'} {value}
        </span>
        <span className="text-[10px] text-muted-foreground">({target})</span>
      </span>
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
