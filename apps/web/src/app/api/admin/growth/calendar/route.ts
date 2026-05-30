/**
 * /api/admin/growth/calendar — read scheduled_posts.
 *
 * Optional ?content_id=<uuid> filter for the per-item schedule log
 * the detail page uses.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

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

export async function GET(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const { searchParams } = new URL(req.url)
  const contentId = searchParams.get('content_id')
  const status    = searchParams.get('status')

  let q = svc().from('growth_scheduled_posts')
    .select('id, content_id, channel, status, send_at, posted_at, external_url, last_error, attempts')
    .order('send_at', { ascending: false })
    .limit(200)

  if (contentId) q = q.eq('content_id', contentId)
  if (status)    q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
