/**
 * GET /api/intelligence/decision — the consolidated institutional
 * decision object from the Decision Brain. Auth-gated. Returns ONLY the
 * strict DecisionObject (+ generated_at) — no raw engine internals.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeDecision } from '@/lib/decision-brain'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await composeDecision())
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Decision compose failed' },
      { status: 502 },
    )
  }
}
