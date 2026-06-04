/**
 * /api/admin/growth/drain-queue — force-drain growth_scheduled_posts
 * NOW, without waiting for the 09:00 UTC cron tick.
 *
 * Identical logic to /api/cron/growth-publish but admin-authenticated
 * instead of CRON_SECRET-gated. The operator hits this when they want
 * to see queued posts go live immediately.
 *
 * Drains up to MAX_PER_TICK rows per call.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { publishOne } from '@/lib/growth/scheduler'

export const dynamic     = 'force-dynamic'
export const runtime     = 'nodejs'
export const maxDuration = 120

const MAX_PER_TICK = 50

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

export async function POST(_req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const db = svc()
  const { data: queue, error } = await db
    .from('growth_scheduled_posts')
    .select('id, send_at, channel')
    .eq('status', 'queued')
    .lte('send_at', new Date().toISOString())
    .order('send_at', { ascending: true })
    .limit(MAX_PER_TICK)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const queued = queue ?? []
  if (queued.length === 0) {
    return NextResponse.json({
      ticked_at: new Date().toISOString(),
      processed: 0,
      note: 'Queue is empty. Either nothing is scheduled or asset_state is still pending — check /admin/growth/media.',
    })
  }

  const results = await Promise.all(queued.map(async (row) => {
    const out = await publishOne(row.id)
    return {
      scheduled_id: row.id,
      channel:      row.channel,
      ok:           out.ok,
      external_url: out.external_url ?? null,
      error:        out.error ?? null,
    }
  }))

  return NextResponse.json({
    ticked_at: new Date().toISOString(),
    fired_by:  g.user.email ?? g.user.id,
    processed: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed:    results.filter((r) => !r.ok).length,
    results,
  })
}

export const GET = POST
