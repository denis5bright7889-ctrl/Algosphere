'use client'
/**
 * Admin actions per ownership row: force-transfer (pick from contention
 * or paste any user_id) and revoke (optionally disable connections). Both
 * call the admin POST endpoints; the page refreshes on success.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  fingerprint: string
  ownerUserId: string
  contention:  string[]
}

export default function Actions({ fingerprint, ownerUserId, contention }: Props) {
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

      <div className="space-y-1">
        <div className="text-[11px] font-medium">Force-transfer ownership</div>
        <div className="flex flex-wrap gap-1">
          <select value={target} onChange={e => setTarget(e.target.value)}
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
