/**
 * Shared shape + helpers for the Premium Telegram Community Hub
 * (Refocus R3). The catalogue is read by /communities (user-facing
 * browse) and written by /api/admin/communities/* (admin CRUD).
 *
 * AlgoSphere does not host community posts itself — every row in the
 * `telegram_communities` table is an admin-curated pointer to an
 * external Telegram destination. This file is the only place where
 * the enum sets + tier-rank table live so client and server cannot
 * drift.
 */
import type { SubscriptionTier } from '@/lib/types'

export const COMMUNITY_KINDS = ['group', 'channel', 'bot'] as const
export type CommunityKind = (typeof COMMUNITY_KINDS)[number]

export const COMMUNITY_CATEGORIES = [
  'vip', 'signals', 'education', 'discussion', 'news', 'tools', 'other',
] as const
export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number]

export const COMMUNITY_VISIBILITIES: SubscriptionTier[] = [
  'free', 'starter', 'premium', 'vip',
]

export const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0, starter: 1, premium: 2, vip: 3,
}

export interface TelegramCommunity {
  id:           string
  slug:         string
  name:         string
  description:  string | null
  telegram_url: string
  kind:         CommunityKind
  category:     CommunityCategory
  visibility:   SubscriptionTier
  is_featured:  boolean
  is_pinned:    boolean
  sort_order:   number
  icon_url:     string | null
  banner_url:   string | null
  member_count: number | null
  archived_at:  string | null
  created_at:   string
  updated_at:   string
}

/**
 * Server-side tier check. Use in the public read API; never on the
 * client (the value can be tampered with from the browser).
 */
export function isVisibleToTier(
  community: Pick<TelegramCommunity, 'visibility'>,
  userTier: SubscriptionTier,
): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[community.visibility]
}

/**
 * Surface-level slug rules. Lowercase, dashes, no leading/trailing dashes.
 * Enforced server-side; the admin form also pre-normalizes for UX.
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/

export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/**
 * Strict-ish Telegram URL guard. Accepts t.me, telegram.me, and the
 * +invite variants. Returns null when the URL doesn't smell right;
 * the admin form surfaces the rejection inline. Never throws.
 */
export function parseTelegramUrl(input: string): string | null {
  try {
    const trimmed = input.trim()
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (host !== 't.me' && host !== 'telegram.me') return null
    if (!url.pathname || url.pathname === '/') return null
    return url.toString()
  } catch {
    return null
  }
}
