/**
 * Shared route handler for every /api/onchain/* surface.
 *
 * One place owns: auth, effective-tier resolution, entitlement
 * application (delay / row caps / AI overlay), provider dispatch and
 * the response envelope. Each route file is then a 3-liner that just
 * names which provider method it serves.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { effectiveTierForFeatures } from '@/lib/demo'
import { intelEntitlements } from '@/lib/intelligence-entitlements'
import type { SubscriptionTier } from '@/lib/types'
import {
  getOnchainProvider, activeProviderName,
  type OnchainProvider, type Query, type Chain, type Window,
} from './index'

const CHAINS: Chain[] = ['ethereum', 'solana', 'base', 'arbitrum', 'polygon', 'bsc', 'optimism']
const WINDOWS: Window[] = ['1h', '24h', '7d', '30d']

type Fetcher<T> = (p: OnchainProvider, q: Query) => Promise<T[]>

export function intelligenceRoute<T>(fetcher: Fetcher<T>) {
  return async function GET(req: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier, account_type')
      .eq('id', user.id).single()
    const rawTier = (profile?.subscription_tier ?? 'free') as SubscriptionTier
    const tier    = effectiveTierForFeatures(user.email, rawTier, profile?.account_type)
    const ent     = intelEntitlements(tier)

    // Parse + clamp query against entitlements.
    const sp = new URL(req.url).searchParams
    const chains = (sp.get('chains') ?? '')
      .split(',').map((s) => s.trim()).filter((c): c is Chain => (CHAINS as string[]).includes(c))
    const windowRaw = sp.get('window')
    const win: Window = (WINDOWS as string[]).includes(windowRaw ?? '') ? windowRaw as Window : '24h'
    const reqLimit = Math.max(1, Math.min(parseInt(sp.get('limit') ?? '50', 10) || 50, 500))
    const limit = Math.min(reqLimit, ent.rowLimit)

    const q: Query = { window: win, limit, ...(chains.length ? { chains } : {}) }

    try {
      const provider = getOnchainProvider({ fallbackToMock: true })
      const rows = await fetcher(provider, q)
      const configured = activeProviderName()
      // The TRUE source for THIS surface — 'mock' if the configured
      // provider wasn't wired for it and silently fell back. Never
      // report `configured` blindly: that would label mock rows real.
      const source = provider.lastSource()
      return NextResponse.json({
        data:       rows,
        source,
        configured,
        // Explicit so the footer can say "configured for dune, this
        // surface still on mock — wire DUNE_QUERY_*".
        fallback:   source === 'mock' && configured !== 'mock',
        fetched_at: new Date().toISOString(),
        delayed:    !ent.liveData,
        band:       ent.band,
        capped:     reqLimit > ent.rowLimit,
        // FREE/PRO see lagged data — surface the lag honestly to the UI.
        delay_minutes: ent.liveData ? 0 : ent.delayMinutes,
      })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Provider error' },
        { status: 502 },
      )
    }
  }
}

/** AI narrative endpoint helper — gated to ELITE+ (aiNarratives). */
export function narrativeRoute(surface: Parameters<NonNullable<OnchainProvider['getNarrative']>>[0]) {
  return async function GET() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier, account_type')
      .eq('id', user.id).single()
    const rawTier = (profile?.subscription_tier ?? 'free') as SubscriptionTier
    const tier    = effectiveTierForFeatures(user.email, rawTier, profile?.account_type)
    const ent     = intelEntitlements(tier)

    if (!ent.aiNarratives) {
      return NextResponse.json(
        { error: 'AI narratives require ELITE (Pro) or above', upgrade: '/upgrade' },
        { status: 403 },
      )
    }
    const provider = getOnchainProvider({ fallbackToMock: true })
    const narrative = provider.getNarrative ? await provider.getNarrative(surface) : null
    return NextResponse.json({ narrative })
  }
}
