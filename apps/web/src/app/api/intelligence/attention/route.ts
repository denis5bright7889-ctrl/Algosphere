/**
 * /api/intelligence/attention — social narrative-attention tracker.
 *
 * Returns the AttentionBoard (see lib/attention-engine.ts) — per-target
 * attention state, acceleration, and share. Sourced from X v2
 * tweets/counts/recent. Degrades honestly (available:false + reason) on
 * credit depletion / rate-limit / auth failure.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeAttentionBoard } from '@/lib/attention-engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const board = await composeAttentionBoard()
    return NextResponse.json(board)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Attention compose failed' },
      { status: 502 },
    )
  }
}
