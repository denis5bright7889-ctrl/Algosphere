import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { canTransition, LIFECYCLE_TO_RESULT } from '@/lib/signals/lifecycle'
import { settleCopyTradesForSignal } from '@/lib/copy-settlement'
import type { SignalLifecycleState } from '@/lib/types'

const TERMINAL_STATES = [
  'tp1_hit','tp2_hit','tp3_hit','stopped','invalidated','expired','breakeven',
]

const updateSchema = z.object({
  lifecycle_state: z.enum([
    'pending','queued','active','tp1_hit','tp2_hit','tp3_hit',
    'stopped','invalidated','expired','breakeven'
  ]).optional(),
  pips_gained: z.number().optional(),
  admin_notes: z.string().max(500).optional(),
  confidence_score: z.number().int().min(0).max(100).optional(),
})

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const svc = db()

  const { data: existing } = await svc
    .from('signals')
    .select('lifecycle_state, status')
    .eq('id', id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Signal not found' }, { status: 404 })

  const update: Record<string, unknown> = { ...parsed.data }

  if (parsed.data.lifecycle_state) {
    const newState = parsed.data.lifecycle_state as SignalLifecycleState
    const oldState = existing.lifecycle_state as SignalLifecycleState

    if (!canTransition(oldState, newState)) {
      return NextResponse.json(
        { error: `Invalid transition: ${oldState} → ${newState}` },
        { status: 409 }
      )
    }

    // Sync result from lifecycle state
    const result = LIFECYCLE_TO_RESULT[newState]
    if (result) update.result = result

    // Set terminal status
    if (TERMINAL_STATES.includes(newState)) {
      update.status = 'closed'
    }

    // Timestamp the transition
    const now = new Date().toISOString()
    if (newState === 'tp1_hit') update.tp1_hit_at = now
    if (newState === 'tp2_hit') update.tp2_hit_at = now
    if (newState === 'tp3_hit') update.tp3_hit_at = now
    if (newState === 'stopped') update.stopped_at = now
    if (newState === 'invalidated') update.invalidated_at = now
  }

  const { data, error } = await svc
    .from('signals')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await svc.from('audit_logs').insert({
    actor_id: user.id,
    actor_email: user.email,
    action: 'signal.update',
    resource_type: 'signal',
    resource_id: id,
    before_state: existing,
    after_state: update,
  })

  // If the signal just went terminal, settle all linked copy trades
  if (
    parsed.data.lifecycle_state &&
    TERMINAL_STATES.includes(parsed.data.lifecycle_state) &&
    existing.status !== 'closed'
  ) {
    settleCopyTradesForSignal(svc, id)
      .catch(err => console.error('Copy settlement failed:', err))
  }

  return NextResponse.json({ data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const svc = db()

  const { error } = await svc.from('signals').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await svc.from('audit_logs').insert({
    actor_id: user.id,
    actor_email: user.email,
    action: 'signal.delete',
    resource_type: 'signal',
    resource_id: id,
  })

  return NextResponse.json({ ok: true })
}
