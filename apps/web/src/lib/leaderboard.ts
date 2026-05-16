/**
 * AlgoSphere Quant — Public leaderboard / trader-profile helpers
 *
 * All numbers come from the SECURITY DEFINER SQL functions
 * (trader_leaderboard_v2 / trader_profile) — never from raw journal rows —
 * so privacy + opt-in are enforced at the database layer.
 */

// ─── Legacy (v1 leaderboard RPC) ───────────────────────────
export interface LeaderboardRow {
  handle:    string
  bio:       string | null
  trades:    number
  wins:      number
  win_rate:  number
  total_pnl: number
  avg_rr:    number | null
  score:     number
}

// ─── V2 leaderboard (trader_scores-backed) ─────────────────
export interface LeaderboardRowV2 {
  user_id:           string
  handle:            string
  bio:               string | null
  composite_score:   number        // 0–1000 Glicko-style
  composite_rank:    number
  rank_change_24h:   number        // positive = moved up
  win_rate:          number | null
  monthly_return:    number | null
  total_trades:      number
  sharpe_ratio:      number | null
  max_drawdown:      number | null
  followers_count:   number
  risk_label:        'low' | 'medium' | 'high' | 'extreme'
  risk_score:        number
  verification_tier: 'none' | 'basic' | 'verified' | 'elite'
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

export interface TraderScores {
  composite_score:    number
  composite_rank:     number | null
  rank_change_24h:    number
  win_rate:           number | null
  sharpe_ratio:       number | null
  sortino_ratio:      number | null
  max_drawdown_pct:   number | null
  profit_factor:      number | null
  total_trades:       number
  monthly_return_pct: number | null
  followers_count:    number
  copy_followers_count: number
  total_aum_usd:      number
  risk_score:         number
  risk_label:         string
}

// ─── Verification badge ─────────────────────────────────────
export type VerificationTier = 'none' | 'basic' | 'verified' | 'elite'

export function verificationBadge(tier: VerificationTier): {
  icon:  string
  label: string
  cls:   string
} | null {
  switch (tier) {
    case 'elite':
      return { icon: '🏆', label: 'Elite',    cls: 'text-amber-300 border-amber-500/50 bg-amber-500/15' }
    case 'verified':
      return { icon: '✅', label: 'Verified', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' }
    case 'basic':
      return { icon: '☑️', label: 'Basic',    cls: 'text-blue-300 border-blue-500/30 bg-blue-500/08' }
    default:
      return null
  }
}

// ─── Risk badge ─────────────────────────────────────────────
export function riskBadge(label: string): { cls: string; dot: string } {
  switch (label) {
    case 'low':     return { cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' }
    case 'high':    return { cls: 'text-rose-400    bg-rose-500/10    border-rose-500/30',    dot: 'bg-rose-400'    }
    case 'extreme': return { cls: 'text-red-400     bg-red-500/10     border-red-500/30',     dot: 'bg-red-400'     }
    default:        return { cls: 'text-amber-400   bg-amber-500/10   border-amber-500/30',   dot: 'bg-amber-400'   }
  }
}

// ─── Reputation (legacy, kept for v1 compat) ────────────────
export function reputation(score: number): { label: string; cls: string } {
  if (score >= 65) return { label: 'Elite',      cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' }
  if (score >= 50) return { label: 'Consistent', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' }
  if (score >= 35) return { label: 'Developing', cls: 'text-blue-300 border-blue-500/40 bg-blue-500/10' }
  return { label: 'Building', cls: 'text-muted-foreground border-border bg-muted/30' }
}

// ─── Rank change indicator ──────────────────────────────────
export function rankChangeLabel(delta: number): { label: string; cls: string } | null {
  if (delta === 0) return null
  return delta > 0
    ? { label: `▲ ${delta}`, cls: 'text-emerald-400' }
    : { label: `▼ ${Math.abs(delta)}`, cls: 'text-rose-400' }
}

// ─── Handle helpers ─────────────────────────────────────────
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

// ─── Score display helpers ──────────────────────────────────
export function formatScore(score: number): string {
  return score.toFixed(0)
}

export function formatPct(v: number | null, decimals = 1): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`
}

export function formatRatio(v: number | null): string {
  if (v == null) return '—'
  return v.toFixed(2)
}
