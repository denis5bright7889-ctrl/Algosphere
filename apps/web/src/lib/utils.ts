import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(date))
}

/** "Mon Nov 5 · 14:32" — weekday + date + 24h time. The day-of-week
 *  makes session bias visible at a glance; the time is local so users
 *  see it in their own clock without having to think about UTC. */
export function formatDateTime(date: string | Date): string {
  const d = new Date(date)
  if (!Number.isFinite(d.getTime())) return '—'
  const dateStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  }).format(d)
  const timeStr = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  return `${dateStr} · ${timeStr}`
}

/** "12s ago" / "5m ago" / "2h ago" / "3d ago". Compact, never
 *  fabricates: returns '—' for invalid dates. */
export function formatRelativeTime(date: string | Date): string {
  const d = new Date(date)
  if (!Number.isFinite(d.getTime())) return '—'
  const sec = Math.round((Date.now() - d.getTime()) / 1000)
  if (sec < 0)     return 'in the future'
  if (sec < 10)    return 'just now'
  if (sec < 60)    return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60)    return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24)     return `${hr}h ago`
  const days = Math.round(hr / 24)
  if (days < 30)   return `${days}d ago`
  const mo = Math.round(days / 30)
  if (mo < 12)     return `${mo}mo ago`
  return `${Math.round(mo / 12)}y ago`
}
