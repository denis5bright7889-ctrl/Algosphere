import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Publish a draft strategy → puts it in `pending_review`
// In production, admin approval moves it to `active`.
// For MVP without admin queue, we auto-activate after baseline checks.

const MIN_LIVE_SIGNALS_FOR_AUTO_PUBLISH = 5

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership
  const { data: strategy } = await supabase
    .from('published_strategies')
    .select('*')
    .eq('id', id)
    .eq('creator_id', user.id)
    .single()

  if (!strategy) {
    return NextResponse.json({ error: 'Strategy not found' }, { status: 404 })
  }
  if (strategy.status === 'active') {
    return NextResponse.json({ error: 'Already published' }, { status: 409 })
  }

  // Count live signals from this trader (proxy for track record)
  const { count: liveSignals } = await supabase
    .from('signals')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .in('lifecycle_state', ['tp1_hit','tp2_hit','tp3_hit','stopped','breakeven'])

  const newStatus = (liveSignals ?? 0) >= MIN_LIVE_SIGNALS_FOR_AUTO_PUBLISH
    ? 'active'
    : 'pending_review'

  const { data, error } = await supabase
    .from('published_strategies')
    .update({
      status:       newStatus,
      published_at: newStatus === 'active' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('publish error:', error)
    return NextResponse.json({ error: 'Failed to publish' }, { status: 500 })
  }

  return NextResponse.json({
    strategy:   data,
    status:     newStatus,
    message:    newStatus === 'active'
      ? 'Strategy is now live on the marketplace.'
      : `Pending admin review. ${MIN_LIVE_SIGNALS_FOR_AUTO_PUBLISH - (liveSignals ?? 0)} more live signals will auto-activate.`,
  })
}
