import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// ─── GET — current verification status ───────────────────────
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()

  // 1. Activity metrics for Basic eligibility
  const { data: profile } = await svc
    .from('profiles')
    .select('public_profile, public_handle, created_at')
    .eq('id', user.id)
    .single()

  const [{ count: tradeCount }, { data: distinct }] = await Promise.all([
    svc.from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    svc.from('journal_entries')
      .select('trade_date')
      .eq('user_id', user.id),
  ])

  const activeDays = new Set((distinct ?? []).map(r => r.trade_date)).size

  // 2. Live signal count (for Verified tier)
  const { count: liveSignalCount } = await svc
    .from('signals')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .in('lifecycle_state', ['tp1_hit','tp2_hit','tp3_hit','stopped','breakeven'])

  // 3. Current verification record
  const { data: verif } = await svc
    .from('trader_verifications')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({
    activity: {
      trade_count:        tradeCount ?? 0,
      active_days:        activeDays,
      live_signals:       liveSignalCount ?? 0,
      has_public_profile: !!(profile?.public_profile && profile?.public_handle),
    },
    verification: verif ?? { tier: 'none', application_status: 'idle' },
    requirements: {
      basic:    { min_trades: 20, min_days_active: 30 },
      verified: { min_trades: 50, min_days_active: 60, min_live_signals: 20 },
      elite:    { min_trades: 200, min_months_live: 6 },
    },
  })
}

// ─── POST — apply for Verified tier ──────────────────────────
const applySchema = z.object({
  broker_name:          z.string().min(2).max(80),
  broker_statement_url: z.string().url(),
  mt5_account_id:       z.string().optional(),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = applySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  const svc = createServiceClient()

  // Verify they have Basic + min live signals
  const { data: verif } = await svc
    .from('trader_verifications')
    .select('tier, application_status')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!verif || verif.tier === 'none') {
    return NextResponse.json(
      { error: 'You must reach Basic verification first.' },
      { status: 400 },
    )
  }
  if (verif.application_status === 'pending_verified') {
    return NextResponse.json(
      { error: 'Application already pending review.' },
      { status: 409 },
    )
  }

  const { count: liveCount } = await svc
    .from('signals')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .in('lifecycle_state', ['tp1_hit','tp2_hit','tp3_hit','stopped','breakeven'])

  if ((liveCount ?? 0) < 20) {
    return NextResponse.json(
      { error: `Need 20 live closed signals. You have ${liveCount ?? 0}.` },
      { status: 400 },
    )
  }

  // Submit application
  const { error } = await svc
    .from('trader_verifications')
    .update({
      broker_name:           parsed.data.broker_name,
      broker_statement_url:  parsed.data.broker_statement_url,
      mt5_account_id:        parsed.data.mt5_account_id ?? null,
      application_status:    'pending_verified',
      applied_at:            new Date().toISOString(),
    })
    .eq('user_id', user.id)

  if (error) {
    console.error('verification apply error:', error)
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    message: 'Application submitted. Review takes 3–5 business days.',
  })
}
