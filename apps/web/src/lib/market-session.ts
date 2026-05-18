/**
 * Truthful FX / Gold market-session state — derived purely from the
 * UTC clock. No API key, no feed, no fabrication: these are the
 * well-known structural trading hours of the spot FX market (which
 * XAUUSD tracks). The weekend close in particular is exact and is
 * the single most important honest signal a "live market" badge can
 * give.
 *
 * Session windows are the conventional UTC bands. Real-world edges
 * shift ±1h with regional DST; we therefore present the *session*
 * as indicative and the *open/closed* state as authoritative (the
 * Fri 22:00 → Sun 22:00 UTC close has no DST ambiguity that matters
 * for "is the market trading right now").
 */

export type SessionName = 'Sydney' | 'Tokyo' | 'London' | 'New York'

export interface MarketSession {
  /** True when the spot FX/Gold market is trading (not the weekend). */
  open: boolean
  /** Major sessions currently active (overlaps are common). */
  active: SessionName[]
  /** Primary session to surface (last in the open-order = most liquid). */
  primary: SessionName | null
  /** Human label, e.g. "London · New York" or "Weekend close". */
  label: string
  /**
   * When closed: ms until the next Sunday 22:00 UTC open.
   * When open:   ms until the Friday 22:00 UTC close.
   */
  msToFlip: number
}

// UTC [startHour, endHour) bands. Wrapping bands (start > end) cross midnight.
const BANDS: Record<SessionName, [number, number]> = {
  Sydney: [22, 7],
  Tokyo: [0, 9],
  London: [8, 17],
  'New York': [13, 22],
}

const ORDER: SessionName[] = ['Sydney', 'Tokyo', 'London', 'New York']

function inBand(hour: number, [s, e]: [number, number]): boolean {
  return s < e ? hour >= s && hour < e : hour >= s || hour < e
}

/** Is the FX week open at this instant? Closed Fri 22:00 → Sun 22:00 UTC. */
function isWeekOpen(d: Date): boolean {
  const day = d.getUTCDay() // 0 Sun … 6 Sat
  const h = d.getUTCHours()
  if (day === 6) return false // Saturday
  if (day === 0) return h >= 22 // Sunday: opens 22:00 UTC (Sydney)
  if (day === 5) return h < 22 // Friday: closes 22:00 UTC
  return true // Mon–Thu
}

function nextSundayOpen(d: Date): number {
  const t = new Date(d)
  // Advance to the upcoming Sunday 22:00:00 UTC.
  const day = t.getUTCDay()
  let addDays = (7 - day) % 7
  // If it's already Sunday but before 22:00, target today; if after, next week.
  if (day === 0 && t.getUTCHours() < 22) addDays = 0
  else if (day === 0) addDays = 7
  t.setUTCDate(t.getUTCDate() + addDays)
  t.setUTCHours(22, 0, 0, 0)
  return t.getTime() - d.getTime()
}

function thisWeekClose(d: Date): number {
  const t = new Date(d)
  const day = t.getUTCDay()
  // Friday 22:00 UTC of the current trading week.
  const addDays = (5 - day + 7) % 7
  t.setUTCDate(t.getUTCDate() + addDays)
  t.setUTCHours(22, 0, 0, 0)
  if (t.getTime() <= d.getTime()) t.setUTCDate(t.getUTCDate() + 7)
  return t.getTime() - d.getTime()
}

export function getMarketSession(now: Date = new Date()): MarketSession {
  if (!isWeekOpen(now)) {
    return {
      open: false,
      active: [],
      primary: null,
      label: 'Weekend close',
      msToFlip: nextSundayOpen(now),
    }
  }

  const h = now.getUTCHours()
  const active = ORDER.filter((s) => inBand(h, BANDS[s]))
  const primary = active.length ? active[active.length - 1]! : null
  const label = active.length ? active.join(' · ') : 'Off-session'

  return {
    open: true,
    active,
    primary,
    label,
    msToFlip: thisWeekClose(now),
  }
}

/** Compact "2h 14m" / "3d 4h" formatter for the flip countdown. */
export function fmtCountdown(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${mm}m`
  return `${mm}m`
}
