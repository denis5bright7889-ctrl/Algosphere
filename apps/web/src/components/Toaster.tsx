'use client'

/**
 * Toaster — listens for `as:toast` CustomEvents and renders a
 * top-right stack. Each toast auto-dismisses after its ttlMs (default
 * 8s) and can be manually closed. Survives modal unmounts + route
 * changes because the listener lives on `window`.
 *
 * Mount once in the root layout.
 */
import { useEffect, useState, useCallback } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { TOAST_EVENT_NAME, type ToastPayload } from '@/lib/toast'

interface ActiveToast extends ToastPayload {
  uid: string                            // internal — separate from caller-supplied id
}

const DEFAULT_TTL = 8_000

const TONE_CLS: Record<ToastPayload['tone'], { border: string; bg: string; text: string; icon: typeof CheckCircle2 }> = {
  success: { border: 'border-emerald-500/50', bg: 'bg-emerald-500/[0.08]', text: 'text-emerald-200', icon: CheckCircle2 },
  error:   { border: 'border-rose-500/50',    bg: 'bg-rose-500/[0.08]',    text: 'text-rose-200',    icon: XCircle },
  warn:    { border: 'border-amber-500/50',   bg: 'bg-amber-500/[0.08]',   text: 'text-amber-200',   icon: AlertTriangle },
  info:    { border: 'border-sky-500/50',     bg: 'bg-sky-500/[0.08]',     text: 'text-sky-200',     icon: Info },
}

export default function Toaster() {
  const [toasts, setToasts] = useState<ActiveToast[]>([])

  const dismiss = useCallback((uid: string) => {
    setToasts((arr) => arr.filter((t) => t.uid !== uid))
  }, [])

  useEffect(() => {
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<ToastPayload>).detail
      if (!detail) return
      const uid = (detail.id ?? '') + ':' + Math.random().toString(36).slice(2, 8)
      // De-dup: if caller provided an id, replace any existing toast
      // with the same id (e.g. "order:abc-123" double-fire).
      setToasts((arr) => {
        const filtered = detail.id ? arr.filter((t) => !t.uid.startsWith(detail.id + ':')) : arr
        return [...filtered, { ...detail, uid }]
      })
      const ttl = detail.ttlMs ?? DEFAULT_TTL
      if (ttl > 0) {
        setTimeout(() => dismiss(uid), ttl)
      }
    }
    window.addEventListener(TOAST_EVENT_NAME, onEvent as EventListener)
    return () => window.removeEventListener(TOAST_EVENT_NAME, onEvent as EventListener)
  }, [dismiss])

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed top-3 right-3 z-[9999] flex w-[min(360px,90vw)] flex-col gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const tone = TONE_CLS[t.tone] ?? TONE_CLS.info
        const Icon = tone.icon
        return (
          <div
            key={t.uid}
            className={cn(
              'pointer-events-auto rounded-xl border bg-zinc-950/95 shadow-2xl backdrop-blur',
              tone.border, tone.bg, tone.text,
              'flex items-start gap-2.5 p-3 text-[12px]',
              'animate-in slide-in-from-top-2 fade-in duration-200',
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-snug">{t.title}</p>
              {t.body && <p className="mt-0.5 leading-relaxed opacity-90">{t.body}</p>}
              {t.link && (
                <Link
                  href={t.link.href}
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold underline hover:no-underline"
                >
                  {t.link.label} <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.uid)}
              aria-label="Dismiss"
              className="shrink-0 rounded-md p-1 opacity-60 hover:bg-white/[0.08] hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
