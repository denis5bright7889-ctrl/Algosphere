/**
 * AlgoSphere Quant — Public leaderboard / trader-profile helpers
 *
 * All numbers come from the SECURITY DEFINER SQL functions
 * (trader_leaderboard / trader_profile) — never from raw journal rows —
 * so privacy + opt-in are enforced at the database layer.
 */

export interface LeaderboardRow {
  handle:    string
  bio:       string | null
  trades:    number
  wins:      number
  win_rate:  number      // %
  total_pnl: number
  avg_rr:    number | null
  score:     number      // Bayesian-shrunk win rate (0–100)
}

export interface TraderProfile {
  handle:       string
  bio:          string | null
  member_since: string
  trades:       number
  wins:         number
  losses:       number
  win_rate:     number
  total_pnl:    number
  best_trade:   number
  worst_trade:  number
}

/** Reputation tier from the shrunk score — drives the badge on profiles. */
export function reputation(score: number): { label: string; cls: string } {
  if (score >= 65) return { label: 'Elite',      cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' }
  if (score >= 50) return { label: 'Consistent', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' }
  if (score >= 35) return { label: 'Developing', cls: 'text-blue-300 border-blue-500/40 bg-blue-500/10' }
  return { label: 'Building', cls: 'text-muted-foreground border-border bg-muted/30' }
}

/** Handle rules: 3–20 chars, lowercase alphanumeric + single dashes. */
export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])$/

export function normalizeHandle(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20)
}

export function isValidHandle(h: string): boolean {
  return HANDLE_RE.test(h)
}

export function rankMedal(i: number): string {
  return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`
}
