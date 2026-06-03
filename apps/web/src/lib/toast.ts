/**
 * Dependency-free toast bus.
 *
 * showToast() fires a window CustomEvent that the <Toaster/> component
 * (mounted in the root layout) listens for and renders. Survives modal
 * close + route changes — the consumer is page-level, not tied to the
 * caller's render lifecycle.
 *
 * Client-only — caller MUST be inside `'use client'`. SSR guards.
 */

export type ToastTone = 'success' | 'error' | 'info' | 'warn'

export interface ToastPayload {
  tone:     ToastTone
  title:    string
  body?:    string
  /** Optional deep-link the toast attaches a "view" button to. */
  link?:    { href: string; label: string }
  /** Auto-dismiss after N ms. Default 8000. 0 = sticky until user dismisses. */
  ttlMs?:   number
  /** Stable id — toasts with the same id replace each other (de-dup). */
  id?:      string
}

const EVENT_NAME = 'as:toast'

export function showToast(p: ToastPayload): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent<ToastPayload>(EVENT_NAME, { detail: p }))
  } catch {
    /* no-op */
  }
}

export { EVENT_NAME as TOAST_EVENT_NAME }
