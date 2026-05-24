import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/coach/alerts/[id]/ack
 *
 * Acknowledge a coach alert. RLS policy `coach_alerts_owner_ack` lets the
 * recipient (auth.uid() = user_id) update their own row — no service-role
 * needed. Idempotent: a second ack is a no-op since the row stays ack'd.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('coach_alerts')
    .update({ acknowledged: true })
    .eq('id', id)
    .eq('user_id', user.id)        // belt-and-braces; RLS already enforces
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
