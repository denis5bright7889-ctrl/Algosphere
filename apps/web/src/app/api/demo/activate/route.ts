import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const Schema = z.object({
  plan: z.enum(['starter', 'premium']),
})

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized — please sign in first' }, { status: 401 })
  }

  // Parse and validate body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid plan — expected starter or premium' }, { status: 400 })
  }
  const { plan } = parsed.data

  // Refuse to overwrite a real paid subscription with demo
  const { data: existing } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status, account_type')
    .eq('id', user.id)
    .single()

  if (existing && existing.subscription_tier !== 'free' && existing.subscription_status === 'active') {
    return NextResponse.json(
      { error: 'You already have an active paid subscription — demo activation skipped' },
      { status: 409 },
    )
  }

  const accountType = plan === 'starter' ? 'demo_starter' : 'demo_premium'

  const { error } = await supabase
    .from('profiles')
    .update({
      account_type:      accountType,
      demo_plan:         plan,
      demo_activated_at: new Date().toISOString(),
      // CRITICAL: subscription_tier stays 'free' — demo is UI-only, not entitlement
    })
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to activate demo: ' + error.message }, { status: 500 })
  }

  return NextResponse.json({
    activated:     true,
    account_type:  accountType,
    redirect_to:   '/overview?demo_activated=1',
  })
}
