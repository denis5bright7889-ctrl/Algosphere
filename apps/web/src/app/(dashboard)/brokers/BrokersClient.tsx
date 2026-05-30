'use client'

import { useState, useTransition } from 'react'
import { FlaskConical, AlertTriangle, Info, Pin, RefreshCw, Ban, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Conn {
  id:                 string
  broker:             string
  label:              string | null
  account_id:         string | null
  is_live:            boolean
  is_testnet:         boolean
  status:             string
  equity_usd:         number | null
  equity_updated_at:  string | null
  error_message:      string | null
  is_default:         boolean
  created_at:         string
}

// `labels` overrides the generic API Key / API Secret / Passphrase
// captions per broker. MT5 reuses the three generic columns as
// login / password / server (engine drives the direct MetaTrader5 lib —
// no paid MetaApi bridge).
// `needs` lists exactly which credential inputs a broker requires,
// drawn from {api_key, api_secret, passphrase, account_id}. The form
// renders + validates only those. `labels` overrides the caption per
// field. account_id is the dedicated account column (OANDA account #,
// Tradovate username); for crypto it stays an optional disambiguator.
const BROKERS = [
  {
    key: 'binance', label: 'Binance Futures',
    needs: ['api_key', 'api_secret'],
    labels: { api_key: 'API Key', api_secret: 'API Secret' },
  },
  {
    key: 'bybit', label: 'Bybit Unified',
    needs: ['api_key', 'api_secret'],
    labels: { api_key: 'API Key', api_secret: 'API Secret' },
  },
  {
    key: 'okx', label: 'OKX',
    needs: ['api_key', 'api_secret', 'passphrase'],
    labels: { api_key: 'API Key', api_secret: 'API Secret', passphrase: 'Passphrase' },
  },
  {
    key: 'mt5', label: 'MetaTrader 5',
    needs: ['api_key', 'api_secret', 'passphrase'],
    labels: {
      api_key:    'MT5 Login (numeric account #)',
      api_secret: 'MT5 Password',
      passphrase: 'Broker Server (e.g. Pepperstone-Demo)',
    },
  },
  {
    key: 'oanda', label: 'OANDA',
    needs: ['api_key', 'account_id'],
    labels: {
      api_key:    'OANDA API Token',
      account_id: 'Account ID (e.g. 001-001-1234567-001)',
    },
  },
  {
    key: 'tradovate', label: 'Tradovate (Futures)',
    needs: ['account_id', 'api_secret'],
    labels: {
      account_id: 'Tradovate Username',
      api_secret: 'Tradovate Password',
    },
  },
  {
    key: 'ctrader', label: 'cTrader',
    needs: ['api_key', 'api_secret'],
    labels: { api_key: 'API Key', api_secret: 'API Secret' },
  },
] as const

// State machine: pending (transient, capped at 2 cycles), testing
// (synchronous handshake in flight), connected, failed, disabled
// (environment-level — e.g. MT5 on Linux), revoked. Legacy values
// 'error' / 'disconnected' map onto 'failed' for older rows that
// existed before the migration; both kept here defensively.
const STATUS_CLS: Record<string, string> = {
  pending:      'text-amber-300 border-amber-500/40 bg-amber-500/10',
  testing:      'text-amber-200 border-amber-500/40 bg-amber-500/10 animate-pulse',
  connected:    'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  failed:       'text-rose-300 border-rose-500/40 bg-rose-500/10',
  error:        'text-rose-300 border-rose-500/40 bg-rose-500/10',
  disconnected: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
  disabled:     'text-zinc-300 border-zinc-500/40 bg-zinc-500/10',
  revoked:      'text-rose-400 border-rose-500/40 bg-rose-500/10',
}

const STATUS_LABEL: Record<string, string> = {
  pending:   'Pending',
  testing:   'Testing…',
  connected: 'Connected',
  failed:    'Failed',
  error:     'Failed',
  disconnected: 'Failed',
  disabled:  'Disabled',
  revoked:   'Revoked',
}

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500/40'

export default function BrokersClient({ initialConnections }: { initialConnections: Conn[] }) {
  const [conns, setConns] = useState<Conn[]>(initialConnections)
  const [adding, setAdding] = useState(false)
  const [paperPending, paperStart] = useTransition()
  const [paperError, setPaperError] = useState<string | null>(null)

  const hasPaper = conns.some(c => c.broker === 'paper')

  function startPaperTrading() {
    setPaperError(null)
    paperStart(async () => {
      try {
        const res = await fetch('/api/brokers/paper', { method: 'POST' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed')
        // 201 = inserted; 200 = existing row returned.
        if (res.status === 201) {
          setConns(arr => [data.connection, ...arr])
        } else {
          setConns(arr => arr.map(c =>
            c.id === data.connection.id ? data.connection : c,
          ))
        }
      } catch (e) {
        setPaperError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

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
  function onDefaulted(id: string) {
    setConns(arr => arr.map(c => ({ ...c, is_default: c.id === id })))
  }

  return (
    <>
      {!hasPaper && (
        <div className="mb-4 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/[0.08] to-amber-500/[0.02] p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" strokeWidth={1.75} aria-hidden />
            <div className="flex-1">
              <h3 className="text-sm font-bold">Try paper trading — no API keys needed</h3>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Spin up a $10,000 virtual account. The engine simulates fills with
                realistic slippage (5 bps), latency (50–500 ms), and a 1% rejection
                rate — so equity, drawdown, win rate, and execution analytics
                surface the same friction you&apos;d see live.
              </p>
              {paperError && (
                <p className="mt-2 text-[11px] text-rose-400">Error: {paperError}</p>
              )}
              <button
                type="button"
                onClick={startPaperTrading}
                disabled={paperPending}
                className={cn('btn-premium mt-3 !text-xs !py-2 !px-4', paperPending && 'opacity-50 cursor-not-allowed')}
              >
                {paperPending ? 'Setting up…' : 'Start paper trading'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <ConnectionCard
                key={c.id}
                c={c}
                onRemoved={onRemoved}
                onPromoted={onPromoted}
                onDefaulted={onDefaulted}
              />
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
  c: initial, onRemoved, onPromoted, onDefaulted,
}: {
  c: Conn
  onRemoved: (id: string) => void
  onPromoted: (id: string) => void
  onDefaulted: (id: string) => void
}) {
  const [c, setConn] = useState<Conn>(initial)
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [showGate, setShowGate] = useState(false)
  const [goLiveErr, setGoLiveErr] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  // Retry the engine handshake on demand. DISABLED rows are excluded
  // — re-pinging the engine won't change a structural environment
  // limitation. REVOKED rows are read-only too.
  function retryConnection() {
    if (c.status === 'disabled' || c.status === 'revoked') return
    setRetryError(null)
    setRetrying(true)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/brokers/${c.id}/test`, { method: 'POST' })
        const d = await res.json()
        if (!res.ok) {
          setRetryError(d.error ?? 'engine unreachable')
          return
        }
        if (d.connection) {
          setConn(d.connection as Conn)
        }
      } catch {
        setRetryError('Network error')
      } finally {
        setRetrying(false)
      }
    })
  }

  function setDefault() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/brokers/${c.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_default: true }),
        })
        if (!res.ok) throw new Error()
        onDefaulted(c.id)
      } catch { /* silent — UI stays */ }
    })
  }

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
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            {c.is_testnet
              ? <FlaskConical  className="h-3 w-3" strokeWidth={1.75} aria-hidden />
              : <AlertTriangle className="h-3 w-3 text-rose-400" strokeWidth={1.75} aria-hidden />}
            <span>{c.is_testnet ? 'Testnet' : 'LIVE'}</span>
            {c.account_id && <span>· {c.account_id}</span>}
            <span>· since {new Date(c.created_at).toLocaleDateString()}</span>
          </p>
        </div>
        <span className={cn(
          'rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
          STATUS_CLS[c.status] ?? STATUS_CLS.pending,
        )}>
          {c.status === 'disabled' ? <Ban className="-mt-px mr-1 inline h-3 w-3" strokeWidth={2} aria-hidden /> : '● '}
          {STATUS_LABEL[c.status] ?? c.status}
        </span>
      </div>

      {c.equity_usd != null && (
        <p className="text-sm tabular-nums">
          Equity: <span className="font-bold">${c.equity_usd.toLocaleString()}</span>
          {c.equity_updated_at && (
            <span className="ml-2 text-[10px] text-muted-foreground">
              · synced {new Date(c.equity_updated_at).toLocaleString()}
            </span>
          )}
        </p>
      )}

      {/* Truthful per-status explainer — never claims a state that isn't real. */}
      <StatusExplainer c={c} />

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

      {retryError && (
        <p className="mt-2 text-[11px] text-rose-400">
          Retry failed: {retryError}
        </p>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {c.status !== 'connected'
          && c.status !== 'disabled'
          && c.status !== 'revoked'
          && (
          <button
            type="button"
            onClick={retryConnection}
            disabled={pending || retrying}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', retrying && 'animate-spin')} strokeWidth={2} aria-hidden />
            {retrying ? 'Testing…' : 'Retry connection'}
          </button>
        )}
        {!c.is_default && (
          <button
            type="button"
            onClick={setDefault}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-50"
          >
            <Pin className="h-3 w-3" strokeWidth={2} aria-hidden /> Set as default
          </button>
        )}
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
  const needs = spec.needs as readonly string[]
  const needApiKey    = needs.includes('api_key')
  const needApiSecret = needs.includes('api_secret')
  const needPassphrase= needs.includes('passphrase')
  const needAccount   = needs.includes('account_id')
  const isMt5 = broker === 'mt5'

  // Per-broker validation against the fields the broker actually needs.
  const canSubmit = isMt5
    ? /^\d+$/.test(apiKey) && apiSecret.length >= 1 && passphrase.trim().length > 0
    : (
        (!needApiKey    || apiKey.length    >= (broker === 'oanda' ? 20 : 8)) &&
        (!needApiSecret || apiSecret.length >= 1) &&
        (!needPassphrase|| passphrase.length >= 1) &&
        (!needAccount   || accountId.trim().length >= 1)
      )

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
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          // Translate the server's internal error string into something the
          // user can act on. The most common cause is the encryption key
          // not being configured on the deploy — that's an infra fix, not
          // something the trader can resolve themselves.
          const raw = data?.error ?? data?.fix ?? `HTTP ${res.status}`
          const friendly =
            res.status === 503 || /CREDENTIAL_ENCRYPTION_KEY|vault/i.test(String(raw))
              ? 'Broker credential encryption is unavailable on the server. Please contact support — the AlgoSphere team needs to configure the encryption key before connections can be saved.'
              : res.status === 409
              ? raw
              : raw
          throw new Error(friendly)
        }
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

      <Field label={needAccount ? (labels.account_id ?? 'Account ID') : 'Account number (optional)'}>
        <input
          type="text" value={accountId} onChange={e => setAccountId(e.target.value)}
          maxLength={60}
          placeholder={needAccount ? '' : 'distinguishes multiple keys on the same broker'}
          aria-label={needAccount ? (labels.account_id ?? 'Account ID') : 'Account number'}
          className={`${inputCls} font-sans`}
        />
      </Field>

      {needApiKey && (
        <Field label={labels.api_key ?? 'API Key'}>
          <input
            type={isMt5 ? 'text' : 'password'} inputMode={isMt5 ? 'numeric' : undefined}
            value={apiKey} onChange={e => setApiKey(e.target.value)}
            aria-label={labels.api_key ?? 'API Key'}
            autoComplete="off" className={inputCls}
          />
        </Field>
      )}

      {needApiSecret && (
        <Field label={labels.api_secret ?? 'API Secret'}>
          <input
            type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)}
            aria-label={labels.api_secret ?? 'API Secret'}
            autoComplete="off" className={inputCls}
          />
        </Field>
      )}

      {needPassphrase && (
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

/**
 * Tells the user — truthfully — what the current status means and
 * what unlocks the next transition. Critically: never claims a
 * handshake happened when one hasn't. DISABLED specifically names
 * the environment limitation (MT5 on Linux) so the user doesn't
 * conflate it with a credential issue they can fix.
 */
function StatusExplainer({ c }: { c: Conn }) {
  const isMt5 = c.broker === 'mt5'

  if (c.status === 'disabled') {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-zinc-500/40 bg-zinc-500/10 p-3 text-[11px] text-zinc-200">
        <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <div className="space-y-1">
          <p>
            <span className="font-semibold">Disabled in this environment.</span>{' '}
            {/* Prefer the engine's own reason — it's bridge-aware now and
                names the real cause. Fall back to a truthful default. */}
            {c.error_message
              ?? (isMt5
                ? 'The MetaTrader 5 bridge is not reachable from the engine yet.'
                : 'This broker is not supported in the current deploy.')}
          </p>
          {isMt5 && (
            <p className="text-zinc-300/80">
              MT5 executes through the Windows bridge service
              (<span className="font-mono">mt5.algospherequant.com</span>) — the Linux
              engine delegates to it over HTTP. To enable, set{' '}
              <span className="font-mono">MT5_BRIDGE_URL</span> on the engine and redeploy.
              Crypto testnet brokers (Binance / Bybit / OKX) work as-is.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (c.status === 'pending' || c.status === 'testing') {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-[11px] text-amber-200/90">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <div className="space-y-1">
          <p>
            <span className="font-semibold">
              {c.status === 'testing' ? 'Handshake in progress.' : 'Encrypted credentials saved.'}
            </span>{' '}
            Status flips to <span className="font-mono">connected</span> after the engine
            completes a successful broker API round-trip — we never mark a connection live
            without it. If the handshake doesn&apos;t resolve within 2 probe cycles
            (~20 minutes), the row auto-flips to <span className="font-mono">failed</span>.
          </p>
        </div>
      </div>
    )
  }

  if (c.status === 'failed' || c.status === 'error' || c.status === 'disconnected' || c.status === 'revoked') {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[11px] text-rose-200">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <div className="space-y-1">
          <p>
            <span className="font-semibold">{STATUS_LABEL[c.status] ?? c.status}</span> — the
            engine&apos;s last attempt to reach the broker failed.
          </p>
          {c.error_message && (
            <p className="font-mono text-[10px] text-rose-300/80 break-all">{c.error_message}</p>
          )}
          <p className="text-rose-200/70">
            Check API key permissions (read + trade, no withdrawal),{' '}
            {isMt5 ? 'verify the MT5 server name exactly matches your broker, ' : ''}
            or click <span className="font-semibold">Retry connection</span> after fixing the
            credentials.
          </p>
        </div>
      </div>
    )
  }

  return null
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
