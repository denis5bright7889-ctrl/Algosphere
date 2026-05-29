/**
 * Pure helpers that survive the refocus from social/leaderboard to
 * trader intelligence. Extracted from the now-retired
 * `lib/leaderboard.ts` because four kept pages still need them:
 *
 *   - `(dashboard)/settings/PublicProfileForm.tsx` (handle picker)
 *   - `(dashboard)/verification/page.tsx` (verification tier badge)
 *   - `api/profile/public/route.ts` (handle validation)
 *   - `components/dashboard/TopBar.tsx` (via NotificationBell, if needed)
 *
 * No data fetching here. No leaderboard semantics. Just typing rules
 * for user handles plus a small visual badge for verification tier.
 */
import { Trophy, BadgeCheck, CheckSquare, type LucideIcon } from 'lucide-react'

// ─── Verification tier ────────────────────────────────────────────────
export type VerificationTier = 'none' | 'basic' | 'verified' | 'elite'

export function verificationBadge(tier: VerificationTier): {
  icon:  LucideIcon
  label: string
  cls:   string
} | null {
  switch (tier) {
    case 'elite':
      return { icon: Trophy,      label: 'Elite',    cls: 'text-amber-300 border-amber-500/50 bg-amber-500/15' }
    case 'verified':
      return { icon: BadgeCheck,  label: 'Verified', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' }
    case 'basic':
      return { icon: CheckSquare, label: 'Basic',    cls: 'text-blue-300 border-blue-500/30 bg-blue-500/08' }
    default:
      return null
  }
}

// ─── Public handle rules ──────────────────────────────────────────────
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
