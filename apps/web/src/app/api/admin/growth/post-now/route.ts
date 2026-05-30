/**
 * /api/admin/growth/post-now — push a queued scheduled_post NOW.
 *
 * POST { scheduled_id: uuid } → runs lib/growth/scheduler.publishOne()
 * which handles formatting, adapter dispatch, and audit logging.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { publishOne } from '@/lib/growth/scheduler'

export const dynamic = 'force-dynamic'

const schema = z.object({ scheduled_id: z.string().uuid() })

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user.email)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  const outcome = await publishOne(parsed.data.scheduled_id)
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 })
}
