/**
 * Pure, deterministic risk scoring for a broker_account_ownership row from
 * its broker_ownership_history. No IO, no async — callers fetch the events
 * and pass them in.
 *
 * Score 0–100 (higher = riskier). Flags is a transparent map of what each
 * detector saw, so the admin UI can show WHY a score is high. Detectors:
 *   • reclaim_blocked count in last 30d  → other users attempted to claim
 *   • unique IPs in last 30d             → multi-IP detection (no geoip
 *                                          yet — that's a roadmap item)
 *   • relinks in last 7d                  → repeated relinking abuse
 *   • unique user-agents in last 30d     → device variance
 *
 * Bands: LOW <25 · MEDIUM 25–49 · HIGH 50–74 · CRITICAL ≥75.
 */

export interface HistoryEvent {
  action:     string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface RiskScore {
  score: number
  band:  RiskBand
  flags: Record<string, number>
}

export function bandOf(score: number): RiskBand {
  if (score >= 75) return 'CRITICAL'
  if (score >= 50) return 'HIGH'
  if (score >= 25) return 'MEDIUM'
  return 'LOW'
}

export function scoreOwnership(events: HistoryEvent[]): RiskScore {
  const now = Date.now()
  const d30 = now - 30 * 86_400_000
  const d7  = now - 7  * 86_400_000

  const recent30 = events.filter(e => new Date(e.created_at).getTime() >= d30)
  const recent7  = events.filter(e => new Date(e.created_at).getTime() >= d7)

  const blockedCount = recent30.filter(e => e.action === 'reclaim_blocked').length
  const uniqueIPs    = new Set(recent30.map(e => e.ip_address).filter(Boolean) as string[]).size
  const uniqueUAs    = new Set(recent30.map(e => e.user_agent).filter(Boolean) as string[]).size
  const relinks      = recent7.filter(
    e => e.action === 'linked' || e.action === 'unlinked' || e.action === 'transferred',
  ).length

  let score = 0
  // Reclaim-blocked is the strongest sharing signal: explicit attempts by
  // OTHER users to claim this account. 1 = 12pts, capped at 40.
  score += Math.min(40, blockedCount * 12)
  // IP variance bands.
  score += uniqueIPs >= 5 ? 25 : uniqueIPs >= 3 ? 15 : uniqueIPs >= 2 ? 5 : 0
  // Relink frequency in a week (real-world abuse pattern).
  score += relinks >= 4 ? 20 : relinks >= 2 ? 10 : 0
  // User-agent variance (device hopping).
  score += uniqueUAs >= 4 ? 10 : uniqueUAs >= 2 ? 3 : 0

  score = Math.max(0, Math.min(100, Math.round(score)))

  return {
    score,
    band: bandOf(score),
    flags: {
      reclaim_blocked_30d:    blockedCount,
      unique_ips_30d:         uniqueIPs,
      unique_user_agents_30d: uniqueUAs,
      relinks_7d:             relinks,
    },
  }
}
