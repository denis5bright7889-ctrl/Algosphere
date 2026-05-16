'use client'

import { useEffect, useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

type State = 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | 'loading'

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - base64.length % 4) % 4)
  const safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw  = atob(safe)
  const buf  = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buf
}

export default function PushSubscribeButton() {
  const [state, setState] = useState<State>('loading')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      if (typeof window === 'undefined') return
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('unsupported')
        return
      }
      if (Notification.permission === 'denied') {
        setState('denied')
        return
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js')
                  ?? await navigator.serviceWorker.register('/sw.js')
        const sub = await reg.pushManager.getSubscription()
        setState(sub ? 'subscribed' : 'unsubscribed')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown')
        setState('unsubscribed')
      }
    })()
  }, [])

  async function enable() {
    setError(null)
    setTestResult(null)
    startTransition(async () => {
      try {
        // Request notification permission first
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') {
          setState(perm === 'denied' ? 'denied' : 'unsubscribed')
          throw new Error(perm === 'denied' ? 'Permission denied' : 'Not granted')
        }

        // Fetch the server's VAPID public key
        const vapidRes = await fetch('/api/alerts/push/vapid')
        if (!vapidRes.ok) {
          const e = await vapidRes.json().catch(() => ({}))
          throw new Error(e.error ?? 'Web Push not configured on server')
        }
        const { publicKey } = await vapidRes.json()
        if (!publicKey) throw new Error('No VAPID public key returned')

        // Register SW + subscribe
        const reg = await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBuffer(publicKey),
        })

        // POST subscription to server (toJSON() gives the canonical wire shape)
        const subJson = sub.toJSON()
        const res = await fetch('/api/alerts/push/subscribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(subJson),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error(e.error ?? 'Failed to register subscription')
        }
        setState('subscribed')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  async function disable() {
    setError(null)
    setTestResult(null)
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js')
        const sub = await reg?.pushManager.getSubscription()
        if (sub) {
          await sub.unsubscribe()
          await fetch('/api/alerts/push/unsubscribe', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ endpoint: sub.endpoint }),
          })
        }
        setState('unsubscribed')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  async function test() {
    setError(null)
    setTestResult(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/alerts/push/test', { method: 'POST' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Test failed')
        setTestResult(`Sent to ${data.sent} device${data.sent === 1 ? '' : 's'}`)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  if (state === 'loading') {
    return <p className="text-xs text-muted-foreground">Checking push status…</p>
  }
  if (state === 'unsupported') {
    return (
      <p className="text-xs text-muted-foreground">
        Push notifications aren&apos;t supported in this browser.
      </p>
    )
  }
  if (state === 'denied') {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] p-3 text-xs text-rose-300">
        Permission denied. Enable notifications for this site in your browser settings, then reload.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {state === 'subscribed' ? (
          <>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
              ✓ Push enabled on this device
            </span>
            <button
              type="button"
              onClick={test}
              disabled={pending}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-amber-500/40"
            >
              Send test
            </button>
            <button
              type="button"
              onClick={disable}
              disabled={pending}
              className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10"
            >
              Disable
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={enable}
            disabled={pending}
            className={cn('btn-premium !text-xs !py-2 !px-4', pending && 'opacity-60 cursor-wait')}
          >
            {pending ? 'Enabling…' : 'Enable Push Notifications'}
          </button>
        )}
      </div>
      {testResult && <p className="text-xs text-emerald-400">{testResult}</p>}
      {error      && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  )
}
