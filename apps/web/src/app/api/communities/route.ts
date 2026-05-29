/**
 * GET /api/communities
 *
 * Public read API for the Premium Telegram Community Hub (Refocus R3).
 * Returns the catalogue ordered pinned-first, then by sort_order, then
 * recency. Every row carries a `locked` boolean derived server-side
 * from the caller's subscription tier — the UI shows an upgrade prompt
 * for locked rows instead of hiding them, so users know what they
 * could unlock.
 *
 * Auth required. Anonymous callers get 401.
 *
 * No write endpoint here. Admin CRUD lives at /api/admin/communities/*.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  type TelegramCommunity, TIER_RANK,
} from '@/lib/telegram-communities'
import { effectiveTier } from '@/lib/admin'
import type { SubscriptionTier } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: profile }, listRes] = await Promise.all([
    supabase.from('profiles')
      .select('subscription_tier, account_type')
      .eq('id', user.id)
      .single(),
    supabase.from('telegram_communities')
      .select(`
        id, slug, name, description, telegram_url, kind, category,
        visibility, is_featured, is_pinned, sort_order,
        icon_url, banner_url, member_count, created_at, updated_at
      `)
      // RLS already filters archived_at IS NULL; safe to re-state the
      // intent here for callers that grep the route.
      .is('archived_at', null)
      .order('is_pinned', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  if (listRes.error) {
    console.error('telegram_communities list failed', listRes.error)
    return NextResponse.json({ error: 'list_failed' }, { status: 500 })
  }

  const tier: SubscriptionTier = effectiveTier(
    user.email,
    (profile?.subscription_tier ?? 'free') as SubscriptionTier,
  )
  const userRank = TIER_RANK[tier] ?? 0

  const rows = (listRes.data ?? []) as Array<Omit<TelegramCommunity, 'archived_at'>>
  const withLock = rows.map((c) => ({
    ...c,
    // `locked = true` → user sees an upgrade prompt; the t.me URL is
    // still returned because Telegram links aren't secret — but the UI
    // hides it behind the upgrade CTA to make the gate visible.
    locked: (TIER_RANK[c.visibility] ?? 0) > userRank,
  }))

  return NextResponse.json({
    tier,
    count: withLock.length,
    communities: withLock,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
