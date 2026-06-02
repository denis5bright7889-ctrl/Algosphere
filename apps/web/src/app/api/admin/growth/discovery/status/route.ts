/**
 * /api/admin/growth/discovery/status — mark a discovery item as
 * replied / dismissed (or back to queued).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const schema = z.object({
  id:     z.string().uuid(),
  status: z.enum(['queued','drafting','replied','dismissed']),
  notes:  z.string().max(500).optional(),
})

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

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 422 })

  const { error } = await svc().from('growth_discovery_items').update({
    status:      parsed.data.status,
    notes:       parsed.data.notes,
    reviewed_by: g.user.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', parsed.data.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
