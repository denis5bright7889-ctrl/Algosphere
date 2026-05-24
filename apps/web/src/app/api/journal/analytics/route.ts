import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/journal/analytics
 *
 * Full journal_analytics row for the user (richer than /journal/summary —
 * includes the by-session / by-pair / by-tag / by-hour jsonb breakdowns
 * for heatmap rendering). Computed by the coach worker.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase.from('journal_analytics')
    .select('*').eq('user_id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ analytics: data })
}
