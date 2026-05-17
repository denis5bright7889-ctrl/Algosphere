/**
 * GET /api/market/whale — smart-money token screener (Nansen-backed).
 *
 * Gated:
 *   • Logged-in (Supabase session)
 *   • subscription_tier >= premium  OR  admin  OR  open-beta flag on
 *     OR  demo_premium/demo_vip account_type
 *
 * Query params:
 *   chains    comma list of ethereum|solana|base                (default all)
 *   timeframe 1h | 24h | 7d | 30d                               (default 24h)
 *   order     buy_volume|sell_volume|volume|netflow|price_change|market_cap_usd
 *   dir       ASC | DESC                                        (default DESC)
 *   limit     1..100                                            (default 50)
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { effectiveTierForFeatures } from '@/lib/demo'
import {
  tokenScreener, isNansenConfigured, NansenError,
  type NansenChain, type NansenTimeframe, type NansenOrderField,
} from '@/lib/nansen'
import type { SubscriptionTier } from '@/lib/types'

const CHAINS = ['ethereum', 'solana', 'base'] as const
const TFS    = ['1h', '24h', '7d', '30d'] as const
const ORDERS = ['buy_volume','sell_volume','volume','netflow','price_change','market_cap_usd'] as const

function parseEnum<T extends readonly string[]>(value: string | null, allowed: T, fallback: T[number]): T[number] {
  return value && (allowed as readonly string[]).includes(value) ? value as T[number] : fallback
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Tier check via the shared effective-tier helper so the API route,
  // the SSR page and the sidebar gate all agree.
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, account_type')
    .eq('id', user.id).single()
  const rawTier = (profile?.subscription_tier ?? 'free') as SubscriptionTier
  const tier    = effectiveTierForFeatures(user.email, rawTier, profile?.account_type)
  if (tier !== 'premium' && tier !== 'vip') {
    return NextResponse.json(
      { error: 'Whale analytics is a Pro+ feature', upgrade: '/upgrade' },
      { status: 403 },
    )
  }

  if (!isNansenConfigured()) {
    return NextResponse.json(
      { error: 'Whale analytics is not configured on this deployment (NANSEN_API_KEY).' },
      { status: 503 },
    )
  }

  const { searchParams } = new URL(req.url)
  const chainsRaw = (searchParams.get('chains') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const chains: NansenChain[] = chainsRaw.length
    ? chainsRaw.filter((c): c is NansenChain => (CHAINS as readonly string[]).includes(c))
    : [...CHAINS]
  const timeframe: NansenTimeframe = parseEnum(searchParams.get('timeframe'), TFS, '24h')
  const orderBy:   NansenOrderField = parseEnum(searchParams.get('order'),     ORDERS, 'buy_volume')
  const direction = searchParams.get('dir') === 'ASC' ? 'ASC' : 'DESC'
  const limit     = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 1), 100)

  try {
    const data = await tokenScreener({ chains, timeframe, orderBy, direction, limit })
    return NextResponse.json({ data, params: { chains, timeframe, orderBy, direction, limit } })
  } catch (e) {
    const err = e instanceof NansenError ? e : new NansenError(String(e), 'unknown')
    const status = err.code === 'no_key' ? 503 : err.code === 'timeout' ? 504 : 502
    return NextResponse.json({ error: err.message, code: err.code }, { status })
  }
}
