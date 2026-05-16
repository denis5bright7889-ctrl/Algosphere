import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { z } from 'zod'
import { recomputeTraderScore } from '@/lib/trader-scoring'

const schema = z.object({
  action:           z.enum(['approve', 'reject', 'approve_elite']),
  rejection_reason: z.string().max(500).optional(),
  elite_notes:      z.string().max(1000).optional(),
})

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: userId } = await ctx.params   // id == target user_id
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  const svc = createServiceClient()
  const now = new Date().toISOString()

  // Pull live track-record stats for the audit trail
  const { count: liveSignals } = await svc
    .from('signals')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', userId)
    .in('lifecycle_state', ['tp1_hit','tp2_hit','tp3_hit','stopped','breakeven'])

  const { data: scores } = await svc
    .from('trader_scores')
    .select('win_rate, sharpe_ratio, total_trades')
    .eq('user_id', userId)
    .maybeSingle()

  let update: Record<string, unknown>

  if (parsed.data.action === 'approve') {
    update = {
      tier:               'verified',
      verified_at:        now,
      verified_by:        user.id,
      live_track_days:    0,
      live_win_rate:      scores?.win_rate ?? null,
      live_trade_count:   scores?.total_trades ?? 0,
      application_status: 'idle',
      rejected_at:        null,
      rejection_reason:   null,
    }
  } else if (parsed.data.action === 'approve_elite') {
    update = {
      tier:               'elite',
      elite_at:           now,
      elite_sharpe:       scores?.sharpe_ratio ?? null,
      elite_review_notes: parsed.data.elite_notes ?? null,
      application_status: 'idle',
    }
  } else {
    update = {
      application_status: 'rejected',
      rejected_at:        now,
      rejection_reason:   parsed.data.rejection_reason ?? 'Did not meet criteria',
    }
  }

  const { error } = await svc
    .from('trader_verifications')
    .update(update)
    .eq('user_id', userId)

  if (error) {
    console.error('verification decision error:', error)
    return NextResponse.json({ error: 'Failed to apply decision' }, { status: 500 })
  }

  // Notify the trader
  const isApprove = parsed.data.action !== 'reject'
  await svc.from('social_notifications').insert({
    recipient_id: userId,
    actor_id:     user.id,
    notif_type:   isApprove ? 'verification_approved' : 'verification_rejected',
    message: isApprove
      ? parsed.data.action === 'approve_elite'
        ? '🏆 You are now an Elite verified trader!'
        : '✅ Your trader profile is now Verified!'
      : `Verification not approved: ${parsed.data.rejection_reason ?? 'Did not meet criteria'}`,
  })

  // Recompute score (verification adds bonus points)
  if (isApprove) {
    recomputeTraderScore(svc, userId).catch(() => {})
  }

  await svc.from('audit_logs').insert({
    actor_id:      user.id,
    actor_email:   user.email,
    action:        `verification.${parsed.data.action}`,
    resource_type: 'trader_verification',
    resource_id:   userId,
    after_state:   { ...update, live_signals: liveSignals },
  })

  return NextResponse.json({ ok: true, action: parsed.data.action })
}
