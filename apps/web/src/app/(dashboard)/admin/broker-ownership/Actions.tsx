'use client'
/**
 * Admin actions per ownership row: force-transfer (pick from contention
 * or paste any user_id) and revoke (optionally disable connections). Both
 * call the admin POST endpoints; the page refreshes on success.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  fingerprint:      string
  ownerUserId:      string
  ownershipMode:    string     // single_owner | shared | revoked
  contention:       string[]   // any non-owner user_ids (transfer targets)
  activeContenders: string[]   // only status=active_contention (dismiss/resolve targets)
}

export default function Actions({ fingerprint, ownerUserId, ownershipMode, contention, activeContenders }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg]    = useState<string | null>(null)

  // Transfer state
  const [target, setTarget] = useState(contention[0] ?? '')
  const [tReason, setTReason] = useState('')

  // Revoke state
  const [rReason, setRReason] = useState('')
  const [disableConns, setDisableConns] = useState(false)

  async function run(url: string, body: object, label: string) {
    setMsg(null)
    start(async () => {
      try {
        const res = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        if (!res.ok || !data.ok) { setMsg(`${label} failed: ${data.error ?? res.statusText}`); return }
        setMsg(`${label} ok`)
        router.refresh()
      } catch (e) {
        setMsg(`${label} failed: ${(e as Error).message}`)
      }
    })
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border bg-background/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Admin actions</div>

      {/* Ownership mode — single_owner (strict) / shared (multi-user) / revoked. */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium">Ownership mode</span>
          <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase">{ownershipMode}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {(['single_owner', 'shared', 'revoked'] as const).map(m => (
            <button key={m} type="button" disabled={pending || m === ownershipMode}
                    onClick={() => run(`/api/admin/broker-ownership/${fingerprint}/set-ownership-mode`,
                                       { mode: m }, `Set ${m}`)}
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-40 ${
                      m === 'shared' ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
                      : m === 'revoked' ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>
              {m === 'single_owner' ? 'Single owner' : m === 'shared' ? 'Shared' : 'Revoke'}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Single = strict 1-owner. Shared = multi-user opt-in. Revoke = owner cleared, reassign via transfer.
        </p>
      </div>

      {/* Resolve / dismiss contenders — clears active contention, keeps audit. */}
      {activeContenders.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium">Active contenders</div>
            <button type="button" disabled={pending}
                    onClick={() => run(`/api/admin/broker-ownership/${fingerprint}/resolve-all`,
                                       { action: 'resolve' }, 'Resolve all')}
                    className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40">
              Resolve all ({activeContenders.length})
            </button>
          </div>
          <ul className="space-y-1">
            {activeContenders.map(uid => (
              <li key={uid} className="flex items-center gap-1.5 rounded border px-2 py-1">
                <code className="font-mono text-[10px]">{uid.slice(0,8)}</code>
                <button type="button" disabled={pending}
                        onClick={() => run(`/api/admin/broker-ownership/${fingerprint}/contender`,
                                           { contender_user_id: uid, action: 'resolve' }, 'Resolve')}
                        className="ml-auto rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40">
                  Resolve
                </button>
                <button type="button" disabled={pending}
                        onClick={() => run(`/api/admin/broker-ownership/${fingerprint}/contender`,
                                           { contender_user_id: uid, action: 'dismiss' }, 'Dismiss')}
                        className="rounded bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-40">
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1 border-t pt-3">
        <div className="text-[11px] font-medium">Force-transfer ownership</div>
        <div className="flex flex-wrap gap-1">
          <select value={target} onChange={e => setTarget(e.target.value)}
                  aria-label="Transfer ownership to contender"
                  title="Transfer ownership to contender"
                  className="rounded border bg-background px-2 py-1 text-[11px]">
            <option value="">— pick user_id —</option>
            {contention.map(u => <option key={u} value={u}>{u.slice(0,8)}… (contender)</option>)}
          </select>
          <input type="text" placeholder="…or paste a full uuid" value={target}
                 onChange={e => setTarget(e.target.value)}
                 className="flex-1 rounded border bg-background px-2 py-1 font-mono text-[11px]" />
        </div>
        <input type="text" placeholder="reason (optional)" value={tReason}
               onChange={e => setTReason(e.target.value)}
               className="w-full rounded border bg-background px-2 py-1 text-[11px]" />
        <button type="button" disabled={pending || !target || target === ownerUserId}
                onClick={() => run(`/api/admin/broker-ownership/${fingerprint}/transfer`,
                                   { new_owner_user_id: target, reason: tReason || undefined }, 'Transfer')}
                className="rounded bg-amber-500/20 px-3 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/30 disabled:opacity-40">
          Transfer
        </button>
      </div>

      <div className="space-y-1 border-t pt-3">
        <div className="text-[11px] font-medium">Revoke ownership</div>
        <input type="text" placeholder="reason (optional)" value={rReason}
               onChange={e => setRReason(e.target.value)}
               className="w-full rounded border bg-background px-2 py-1 text-[11px]" />
        <label className="flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={disableConns} onChange={e => setDisableConns(e.target.checked)} />
          Also disable all broker_connections referencing this fingerprint
        </label>
        <button type="button" disabled={pending}
                onClick={() => run(`/api/admin/broker-ownership/${fingerprint}/revoke`,
                                   { reason: rReason || undefined, disable_connections: disableConns }, 'Revoke')}
                className="rounded bg-red-500/20 px-3 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/30 disabled:opacity-40">
          Revoke
        </button>
      </div>

      {msg && <div className="text-[11px] text-muted-foreground">{msg}</div>}
    </div>
  )
}
