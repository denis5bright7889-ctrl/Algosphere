/**
 * Psychology leaderboard — pure assembly layer (Phase 3).
 *
 * Separates the *logic* of the consent-gated psychology rankings from the
 * I/O. The API route ([/api/psychology/leaderboard]) handles auth +
 * service-role fetches, then hands already-fetched data to the pure
 * functions here. That keeps the ranking math unit-testable without
 * mocking Supabase, and keeps the leak-prevention rules in one auditable
 * place.
 *
 * Leak contract (enforced here):
 *   • Output rows carry ONLY the four public scores + rank/percentile +
 *     a display name. Never a user id, email, or any raw journal data.
 *   • Display name is the user's chosen public_handle, or a deterministic
 *     anonymized "Trader-XXXX" token derived from the id — never the real
 *     name or email of a user who opted in without a handle.
 *   • Eligibility (opt-in + both consent timestamps) is checked here as a
 *     defensive backstop even though the query already filters on it.
 */
import { analyzeBehavior, type BehavioralReport } from './behavioral.ts'
import { buildLeaderboard } from './psychology-v3.ts'
import type { V3Entry } from './psychology-v3.ts'

export type LeaderboardRange = 'global' | 'weekly' | 'monthly'

/** Map a UI range to the analysis window. Global is capped at one year so
 *  the on-request computation stays bounded; weekly/monthly are literal. */
export function rangeToWindowDays(range: LeaderboardRange): number {
  return range === 'weekly' ? 7 : range === 'monthly' ? 30 : 365
}

export function isLeaderboardRange(x: unknown): x is LeaderboardRange {
  return x === 'global' || x === 'weekly' || x === 'monthly'
}

/** The profile fields the eligibility gate needs. */
export interface EligibleProfile {
  id:                  string
  public_handle:       string | null
  leaderboard_opt_in:  boolean | null
  terms_accepted_at:   string | null
  privacy_accepted_at: string | null
}

/** A user appears on the board only with opt-in AND both consents. */
export function isEligible(p: EligibleProfile): boolean {
  return p.leaderboard_opt_in === true
    && !!p.terms_accepted_at
    && !!p.privacy_accepted_at
}

/** Deterministic, PII-free fallback handle for an opted-in user who never
 *  set a public_handle. Stable across requests (hash of the user id). */
export function anonymizeHandle(userId: string): string {
  let h = 2166136261 >>> 0           // FNV-1a basis
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return `Trader-${h.toString(36).toUpperCase().slice(0, 4).padStart(4, '0')}`
}

/** A single public leaderboard row. Sub-scores stay nullable so a thin
 *  axis renders "—" rather than a fabricated 0. */
export interface PsychLeaderboardRow {
  rank:              number
  percentile:        number
  display_name:      string
  is_you:            boolean
  maturity_score:    number
  discipline_score:  number | null
  consistency_score: number | null
  patience_score:    number | null
}

/** Per-user journal rows, pre-scoped to the window by the caller. */
export interface UserEntries {
  userId: string
  handle: string | null
  entries: V3Entry[]
}

export interface LeaderboardResult {
  rows: PsychLeaderboardRow[]
  you:  PsychLeaderboardRow | null
}

/**
 * Compute each user's behavioral report, rank by maturity index, and
 * assemble safe rows. Users whose maturity is null (sample too thin) are
 * excluded by buildLeaderboard — they haven't earned a placement.
 */
export function assembleLeaderboard(
  users: UserEntries[],
  windowDays: number,
  currentUserId: string | null,
): LeaderboardResult {
  const reports = new Map<string, BehavioralReport>()
  const handles = new Map<string, string | null>()
  for (const u of users) {
    reports.set(u.userId, analyzeBehavior(u.entries as never, windowDays))
    handles.set(u.userId, u.handle)
  }

  const inputs = [...reports].map(([user_id, report]) => ({ user_id, report }))
  const ranked = buildLeaderboard(inputs, 'maturity')   // drops null-maturity users

  const rows: PsychLeaderboardRow[] = ranked.map((r) => {
    const rep = reports.get(r.user_id)!
    return {
      rank:              r.rank,
      percentile:        r.percentile,
      display_name:      handles.get(r.user_id) || anonymizeHandle(r.user_id),
      is_you:            currentUserId != null && r.user_id === currentUserId,
      maturity_score:    r.value,
      discipline_score:  rep.rule_adherence_score,
      consistency_score: rep.consistency_score,
      patience_score:    rep.patience_score,
    }
  })

  return { rows, you: rows.find((x) => x.is_you) ?? null }
}
