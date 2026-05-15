/**
 * Manage the caller's own API keys. API access is a VIP entitlement.
 *   GET  /api/keys         → list (masked, never returns the raw key)
 *   POST /api/keys         → create (raw key returned exactly ONCE)
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { generateApiKey, API_PERMISSIONS } from '@/lib/api-keys'
import { effectiveTierForFeatures } from '@/lib/demo'
import { tierIncludes } from '@/lib/entitlements'
import type { SubscriptionTier } from '@/lib/types'

const VALID_PERMS = API_PERMISSIONS.map(p => p.key) as [string, ...string[]]

const createSchema = z.object({
  name: z.string().min(1).max(60),
  permissions: z.array(z.enum(VALID_PERMS)).min(1).optional(),
})

async function requireVipUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, account_type')
    .eq('id', user.id)
    .single()

  const tier = effectiveTierForFeatures(
    user.email,
    (profile?.subscription_tier ?? 'free') as SubscriptionTier,
    profile?.account_type,
  )
  if (!tierIncludes(tier, 'vip')) {
    return { error: NextResponse.json({ error: 'API access requires the VIP plan' }, { status: 403 }) }
  }
  return { supabase, userId: user.id }
}

export async function GET() {
  const ctx = await requireVipUser()
  if ('error' in ctx) return ctx.error

  const { data, error } = await ctx.supabase
    .from('api_keys')
    .select('id, name, key_prefix, permissions, rate_limit_per_minute, total_requests, last_used_at, revoked, expires_at, created_at')
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ keys: data ?? [] })
}

export async function POST(request: Request) {
  const ctx = await requireVipUser()
  if ('error' in ctx) return ctx.error

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'name (1–60 chars) required; permissions must be valid' }, { status: 422 })
  }

  // Cap keys per user to keep abuse / metering sane
  const { count } = await ctx.supabase
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', ctx.userId)
    .eq('revoked', false)
  if ((count ?? 0) >= 10) {
    return NextResponse.json({ error: 'Active key limit reached (10). Revoke one first.' }, { status: 409 })
  }

  const { raw, prefix, hash } = generateApiKey()
  const { data, error } = await ctx.supabase
    .from('api_keys')
    .insert({
      user_id: ctx.userId,
      name: parsed.data.name,
      key_prefix: prefix,
      key_hash: hash,
      permissions: parsed.data.permissions ?? ['signals:read'],
    })
    .select('id, name, key_prefix, permissions, rate_limit_per_minute, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // raw is returned ONCE and never stored in plaintext anywhere.
  return NextResponse.json({ key: data, secret: raw }, { status: 201 })
}
