/**
 * /api/admin/growth/copilot — daily AI Growth Copilot brief.
 *
 * POST  → generate a new brief now (admin-only, persists a row).
 * GET   → return the most recent brief without generating.
 *
 * The cron at /api/cron/growth-copilot runs once a day. Admins can
 * also fire on-demand from /admin/growth.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { generateCopilotBrief } from '@/lib/growth/copilot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user.email)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

export async function POST() {
  const g = await gate()
  if ('error' in g) return g.error

  try {
    const brief = await generateCopilotBrief(g.user.id)
    return NextResponse.json({ brief })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error

  const { data } = await svc()
    .from('growth_copilot_briefs')
    .select('id, window_start, window_end, signals, summary_md, actions, model, generated_at')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ brief: data ?? null })
}
