/**
 * AlgoSphere Quant — Public API authentication
 *
 * Bearer-token auth for the institutional REST API (VIP entitlement).
 *   Authorization: Bearer aq_live_xxxxxxxxxxxx
 *
 * Pipeline: parse → hash → resolve key (service role) → revoked/expired
 * checks → owner tier gate (must include VIP) → permission check →
 * atomic per-minute rate limit + lifetime metering (bump_api_usage RPC).
 *
 * Returns either an authenticated context or a ready-to-send error Response.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { hashApiKey, type ApiPermission } from '@/lib/api-keys'
import { tierIncludes } from '@/lib/entitlements'
import type { SubscriptionTier } from '@/lib/types'

export interface ApiContext {
  userId:      string
  tier:        SubscriptionTier
  permissions: string[]
  keyId:       string
}

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function err(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

/**
 * Authenticate an incoming API request.
 * @returns ApiContext on success, or a NextResponse error to return as-is.
 */
export async function authenticateApiKey(
  request: Request,
  required: ApiPermission,
): Promise<ApiContext | NextResponse> {
  const auth = request.headers.get('authorization') ?? ''
  const raw = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : ''

  if (!raw || !raw.startsWith('aq_live_')) {
    return err(401, 'Missing or malformed API key. Use: Authorization: Bearer aq_live_…')
  }

  const db = svc()
  const keyHash = hashApiKey(raw)

  const { data: key } = await db
    .from('api_keys')
    .select('id, user_id, permissions, rate_limit_per_minute, revoked, expires_at')
    .eq('key_hash', keyHash)
    .maybeSingle()

  if (!key)        return err(401, 'Invalid API key')
  if (key.revoked) return err(401, 'API key has been revoked')
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return err(401, 'API key has expired')
  }

  // Owner must currently hold a tier that includes API access (VIP).
  const { data: profile } = await db
    .from('profiles')
    .select('subscription_tier, account_type')
    .eq('id', key.user_id)
    .single()

  const tier = (profile?.subscription_tier ?? 'free') as SubscriptionTier
  // Demo accounts cannot use the live API regardless of simulated tier.
  const isDemo = typeof profile?.account_type === 'string'
    && profile.account_type.startsWith('demo_')
  if (isDemo || !tierIncludes(tier, 'vip')) {
    return err(403, 'API access requires an active VIP subscription')
  }

  if (!key.permissions?.includes(required)) {
    return err(403, `API key lacks required permission: ${required}`)
  }

  // Atomic per-minute rate limit + lifetime metering.
  const windowStart = new Date()
  windowStart.setSeconds(0, 0)
  const { data: count, error: rlErr } = await db.rpc('bump_api_usage', {
    p_key_id: key.id,
    p_window: windowStart.toISOString(),
  })

  if (!rlErr && typeof count === 'number') {
    const limit = key.rate_limit_per_minute ?? 60
    if (count > limit) {
      return err(429, 'Rate limit exceeded', {
        limit, window: '1m', retry_after_seconds: 60 - new Date().getSeconds(),
      })
    }
  }

  // Monthly metered usage (quota + overage accrual). Non-blocking — a
  // metering failure must never reject an otherwise-valid API call.
  const monthlyQuota = tier === 'vip' ? 100_000 : 10_000
  db.rpc('bump_api_monthly_usage', {
    p_user_id: key.user_id,
    p_quota:   monthlyQuota,
  }).then(() => {}, () => {})

  return {
    userId:      key.user_id,
    tier,
    permissions: key.permissions ?? [],
    keyId:       key.id,
  }
}

export function isApiError(x: ApiContext | NextResponse): x is NextResponse {
  return x instanceof NextResponse
}
